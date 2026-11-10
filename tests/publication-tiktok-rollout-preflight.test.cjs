'use strict';
// Purely offline: creates a synthetic copy of the pre-AIGC 47-node workflow.
// No n8n access, database calls, provider HTTP, customer media or credentials.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const gate='n8n/publishing/check-aigc-rollout.py';
const original='tests/provider-cover-pr57-workflow.json';
const oldKeys="['visibility','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle']";
const newKeys="['visibility','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle','is_aigc']";
const oldBody='brand_organic_toggle:choices.brand_organic_toggle}';
const newBody='brand_organic_toggle:choices.brand_organic_toggle,is_aigc:choices.is_aigc}';
const output=mkdtempSync(path.join(tmpdir(),'sma-aigc-gate-'));

let target,installed;
try{
 const candidate=path.join(output,'candidate.json');
 execFileSync('python',['n8n/publishing/patch-provider-cover.py','--input',original,'--output',candidate],{cwd:root,timeout:25000});
 target=JSON.parse(readFileSync(candidate,'utf8'));
 assert.equal(target.nodes.length,47);
 installed=JSON.parse(JSON.stringify(target));
 let count=0;
 for(const node of installed.nodes){
  const js=node.parameters?.jsCode;
  if(typeof js!=='string'||!js.includes('function providerUploadPlan('))continue;
  assert.equal(js.split(newKeys).length,2);
  assert.equal(js.split(newBody).length,2);
  node.parameters.jsCode=js.replace(newKeys,oldKeys).replace(newBody,oldBody);
  count++;
 }
 assert.equal(count,4);
 installed.id='JaidX5YeKl6ZTqjQ';
 installed.active=true; // Synthetic stand-in for an existing published workflow.
}catch(error){
 rmSync(output,{recursive:true,force:true});
 throw error;
}

function run(args){
 return spawnSync('python',[gate,...args],{
  cwd:root,encoding:'utf8',timeout:30000,
 });
}
function exportAndCheck(data,marker='test'){
 const file=path.join(output,marker+'.json');
 writeFileSync(file,JSON.stringify(data));
 return run(['--installed-export',file]);
}
test.after(()=>rmSync(output,{recursive:true,force:true}));

test('pinned sources pass but cannot claim live n8n readiness without a private export',()=>{
 const r=run(['--source-only']);
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/SOURCE_PREFLIGHT_OK/);
 assert.match(r.stdout,/LIVE_EXPORT_NOT_VERIFIED/);
 assert.match(r.stdout,/NO_DEPLOYMENT/);
});

test('synthetic installed provider-and-cover copy matches the pre-AIGC 47-node baseline',()=>{
 const r=exportAndCheck(installed,'exact-legacy-copy');
 assert.equal(r.status,0,r.stderr);
 assert.match(r.stdout,/INSTALLED_BASELINE_MATCH/);
 assert.match(r.stdout,/AIGC_CANDIDATE_SOURCE_READY/);
 assert.match(r.stdout,/NO_DEPLOYMENT/);
});

test('matching code from a copied, renamed or inactive workflow never proves live readiness',()=>{
 const copied=JSON.parse(JSON.stringify(installed));
 copied.id='ANOTHER_WORKFLOW_ID';
 assert.match(exportAndCheck(copied,'copied-workflow').stderr,/INSTALLED_WORKFLOW_ID_UNVERIFIED/);
 const missing=JSON.parse(JSON.stringify(installed));
 delete missing.id;
 assert.match(exportAndCheck(missing,'missing-id').stderr,/INSTALLED_WORKFLOW_ID_UNVERIFIED/);
 const renamed=JSON.parse(JSON.stringify(installed));
 renamed.name='Unbekannte Arbeitskopie';
 assert.match(exportAndCheck(renamed,'renamed-workflow').stderr,/INSTALLED_WORKFLOW_NAME_CHANGED/);
 const inactive=JSON.parse(JSON.stringify(installed));
 inactive.active=false;
 assert.match(exportAndCheck(inactive,'inactive-workflow').stderr,/INSTALLED_WORKFLOW_INACTIVE/);
});

