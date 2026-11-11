const {test}=require('node:test');
const assert=require('node:assert/strict');
const loaded=import('../app/assets/publication-order.mjs');
const now=Date.now();
const valid=()=>({
 id:'f1717e97-34a1-46fe-a9b4-a5c9c1533a71',
 state:'prepared',
 approved_at:null,
 approval_token:'synthetic-approval-token',
 approval_policy:'media-consent-2026-11-03.1',
 binding:{platform:'youtube',asset_id:'a',asset_revision:'sha256:synthetic:10'},
 choices:{visibility:'private'},
 target:{id:'synthetic-channel',platform:'youtube'},
 account_check:{target_id:'synthetic-channel'},
 approval_window:{status:'active',expires_at:new Date(now+60000).toISOString()},
 media_check:{asset_id:'a',asset_revision:'sha256:synthetic:10',checks:[
  {code:'BINARY_INSPECTION',status:'pass'},
  {code:'CONTENT_REVIEW_PENDING',status:'pending'},
  {code:'PUBLICATION_APPROVAL_PENDING',status:'pending'}
 ]}
});
test('prepared private YouTube shows all four independent gates without granting upload',async()=>{
 const {privateYouTubeTestSteps:steps}=await loaded;
 const result=steps(valid(),now);
 assert.equal(result.length,4);
 assert.match(result[0],/aktuell/);
 assert.match(result[1],/Medien- und Inhaltsprüfungen.*offen/);
 assert.match(result[2],/rechtebestätigung.*erforderlich/);
 assert.match(result[3],/Privat bedeutet trotzdem YouTube-Upload/);
 assert.match(result[3],/separate SMA-Betreiberfreigabe/);
 assert.equal(result.some(x=>/Upload freigegeben|can_publish:true|bereits hochgeladen/.test(x)),false);
});
test('wrong platform, public visibility or already approved state are not private preflight',async()=>{
 const {privateYouTubeTestSteps:steps}=await loaded;
 for(const patch of [
  {binding:{platform:'tiktok'}},{binding:{platform:'instagram'}},
  {choices:{visibility:'public'}},{choices:{visibility:'unlisted'}},
  {state:'approved'},{state:'cancelled'},{state:'checked'}
 ])assert.equal(steps({...valid(),...patch},now),null);
});
test('real observed blockers: expired account and FILE_CHANGED are shown independently',async()=>{
 const {privateYouTubeTestSteps:steps}=await loaded;
 const stale={...valid(),approval_window:{status:'expired',expires_at:'2026-11-07T11:02:26.73+00:00'},
  check_error:'FILE_CHANGED',media_check:null};
 const r=steps(stale,now);
 assert.match(r[0],/Freigabefrist nicht mehr gültig/);
 assert.match(r[1],/Datei geändert: Dateiliste aktualisieren/);
 assert.match(r[2],/Persönliche/);
 assert.match(r[3],/separate SMA-Betreiberfreigabe/);
});
test('missing, malformed or future-unknown approval window refuses an approval before network',async()=>{
 const {createOrderClient,privateYouTubeTestSteps:steps}=await loaded;
 let calls=0;
 const client=createOrderClient({session:async()=>({access_token:'synthetic'}),fetcher:async()=>{calls++;throw Error('NETWORK_CALLED');}});
 const review={content_checked:true,media_rights:true,music_rights:true,human_review_enabled:false};
 for(const w of [undefined,null,{}, {status:'active'}, {status:'unknown',expires_at:new Date(now+60000).toISOString()},
  {status:'expired',expires_at:new Date(now+60000).toISOString()},
  {status:'active',expires_at:'not-a-time'},
  {status:'active',expires_at:new Date(now-60000).toISOString()}]){
  const o={...valid(),approval_window:w};
  assert.throws(()=>client.approve(o,true,review),/Vorbereitung ist abgelaufen/);
  assert.match(steps(o,now)[0],/nicht mehr gültig/);
 }
 assert.equal(calls,0,'invalid prepared state must not call n8n');
});
test('changed media revision or new independent problem cannot be shown as media pass',async()=>{
 const {privateYouTubeTestSteps:steps}=await loaded;
 const changed={...valid(),media_check:{...valid().media_check,asset_revision:'different'}};
 assert.match(steps(changed,now)[1],/noch offen/);
 const missing={...valid(),media_check:null};
 assert.match(steps(missing,now)[1],/noch offen/);
 const error={...valid(),check_error:'TARGET_ACCOUNT_CHANGED'};
 assert.match(steps(error,now)[1],/Zielkonto wurde geändert/);
});
test('no authorization or profile credential gets copied into private YouTube checklist',async()=>{
 const {privateYouTubeTestSteps:steps}=await loaded;
 const o={...valid(),target:{id:'DO_NOT_ECHO_CUSTOMER_CHANNEL'},account_check:{target_id:'DO_NOT_ECHO_CUSTOMER_CHANNEL'},
  draft:{title:'DO_NOT_ECHO_CUSTOMER_TITLE',caption:'DO_NOT_ECHO_CAPTION'}};
 const s=JSON.stringify(steps(o,now));
 for(const secret of ['DO_NOT_ECHO_CUSTOMER_CHANNEL','DO_NOT_ECHO_CUSTOMER_TITLE','DO_NOT_ECHO_CAPTION'])
  assert(!s.includes(secret));
});
