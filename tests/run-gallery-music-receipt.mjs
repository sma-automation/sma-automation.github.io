// The only substitutes are Drive's transport and Supabase Storage's bytes.
// The application muxer, n8n verification helpers and SQL reservations run unchanged.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import makeCore from './media-runtime/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js';
import {createGalleryMusicWorker} from '../app/assets/gallery-music-worker.mjs';
import {soundtrackInEngine} from '../app/assets/gallery-music-render.mjs';
import {transferDeviceFile} from '../app/assets/device-upload.mjs';
import {createCatalogAPI} from '../app/assets/music-catalog.mjs';
import {editorSourceMetadata,editorSourceBytes} from '../n8n/publishing/editor-source.cjs';
import {verifiedFolders,catalogFiles} from '../n8n/publishing/file-catalog.cjs';

const hash=data=>createHash('sha256').update(data).digest('hex');
const db=new PGlite(), readSQL=name=>readFile('supabase/sql/'+name+'.sql','utf8');
const value=async(query,params=[])=>(await db.query(query,params)).rows[0]?.value;
const uid=randomUUID(),email='test@example.invalid',folder='fixture_processing',customer='fixture_customer';
const row={kunde_id:customer,kunde_email:email,zugang_aktiv:true,demo_delta_aktiv:true,upload_folder_id:'fixture_incoming',processing_folder_id:folder};
const folders=verifiedFolders([row],{ok:true,n8n_kunde_id:customer,kunde_email:email}).folders;
const drive=new Map();
const info=(id,name,bytes,extra={})=>({id,name,trashed:false,capabilities:{canDownload:true},parents:[folder],mimeType:'video/mp4',
 size:String(bytes.length),sha256Checksum:hash(bytes),version:'1',modifiedTime:'2026-11-07T12:00:00Z',...extra});
async function as(role,query,params){
 await db.exec('set role '+role);
 try{return await value(query,params);}finally{await db.exec('reset role');}
}
const gallery=(action,input={})=>as('authenticated','select public.sma_gallery_music_v1($1,$2) as value',[action,input]);
const credits=(action,input={})=>as('authenticated','select public.sma_music_credits_v1($1,$2) as value',[action,input]);
const uploadRPC=(action,input)=>as('authenticated','select public.sma_publication_upload_v1($1,$2) as value',[action,input]);
async function sync(){
 const lease=randomUUID();
 await db.query(`insert into sma_private.publication_file_sync_v1(user_id,customer_id,n8n_kunde_id,kunde_email,lease_id,lease_until,started_at)
  values($1,1,$2,$3,$4,now()+interval '1 minute',now()) on conflict(user_id) do update
  set lease_id=excluded.lease_id,lease_until=excluded.lease_until,started_at=excluded.started_at`,[uid,customer,email,lease]);
 const files=catalogFiles({files:[...drive.values()].reverse().map(v=>v.meta)},folders);
 const result=await as('service_role','select public.sma_publication_files_finish_v1($1,$2,$3) as value',[uid,lease,JSON.stringify(files)]);
 assert.equal(result.ok,true);
}