test('gate refuses existing AIGC modifications instead of silently applying them again',()=>{
 const changed=JSON.parse(JSON.stringify(target));changed.id='JaidX5YeKl6ZTqjQ';changed.active=true;
 const r=exportAndCheck(changed,'already-modified');
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/AIGC_ROLLOUT_BLOCKED: INSTALLED_NODE_DRIFT/);
});

test('gate rejects new triggers, extra nodes, automatic retries and setting drift',()=>{
 const extra=JSON.parse(JSON.stringify(installed));
 extra.nodes.push({...extra.nodes[0],name:'Unapproved trigger',type:'n8n-nodes-base.webhook'});
 assert.match(exportAndCheck(extra,'extra-node').stderr,/WORKFLOW_NODE_COUNT_CHANGED/);
 const retry=JSON.parse(JSON.stringify(installed));
 retry.nodes.find(n=>n.name==='Provider-JSON-Anfrage').retryOnFail=true;
 assert.match(exportAndCheck(retry,'retry').stderr,/WORKFLOW_TRIGGER_OR_RETRY_CHANGED/);
 const setting=JSON.parse(JSON.stringify(installed));
 setting.settings.saveDataSuccessExecution='all';
 assert.match(exportAndCheck(setting,'settings').stderr,/WORKFLOW_SETTINGS_CHANGED/);
});

test('gate refuses a drifted provider URL, code or graph, without printing secret values',()=>{
 const drift=JSON.parse(JSON.stringify(installed));
 const n=drift.nodes.find(n=>n.name==='Provider-JSON-Anfrage');
 n.parameters.url='https://synthetic-secret.invalid';
 const r=exportAndCheck(drift,'unsafe-url');
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/INSTALLED_NODE_DRIFT/);
 assert.doesNotMatch(r.stderr,/synthetic-secret/);
 const graph=JSON.parse(JSON.stringify(installed));
 const entry=Object.keys(graph.connections)[0];
 graph.connections[entry]={main:[]};
 assert.match(exportAndCheck(graph,'changed-edges').stderr,/INSTALLED_EDGES_DRIFT/);
});

test('critical SHA-256 verification cannot be removed or bypassed even at 47 nodes',()=>{
 const removed=JSON.parse(JSON.stringify(installed));
 const checksum=removed.nodes.find(n=>n.name==='Provider-Dateiprüfsumme bestätigen');
 assert.ok(checksum,'the 47-node source must include SHA-256 verification');
 checksum.name='Synthetic replacement';
 assert.match(exportAndCheck(removed,'missing-checksum').stderr,/CRITICAL_CHECKSUM_NODE_MISSING/);
 const bypass=JSON.parse(JSON.stringify(installed));
 const source=bypass.connections['Provider-Videodatei lesen'];
 for(const branch of source.main) for(const edge of branch)
  if(edge.node==='Provider-Dateiprüfsumme bestätigen')
   edge.node='Provider-Dateistand rückprüfen';
 assert.match(exportAndCheck(bypass,'bypass-checksum').stderr,/CRITICAL_CHECKSUM_ROUTE_CHANGED/);
 const broken=JSON.parse(JSON.stringify(installed));
 broken.nodes.find(n=>n.name==='Provider-Dateiprüfsumme bestätigen').type='n8n-nodes-base.noOp';
 assert.match(exportAndCheck(broken,'wrong-checksum-type').stderr,/CRITICAL_CHECKSUM_NODE_MISSING/);
});

test('gate rejects missing, malformed or oversized private exports before any changes',()=>{
 const notFound=run(['--installed-export',path.join(output,'missing.json')]);
 assert.notEqual(notFound.status,0);
 assert.match(notFound.stderr,/EXPORT_MISSING_OR_TOO_LARGE/);
 writeFileSync(path.join(output,'broken.json'),'{');
 const broken=run(['--installed-export',path.join(output,'broken.json')]);
 assert.match(broken.stderr,/INVALID_EXPORT_JSON/);
});
