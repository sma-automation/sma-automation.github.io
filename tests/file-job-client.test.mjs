import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileJobClient,fileJobAnchor} from '../app/assets/file-job-client.mjs';
const owner='10000000-0000-4000-8000-000000000001',job='20000000-0000-4000-8000-000000000001';
const anchor={kind:'asset',asset_id:'30000000-0000-4000-8000-000000000001',asset_revision:'revision-1'};
function setup({lost=false,canonical=false,polls=0}={}){
 let currentOwner=owner,count=0,reads=0;const calls=[],stored=new Map();
 const session=async()=>({access_token:'synthetic-token',user:{id:currentOwner}});
 const view={ok:true,job_id:job,state:'running',deadline_at:new Date(Date.now()+86400000).toISOString(),commands:[]};
 const fetcher=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  if(body.p_action==='start')return Response.json(view);
  if(url.endsWith('/functions/v1/sma-file-job')){
   const id=canonical?'50000000-0000-4000-8000-000000000001':body.command_id;
   stored.set(id,{command_id:id,operation:body.operation,state:'running',response:{status:200,body:{ok:true,stage:body.operation,can_publish:false}}});
   if(lost)throw Error('lost response');return Response.json({ok:true,job_id:job,command_id:id,accepted:true});
  }
  const item=stored.get(body.p_input.command_id);
  return Response.json({...view,commands:item?[reads++<polls?{...item,response:null}:item]:[]});
 };
 const client=createFileJobClient({session,fetcher,uuid:()=>`40000000-0000-4000-8000-${String(++count).padStart(12,'0')}`,wait:async()=>{}});
 return {client,calls,changeOwner:value=>{currentOwner=value;}};
}
test('successive actions share one start; polling does not call n8n or Edge',async()=>{
 const {client,calls}=setup({polls:3});
 for(const operation of ['magic_photo','preview_prepare'])assert.equal((await (await client.request({anchor,operation,input:{asset_id:anchor.asset_id}})).json()).stage,operation);
 assert.equal(calls.filter(c=>c.body.p_action==='start').length,1);
 assert.equal(calls.filter(c=>c.url.includes('/functions/')).length,2);
 assert.equal(calls.some(c=>c.url.includes('n8n')),false);
 assert.equal(calls.filter(c=>c.body.p_action==='get').length,5);
});
test('lost Edge reply reads the same command without retransmission',async()=>{
 const {client,calls}=setup({lost:true});
 const options={anchor,operation:'magic_photo',input:{asset_id:anchor.asset_id}};
 assert.equal((await (await client.request(options)).json()).ok,true);
 assert.equal((await (await client.request(options)).json()).ok,true);
 assert.equal(calls.filter(c=>c.url.includes('/functions/')).length,1);
});
test('canonical upload command is polled by its returned identity',async()=>{
 const {client,calls}=setup({canonical:true});
 await client.request({anchor:{kind:'upload',upload_id:anchor.asset_id,name:'test.png',mime_type:'image/png',size_bytes:12},operation:'upload_start',input:{upload_id:anchor.asset_id}});
 assert.equal(calls.find(c=>c.body.p_action==='get').body.p_input.command_id,'50000000-0000-4000-8000-000000000001');
});
test('file anchors contain only immutable binding fields',()=>{
 assert.deepEqual(fileJobAnchor({id:anchor.asset_id,revision:'r',name:'private',user_id:'ignored'}),{...anchor,asset_revision:'r'});
});
test('owner changes during transmission reject the stale result',async()=>{
 let user=owner;
 const client=createFileJobClient({session:async()=>({access_token:'x',user:{id:user}}),fetcher:async()=>{user='10000000-0000-4000-8000-000000000002';return Response.json({ok:true});}});
 await assert.rejects(client.request({anchor,operation:'magic_photo',input:{}}),e=>e.code==='AUTH_REQUIRED');
});
