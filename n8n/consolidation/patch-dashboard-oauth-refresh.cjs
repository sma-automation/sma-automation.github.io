'use strict';

// The private full workflow stays outside git. This patch changes only the
// verified OAuth-return block in each identical renderer of the existing
// customer workflow; it never imports, publishes or calls that workflow.
const crypto=require('node:crypto');
const {installDashboardOAuthRefresh}=require('./dashboard-oauth-refresh.cjs');
const WORKFLOW_ID='GHBsYQcyt0JLFvRP';
const RENDERER_ID='8197ba5e-f1d9-4439-a628-1f92df5b5d48';
const BASELINE_RENDERER_SHA256='dc79b51f98c3125b861ef4eee2a9787fc9d0732f3977bd7d651eb40323e51a80';
const BASELINE_OAUTH_SHA256='7f66d82a9ad80cd2e2b0fdf7d68825b0c7fc3dd3915a814a526081126a52ccc5';
const START="  let smaOauthPendingPlatform = '';";
const END='  /*\n    OFFENE SMA-MODULSCHNITTSTELLE';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function browserSource(){
 return '('+installDashboardOAuthRefresh.toString()+')({window,document,setLanguage,currentLanguage});';
}
function templateSource(value){
 // The renderer itself returns a template literal containing the HTML script.
 return value.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$\{/g,'\\${');
}
function replaceOAuthBlock(code){
 if(typeof code!=='string'||code.split(START).length!==2||code.split(END).length!==2)
  throw new Error('DASHBOARD_OAUTH_ANCHOR_CHANGED');
 const start=code.indexOf(START),end=code.indexOf(END);
 if(end<=start||hash(code.slice(start,end))!==BASELINE_OAUTH_SHA256)
  throw new Error('DASHBOARD_OAUTH_BLOCK_CHANGED');
 const result=code.slice(0,start)+'  '+templateSource(browserSource())+'\n\n'+code.slice(end);
 // Compile only. A code node contains private provider lookups and is never
 // executed by this patcher or its command-line entry point.
 new Function(result);
 return result;
}
function patchDashboardWorkflow(input){
 if(!input||input.id!==WORKFLOW_ID||!Array.isArray(input.nodes))throw new Error('DASHBOARD_WORKFLOW_CHANGED');
 if(input.nodes.some(node=>typeof node?.id!=='string'||!node.id)||new Set(input.nodes.map(node=>node.id)).size!==input.nodes.length)
  throw new Error('DASHBOARD_NODE_IDENTITIES_CHANGED');
 const matches=input.nodes.filter(node=>{
  const code=node.parameters?.jsCode;
  return typeof code==='string'&&(code.includes(START)||code.includes('smaOauthRefreshStatus')||code.includes('installDashboardOAuthRefresh'));
 });
 if(!matches.length||!matches.some(node=>node.id===RENDERER_ID))throw new Error('DASHBOARD_RENDERER_MISSING');
 // Validate all copies before producing any changed node. One drifted copy
 // rejects the complete candidate instead of leaving mixed implementations.
 for(const node of matches){
  if(node.type!=='n8n-nodes-base.code'||hash(node.parameters.jsCode)!==BASELINE_RENDERER_SHA256)throw new Error('DASHBOARD_RENDERER_BASELINE_CHANGED');
 }
 const output=JSON.parse(JSON.stringify(input)),changes=[];
 for(const node of matches){
  const replacement=replaceOAuthBlock(node.parameters.jsCode);
  output.nodes.find(candidate=>candidate.id===node.id).parameters.jsCode=replacement;
  changes.push({id:node.id,name:node.name,before_sha256:BASELINE_RENDERER_SHA256,after_sha256:hash(replacement)});
 }
 return {workflow:output,changes};
}

module.exports={browserSource,replaceOAuthBlock,patchDashboardWorkflow,BASELINE_RENDERER_SHA256,BASELINE_OAUTH_SHA256};

if(require.main===module){
 const fs=require('node:fs'),path=require('node:path');
 const [inputFile,outputDirectory,...extra]=process.argv.slice(2);
 if(!inputFile||!outputDirectory||extra.length)throw new Error('Usage: node patch-dashboard-oauth-refresh.cjs PRIVATE_EXPORT_JSON PRIVATE_OUTPUT_DIRECTORY');
 const repository=path.resolve(__dirname,'../..');
 for(const filename of [inputFile,outputDirectory]){
  const absolute=path.resolve(filename);
  if(absolute===repository||absolute.startsWith(repository+path.sep))throw new Error('Keep private exports and renderer candidates outside the repository');
 }
 const {workflow,changes}=patchDashboardWorkflow(JSON.parse(fs.readFileSync(inputFile,'utf8')));
 fs.mkdirSync(outputDirectory,{recursive:true});
 const manifest={workflow_id:workflow.id,version_id:workflow.versionId,renderers:changes.map((change,index)=>({...change,file:'renderer-'+(index+1)+'.js'}))};
 for(const change of manifest.renderers){
  fs.writeFileSync(path.join(outputDirectory,change.file),workflow.nodes.find(node=>node.id===change.id).parameters.jsCode,{flag:'wx'});
 }
 fs.writeFileSync(path.join(outputDirectory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 process.stdout.write(JSON.stringify({renderer_count:changes.length,manifest:path.join(outputDirectory,'manifest.json')})+'\n');
}