globalThis.self={location:{href:'file:///worker.js'}};
const wasm=new URL('./media-runtime/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm',import.meta.url);
const core=await makeCore({wasmBinary:await readFile(wasm),mainScriptUrlOrBlob:'file:///core.js#'+btoa(JSON.stringify({wasmURL:'file:///core.wasm'}))});
const exec=args=>{core.setTimeout(45000);core.exec('-y',...args);const result=core.ret;core.reset();return result;};
const ffmpeg={exec,writeFile:(name,data)=>core.FS.writeFile(name,data),readFile:name=>core.FS.readFile(name)};
const probe=async name=>{
 core.ffprobe('-v','error','-show_streams','-show_format','-of','json','-o','report.json',name);core.reset();
 const result=JSON.parse(core.FS.readFile('report.json',{encoding:'utf8'}));core.FS.unlink('report.json');return result;
};
const run=args=>assert.equal(exec(['-v','error',...args]),0);
const encodedVideoHash=name=>{
 run(['-i',name,'-map','0:v:0','-c:v','copy','-f','hash','video.sha']);
 return core.FS.readFile('video.sha',{encoding:'utf8'});
};
let worker;
try{
 await db.exec(await readFile('tests/sql-runtime/music-library-fixture.sql','utf8'));
 await db.exec('alter table public.sma_kunden add column paket text,add column n8n_kunde_id text,add column kunde_email text;grant select on public.sma_kunden to service_role;');
 await db.exec((await readSQL('publication-preview')).split('-- Definer is needed')[0]);
 await db.exec((await readSQL('publication-files')).split('-- Metadata precheck')[0]);
 for(const n of ['publication-device-upload','publication-asset-preview','music-credits','gallery-music','gallery-music-receipt'])await db.exec(await readSQL(n));
 await db.query("insert into public.sma_kunden values(1,$1,true,false,true,'Alpha',$2,$3)",[uid,customer,email]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);

 run(['-f','lavfi','-i','color=c=blue:s=160x240:r=24:d=3','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','silent.mp4']);
 const original=process.argv[2]?await readFile(process.argv[2]):Buffer.from(ffmpeg.readFile('silent.mp4'));
 ffmpeg.writeFile('original',original);
 const videoHash=encodedVideoHash('original'),duration=Number((await probe('original')).streams[0].duration);
 run(['-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=1','-c:a','pcm_s16le','music.wav']);
 const track=Buffer.from(ffmpeg.readFile('music.wav')),trackSha=hash(track);
 await db.query("insert into sma_private.music_catalog_v1(sha256,name,mime_type,size_bytes,listed) values($1,'Testmusik','audio/wav',$2,true)",[trackSha,track.length]);
 await db.query("insert into storage.objects values('sma-katalog',$1,$2)",[trackSha+'.wav',{size:track.length,mimetype:'audio/wav'}]);
 drive.set('fixture_source',{meta:info('fixture_source','Clip.mp4',original),bytes:original});
 await sync();assert.equal((await gallery('claim')).state,'no_track');
 const order=(await credits('start')).id;
 const receipt={id:'tr_fixture123',status:'paid',mode:'live',amount:{currency:'EUR',value:'10.00'},metadata:{product:'sma-music-10-v1',order}};
 await as('service_role','select public.sma_music_pack_receipt_v1($1,$2) as value',[order,receipt]);
 assert.equal((await credits('unlock',{sha256:trackSha})).ok,true);
 assert.equal((await credits('overview')).credits,9);
 const catalog=createCatalogAPI({owner:uid,getSession:async()=>({user:{id:uid},access_token:'fixture'}),request:async(url)=>{
  assert.ok(url.endsWith('/sma-katalog/'+trackSha+'.wav'));
  const allowed=await as('authenticated',"select count(*)::int as value from storage.objects where bucket_id='sma-katalog' and name=$1",[trackSha+'.wav']);
  assert.equal(allowed,1);return new Response(track,{headers:{'Content-Type':'audio/wav'}});
 }});
 let resultBytes,renderCount=0,uploads=0,claim;
 worker=createGalleryMusicWorker({
  rpc:async(action,input)=>{const r=await gallery(action,input);if(r.state==='claimed')claim=r;return r;},
  source:async file=>{
   const ctx=await as('authenticated','select public.sma_publication_asset_preview_v1($1,$2) as value',[file.id,file.revision]);
   const stored=drive.get(ctx.drive_file_id);
   const data=editorSourceBytes(stored.bytes,ctx,editorSourceMetadata(stored.meta,ctx,folders));
   return new Blob([Buffer.from(data.data_base64,'base64')],{type:data.mime_type});
  },
  loadTrack:catalog.source,render:async input=>{renderCount++;return soundtrackInEngine(ffmpeg,probe,input);},
  upload:async(blob,artifact,signal)=>{
   uploads++;
   const u=await uploadRPC('start',{...artifact,size_bytes:blob.size});
   assert.equal(u.status,'initializing');
   const url='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fixture';
   const bound=await as('service_role','select public.sma_publication_upload_bind_v1($1,$2,$3,$4,$5) as value',[u.upload_id,u.lease_id,'fixture_output',folder,url]);
   assert.equal(bound.status,'ready');
   const parts=[];
   await transferDeviceFile({file:blob,url,mime:'video/mp4',signal,fetcher:async(_,options)=>{
    if(options.headers['Content-Range'].startsWith('bytes */'))return new Response(null,{status:308});
    parts.push(Buffer.from(await options.body.arrayBuffer()));return new Response(null,{status:201});
   }});
   resultBytes=Buffer.concat(parts);
   drive.set('fixture_output',{meta:info('fixture_output',u.name,resultBytes),bytes:resultBytes});
   // The byte transfer is done, but the page closes before either finish call.
   worker.destroy();throw Error('closed');
  },onStatus:()=>{},onComplete:()=>assert.fail('Client already gone')
 });
 await worker.wake();assert.equal(uploads,1);assert.equal(renderCount,1);
 const state=()=>value('select state as value from sma_private.gallery_music_v1 where id=$1',[claim.id]);
 assert.equal(await state(),'pending');
 const stored=drive.get('fixture_output'),correct={...stored.meta};
 for(const patch of [{sha256Checksum:'0'.repeat(64)},{size:String(resultBytes.length+1)},{name:'Other.mp4'}]){
  stored.meta={...correct,...patch};await sync();assert.equal(await state(),'pending');
 }
 stored.meta=correct;
 // The source
 // changed in the meantime, so the new file must not complete this source revision.
 const sourceMeta=drive.get('fixture_source').meta;
 drive.get('fixture_source').meta={...sourceMeta,sha256Checksum:'1'.repeat(64)};
 await sync();assert.equal(await state(),'pending');
 drive.get('fixture_source').meta=sourceMeta;
 await sync();assert.equal(await state(),'completed');
 const ack={id:claim.id,lease:claim.lease};
 const answer=await gallery('complete',ack);assert.equal(answer.state,'completed');
 assert.equal((await gallery('complete',ack)).asset_id,answer.asset_id);
 assert.equal((await gallery('complete',{...ack,lease:randomUUID()})).code,'LEASE_CHANGED');
 assert.equal((await gallery('claim')).state,'idle');await sync();
 assert.equal(await value('select count(*)::int as value from sma_private.gallery_music_v1 where result_id is not null'),1);
 assert.equal(await value('select count(*)::int as value from sma_private.publication_files_v1'),2);
 assert.equal((await credits('overview')).credits,9);
 ffmpeg.writeFile('saved',resultBytes);
 assert.equal(encodedVideoHash('saved'),videoHash);
 const audio=(await probe('saved')).streams.find(s=>s.codec_type==='audio');
 assert.equal(audio.codec_name,'aac');assert.ok(Math.abs(Number(audio.duration)-duration)<0.05);
 const verifiedFile={...catalogFiles({files:[correct]},folders)[0],folder_id:folder,upload_id:claim.id};
 const serviceFinish=await as('service_role','select public.sma_publication_upload_finish_v1($1,$2) as value',[claim.id,verifiedFile]);
 assert.equal(serviceFinish.asset_id,answer.asset_id);assert.equal(serviceFinish.can_publish,false);
 assert.equal(await value('select upload_url is null as value from sma_private.publication_uploads_v1 where id=$1',[claim.id]),true);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
 assert.equal((await gallery('complete',ack)).ok,false);
 console.log('Full gallery receipt: one music version after closed tab; repeated receipt and sync are idempotent; 9 credits; identical video packets; AAC '+audio.duration+' s.');
}finally{worker?.destroy();await db.close();}
