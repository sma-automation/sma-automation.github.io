'use strict';
// Offline proof that the GENERATED current 47-node provider/cover dispatcher
// cannot route to a provider HTTP call without each upstream safety barrier.
// This test invokes no provider, Supabase, n8n, or credential, and changes
// no live workflow. It verifies topology, not runtime account permissions.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
let dispatcher;
const work=fs.mkdtempSync(path.join(os.tmpdir(),'sma-provider-gate-'));
try{
 const exported=path.join(work,'provider-cover.json');
 const result=execFileSync('python3',['n8n/publishing/patch-provider-cover.py',
  '--input','tests/provider-cover-pr57-workflow.json','--output',exported],
  {cwd:root,encoding:'utf8',timeout:20000,maxBuffer:500000});
 assert.match(result,/47 nodes; input baseline verified/);
 dispatcher=JSON.parse(fs.readFileSync(exported,'utf8'));
}finally{
 fs.rmSync(work,{recursive:true,force:true});
}
const byName=new Map(dispatcher.nodes.map(x=>[x.name,x]));
const names=new Set(byName.keys());
const trigger='Providerauftrag fortsetzen';
function edges(graph=dispatcher){
 const next=new Map(graph.nodes.map(x=>[x.name,[]]));
 for(const [from,spec] of Object.entries(graph.connections||{})){
  assert(next.has(from),'Unexpected graph source: '+from);
  const list=(spec.main||[]).flat().filter(Boolean).map(v=>v.node);
  list.forEach(to=>assert(next.has(to),'Unexpected graph destination: '+to));
  next.set(from,list);
 }
 return next;
}
function reachable(target,without=new Set(),graph=dispatcher){
 const next=edges(graph),seen=new Set(),stack=[trigger];
 while(stack.length){
  const node=stack.pop();
  if(without.has(node)||seen.has(node))continue;
  seen.add(node);
  if(node===target)return true;
  stack.push(...(next.get(node)||[]));
 }
 return false;
}
const requireDominators=(target,steps)=>{
 assert(reachable(target),'Target is not on the checked-in executable graph: '+target);
 for(const gate of steps){
  assert(names.has(gate),'Safety gate missing: '+gate);
  assert(!reachable(target,new Set([gate])),
   'UNSAFE_PROVIDER_PATH: '+target+' reachable when '+gate+' is removed');
 }
};
const postTransfer=['Provider-JSON-Anfrage','Provider-Dateitransfer','Provider-Statusanfrage'];

test('47-node cover dispatcher remains internal-only and cannot be scheduled',()=>{
 assert.equal(dispatcher.nodes.length,47);
 assert.equal(byName.size,dispatcher.nodes.length,'Duplicated nodes could mask graph gates');
 assert.equal(dispatcher.active,false);
 assert.deepEqual(dispatcher.pinData,{});
 assert.equal(dispatcher.nodes.filter(n=>n.type==='n8n-nodes-base.executeWorkflowTrigger').length,1);
 assert.equal(byName.get(trigger)?.type,'n8n-nodes-base.executeWorkflowTrigger');
 assert(!dispatcher.nodes.some(n=>/webhook|scheduleTrigger|cron|interval/i.test(n.type)));
 assert(!dispatcher.nodes.some(n=>n.retryOnFail===true));
});

test('every provider HTTP path requires actual account, reservation and lease gate',()=>{
 const gates=[
  'Providerauftrag lesen','Providerbindung bestätigen','Providerkonto rückprüfen',
  'Aktuelle Providerverbindung lesen','Providerverbindung bestätigen',
  'Provideranfrage atomar reservieren','Provideranfrage reserviert?',
  'Provideranfrage erstellen'
 ];
 for(const target of postTransfer)requireDominators(target,gates);
});

