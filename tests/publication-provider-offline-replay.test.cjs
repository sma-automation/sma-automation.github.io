'use strict';
// Replays the checked-in provider node with synthetic HTTP responses only.
// No credentials, requests, customer data or n8n executions are used.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');

const workflow=JSON.parse(fs.readFileSync('tests/provider-cover-pr57-workflow.json','utf8'));
const named=name=>{
 const matches=workflow.nodes.filter(node=>node.name===name);
 assert.equal(matches.length,1,'Expected exactly one node named '+name);
 return matches[0];
};
const responseCode=named('Providerantwort auswerten').parameters.jsCode;
assert.equal(typeof responseCode,'string');
const script=new vm.Script('(function(){\n'+responseCode+'\n})()',{filename:'Providerantwort auswerten'});
const youtube={
 ok:true,operation:'status',platform:'youtube',target_id:'synthetic_channel',
 provider_id:'AbCdEf123_-',visibility:'private',size_bytes:1000
};
const tiktok={
 ok:true,operation:'status',platform:'tiktok',target_id:'synthetic_creator',
 provider_id:'v_pub_file~v2.123',visibility:'SELF_ONLY',size_bytes:1000
};

function replay(raw,intent){
 const sandbox={
  $json:raw,
  $:name=>{
   assert.equal(name,'Provideranfrage atomar reservieren');
   return {first:()=>({json:intent})};
  },
  require:name=>{
   assert.equal(name,'crypto','Node must have no network-capable dependencies');
   return crypto;
  },
  Buffer,URL
 };
 const output=script.runInNewContext(sandbox,{timeout:4000});
 assert.equal(output.length,1);
 return JSON.parse(JSON.stringify(output[0].json));
}
const youtubeStatus=(privacy='private',channel=youtube.target_id)=>({
 statusCode:200,
 body:{items:[{
  id:youtube.provider_id,snippet:{channelId:channel},
  status:{uploadStatus:'processed',privacyStatus:privacy},
  processingDetails:{processingStatus:'succeeded'}
 }]}
});
const tiktokStatus=(status='PUBLISH_COMPLETE',extra={})=>({
 statusCode:200,body:{error:{code:'ok'},data:{status,...extra}}
});

test('installed dispatcher has one internal entry and never retries or redirects provider HTTP',()=>{
 assert.equal(workflow.nodes.filter(node=>node.type==='n8n-nodes-base.executeWorkflowTrigger').length,1);
 assert.equal(workflow.nodes.some(node=>/webhook|scheduleTrigger|cron/i.test(node.type)),false);
 for(const name of ['Provider-Dateitransfer','Provider-JSON-Anfrage','Provider-Statusanfrage']){
  const node=named(name);
  assert.equal(node.type,'n8n-nodes-base.httpRequest');
  assert.notEqual(node.retryOnFail,true,name+' must never retry automatically');
  assert.equal(node.parameters.options.redirect.redirect.followRedirects,false);
 }
 const begin=named('Provideranfrage atomar reservieren');
 const finish=named('Providerergebnis speichern');
 assert.equal(begin.parameters.url,finish.parameters.url);
 assert.match(begin.parameters.jsonBody,/p_action:'begin'/);
 assert.match(finish.parameters.jsonBody,/p_action:'finish'/);
 assert.match(finish.parameters.jsonBody,/p_lease:/);
});

test('YouTube private completion is not public confirmation',()=>{
 const r=replay(youtubeStatus(),youtube);
 assert.equal(r.state,'complete');
 assert.equal(r.observation.platform,'youtube');
 assert.equal(r.observation.target_id,youtube.target_id);
 assert.equal(r.observation.publicly_available,false);
 assert.equal(r.observation.visibility,'private');
 assert.equal(r.observation.can_publish,false);
 assert.equal(r.observation.upload_retry_allowed,false);
});

test('YouTube rejects switched accounts and visibility and does not invent success',()=>{
 const wrongAccount=replay(youtubeStatus('private','wrong_channel'),youtube);
 assert.equal(wrongAccount.state,'uncertain');
 assert.equal(wrongAccount.code,'PROVIDER_BINDING_MISMATCH');
 const wrongPrivacy=replay(youtubeStatus('public'),youtube);
 assert.equal(wrongPrivacy.state,'needs_review');
 assert.equal(wrongPrivacy.observation.code,'VISIBILITY_MISMATCH');
});

test('TikTok does not claim public visibility without an exact public post ID',()=>{
 const c={...tiktok,visibility:'PUBLIC_TO_EVERYONE'};
 const pending=replay(tiktokStatus(),c);
 assert.equal(pending.state,'complete');
 assert.equal(pending.observation.publicly_available,null);
 assert.deepEqual(pending.observation.public_post_ids,[]);
 const raw='{"error":{"code":"ok"},"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[9223372036854775807]}}';
 const confirmed=replay({statusCode:200,body:raw},c);
 assert.equal(confirmed.state,'complete');
 assert.equal(confirmed.observation.publicly_available,true);
 assert.deepEqual(confirmed.observation.public_post_ids,['9223372036854775807']);
 const limited=replay(tiktokStatus('PUBLISH_COMPLETE',{publicaly_available_post_id:['7400123456789123456']}),tiktok);
 assert.equal(limited.state,'needs_review');
});

test('TikTok inbox and failures cannot be mistaken for completed posting',()=>{
 assert.equal(replay(tiktokStatus('SEND_TO_USER_INBOX'),tiktok).state,'uncertain');
 assert.equal(replay(tiktokStatus('FAILED'),tiktok).state,'failed');
 assert.equal(replay(tiktokStatus('FUTURE_UNKNOWN_STATE'),tiktok).state,'uncertain');
});

test('Unclear initialization and status errors stay uncertain and never echo raw secrets',()=>{
 for(const operation of ['init','status']){
  for(const http of [
   {statusCode:503,body:'{"private_token":"DO_NOT_LEAK"}'},
   {statusCode:302,headers:{location:'https://attacker.invalid'}},
   null
  ]){
   const r=replay(http,{...tiktok,operation});
   assert.equal(r.state,'uncertain');
   assert.equal(r.can_publish,undefined);
   assert.equal(r.can_upload,undefined);
   assert.doesNotMatch(JSON.stringify(r),/DO_NOT_LEAK|attacker\\.invalid/);
  }
 }
});

test('YouTube interrupted upload probe reports only confirmed byte progress',()=>{
 const probe={...youtube,operation:'probe'};
 const partial=replay({statusCode:308,headers:{range:'bytes=0-599'}},probe);
 assert.deepEqual(partial,{state:'uploading',received_bytes:600});
 const unknown=replay({statusCode:308,headers:{range:'bytes=1-599'}},probe);
 assert.equal(unknown.state,'uncertain');
 assert.equal(unknown.code,'TRANSFER_UNCERTAIN');
 const transfer=replay({statusCode:201,body:{id:youtube.provider_id}},{...youtube,operation:'upload'});
 assert.equal(transfer.state,'processing');
 assert.equal(transfer.observation,undefined);
});
