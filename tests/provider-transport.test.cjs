const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {providerSession,providerHttp,providerRequest,providerObservation,providerBytes}=require('../n8n/publishing/provider-transport.cjs');
const yt='https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=synthetic';
const tt='https://open-upload.tiktokapis.com/video/?upload_id=1&upload_token=synthetic';
const now=Date.parse('2026-11-03T20:00:00Z');
const i={ok:true,id:'fa690000-0000-4000-8000-000000000010',lease_id:'fa690000-0000-4000-8000-000000000011',sequence:1,operation:'init',platform:'youtube',target_id:'synthetic_channel',visibility:'private',size_bytes:1000,received_bytes:0,session_url:yt,session_expires_at:'2026-11-03T21:00:00Z',binding:{platform:'youtube',media_kind:'video',asset_revision:'sha256:'+'a'.repeat(64)+':1'},draft:{title:'Exakter Titel',caption:'Exakter gespeicherter Beitrag #test'},choices:{visibility:'private',made_for_kids:false,contains_synthetic_media:false}};
const tk={...i,platform:'tiktok',target_id:'synthetic_creator',visibility:'SELF_ONLY',session_url:tt,provider_id:'v_pub_file~1',binding:{...i.binding,platform:'tiktok'},choices:{visibility:'SELF_ONLY',disable_comment:true,disable_duet:true,disable_stitch:true,brand_content_toggle:false,brand_organic_toggle:false}};
test('upload session rejects host/path injection, redirects, credentials, duplicates and expired URLs',()=>{
 assert.equal(providerSession('youtube',yt),yt);assert.equal(providerSession('tiktok',tt),tt);
 assert.equal(providerSession('tiktok',tt.replace('open-upload','upload.us')),tt.replace('open-upload','upload.us'));
 for(const url of [yt.replace('googleapis.com','googleapis.com.attacker.invalid'),yt.replace('https:','http:'),yt.replace('www.','secret@www.'),yt+'&upload_id=2',yt+'&next=https://attacker.invalid',yt+'#secret',yt.replace('/upload/','/upload/%2e%2e/'),yt+'\n'])assert.throws(()=>providerSession('youtube',url));
 assert.throws(()=>providerRequest({...i,operation:'upload',session_expires_at:new Date(now).toISOString()},'synthetic-token',now),/EXPIRED/);
});
test('init request preserves exact stored texts and choices and requires a journal intent',()=>{
 const y=providerRequest(i,'synthetic-token',now),t=providerRequest(tk,'synthetic-token',now);
 assert.equal(y.body.snippet.title,i.draft.title);assert.equal(y.body.snippet.description,i.draft.caption);assert.equal(t.body.post_info.title,tk.draft.caption);
 for(const bad of [{...i,lease_id:null},{...i,ok:false},{...i,sequence:0},{...i,platform:'facebook'},{...i,choices:{visibility:'private'}}])assert.throws(()=>providerRequest(bad,'synthetic-token',now));
});
test('provider metadata preserves the exact customer-shop invitation for both portals',()=>{
 const caption='Farbige Linien im SMA-Testvideo.\\n\\nSchau doch mal in meinem Shop vorbei!\\n\\n#SMA #Video\\n\\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=sma-testkunde';
 for(const value of [i,tk]){
  const draft={...value.draft,caption},request=providerRequest({...value,draft},'synthetic-token',now);
  assert.equal(value.platform==='youtube'?request.body.snippet.description:request.body.post_info.title,caption);
  assert.equal(request.body_type,'json');
  assert.equal(request.headers.Authorization,'Bearer synthetic-token');
 }
});

test('YouTube recovery probes empty then sends only the confirmed remainder',()=>{
 const p=providerRequest({...i,operation:'probe'},'synthetic-token',now);assert.equal(p.headers['Content-Range'],'bytes */1000');assert.equal(p.headers['Content-Length'],'0');assert.equal(p.body_type,'none');
 const r=providerRequest({...i,operation:'upload',received_bytes:600},'synthetic-token',now);assert.equal(r.offset,600);assert.equal(r.headers['Content-Length'],'400');assert.equal(r.headers['Content-Range'],'bytes 600-999/1000');
 assert.throws(()=>providerRequest({...i,operation:'upload',received_bytes:1000},'synthetic-token',now));
});
test('TikTok uses FILE_UPLOAD capability URL without forwarding an account bearer',()=>{
 const r=providerRequest({...tk,operation:'upload'},'synthetic-token',now);assert.equal(r.headers.Authorization,undefined);assert.equal(r.url,tt);
 assert.throws(()=>providerRequest({...tk,operation:'upload',received_bytes:10},'synthetic-token',now));
 assert.throws(()=>providerRequest({...tk,operation:'probe'},'synthetic-token',now));
});
test('unsafe int64 IDs survive raw JSON parsing exactly',()=>{
 const h=providerHttp({statusCode:200,body:'{"error":{"code":"ok"},"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[9223372036854775807]}}'});
 assert.equal(h.body.data.publicaly_available_post_id[0],'9223372036854775807');
 const r=providerObservation({statusCode:200,body:JSON.stringify(h.body)},{...tk,operation:'status',visibility:'PUBLIC_TO_EVERYONE'},now);
 assert.equal(r.observation.public_post_ids[0],'9223372036854775807');assert.equal(r.state,'complete');
});
test('initialization captures a validated session before transfer; failures remain uncertain',()=>{
 assert.equal(providerObservation({statusCode:200,headers:{location:yt}},i,now).state,'session_ready');
 assert.equal(providerObservation({statusCode:200,body:{error:{code:'ok'},data:{publish_id:tk.provider_id,upload_url:tt}}},tk,now).provider_id,tk.provider_id);
 assert.equal(providerObservation({statusCode:200,headers:{location:'https://attacker.invalid'}},i,now).state,'uncertain');
 for(const http of [null,{statusCode:503,body:'secret'},{statusCode:302,headers:{location:yt}}])assert.equal(providerObservation(http,i,now).state,'uncertain');
});
test('transfer is never confused with completed publication',()=>{
 assert.equal(providerObservation({statusCode:201},{...tk,operation:'upload'},now).state,'processing');
 assert.equal(providerObservation({statusCode:308,headers:{range:'bytes=0-599'}},{...i,operation:'probe'},now).received_bytes,600);
 assert.equal(providerObservation({statusCode:200,body:{id:'synthetic_1'}},{...i,operation:'upload'},now).state,'processing');
 assert.equal(providerObservation({statusCode:200,body:{items:[]}},{...i,operation:'status',provider_id:'synthetic_1'},now).state,'uncertain');
});
test('binary transfer verifies the full source checksum before slicing',()=>{
 const b=Buffer.from('0000ftyp0000synthetic'),revision='sha256:'+crypto.createHash('sha256').update(b).digest('hex')+':1';
 assert.equal(providerBytes(b,{size_bytes:b.length,binding:{asset_revision:revision}}),b);
 assert.throws(()=>providerBytes(Buffer.concat([b,Buffer.from('x')]),{size_bytes:b.length,binding:{asset_revision:revision}}));
 assert.throws(()=>providerBytes(b,{size_bytes:b.length,binding:{asset_revision:'sha256:'+'f'.repeat(64)+':1'}}));
});