test('YouTube cover transfer must pass account, exact file and cover lease checks',()=>{
 requireDominators('YouTube-Cover übertragen',[
  'Providerauftrag lesen','Providerbindung bestätigen',
  'Providerkonto rückprüfen','Providerverbindung bestätigen',
  'YouTube-Cover bereit?','Cover-Dateistand lesen',
  'Coverdatei laden','Coverbytes prüfen','Cover-Dateistand rückprüfen',
  'Cover-Prüfnachweise verbinden','Coveranfrage reservieren',
  'Coveranfrage reserviert?','Coveranfrage erstellen'
 ]);
 const source=byName.get('Coveranfrage reservieren')?.parameters?.jsonBody||'';
 assert.match(source,/p_action:'cover_begin'/);
 const condition=byName.get('Coveranfrage reserviert?')?.parameters?.conditions?.conditions?.[0]?.leftValue||'';
 assert.match(condition,/json\.ok === true/);
 assert.match(condition,/json\.operation === 'youtube_thumbnail'/);
 assert.match(condition,/json\.lease_id/);
});

test('provider request lease gate rejects missing reservation and wrong operation',()=>{
 const body=byName.get('Provideranfrage atomar reservieren')?.parameters?.jsonBody||'';
 assert.match(body,/p_action:'provider_begin'/);
 const gate=byName.get('Provideranfrage reserviert?')?.parameters?.conditions?.conditions?.[0]?.leftValue||'';
 assert.match(gate,/(lease_id|lease)/);
 assert.match(gate,/(ok|operation)/);
});

test('all media/provider transfer HTTP nodes disable redirect and retry',()=>{
 for(const name of [...postTransfer,'YouTube-Cover übertragen']){
  const node=byName.get(name);
  assert.equal(node?.type,'n8n-nodes-base.httpRequest');
  assert.notEqual(node.retryOnFail,true);
  assert.equal(node.parameters?.options?.redirect?.redirect?.followRedirects,false,
   name+' must not follow cross-origin redirects');
 }
});

test('current dashboard API dispatches only checked approve/get requests to cover workflow',()=>{
 const api=JSON.parse(fs.readFileSync('n8n/publishing/publication-order-api-workflow.json','utf8'));
 const node=api.nodes.find(n=>n.name==='Providerweg im Hintergrund');
 assert(node,'Missing current provider subworkflow');
 assert.equal(node.type,'n8n-nodes-base.executeWorkflow');
 assert.equal(node.parameters.workflowId?.value,'JaidX5YeKl6ZTqjQ',
  'Stale 29-node provider workflow ID must not be reintroduced');
 assert.equal(node.parameters.options?.waitForSubWorkflow,true);
 const checks=api.nodes.filter(n=>n.name==='Geprüften Providerauftrag fortsetzen?');
 assert.equal(checks.length,1);
 const expr=checks[0].parameters.conditions.conditions?.[0]?.leftValue||'';
 assert.match(expr,/\$json\.state === 'checked'/);
 assert.match(expr,/\['approve','get'\]\.includes/);
 const graph={nodes:api.nodes,connections:api.connections};
 function canGo(target,exclude){
  const next=edges(graph),stack=['Dashboard-Anfrage prüfen'],seen=new Set();
  while(stack.length){
   const n=stack.pop();if(seen.has(n)||exclude.has(n))continue;
   seen.add(n);if(n===target)return true;
   stack.push(...next.get(n)||[]);
  }
  return false;
 }
 assert(canGo('Providerweg im Hintergrund',new Set()));
 for(const gate of ['Dashboard-Antwort','Geprüften Providerauftrag fortsetzen?'])
  assert(!canGo('Providerweg im Hintergrund',new Set([gate])),
   'Provider dispatch can bypass '+gate);
});

test('regression proof: synthetic bypass edge is detected by graph dominators',()=>{
 const mutated=structuredClone(dispatcher);
 mutated.connections['Providerbindung bestätigen'].main[0].push({
  node:'Provider-JSON-Anfrage',type:'main',index:0
 });
 assert(reachable('Provider-JSON-Anfrage',new Set(['Provideranfrage reserviert?']),mutated),
  'Deliberately unsafe graph mutation should be detected');
});
