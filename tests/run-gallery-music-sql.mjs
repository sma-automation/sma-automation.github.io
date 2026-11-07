import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const db=new PGlite(), sql=name=>readFile('supabase/sql/'+name+'.sql','utf8');
const uuid=n=>'f34aa100-0000-4000-9000-'+String(n).padStart(12,'0');
const hash=n=>n.toString(16).padStart(64,'0');
const scalar=async(q,params=[])=>(await db.query(q,params)).rows[0]?.value;
let checks=0;
function eq(actual,expected){assert.deepEqual(actual,expected);checks++;}
async function rpc(owner,action,input={},api='sma_gallery_music_v1'){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uuid(owner)]);
 await db.exec('set role authenticated');
 try{return await scalar('select public.'+api+'($1,$2) as value',[action,input]);}
 finally{await db.exec('reset role');}
}
async function file(n,owner,options={}){
 const {drive='drive_'+n,name='Clip '+n+'.mp4',revision='sha256:'+hash(n)+':1',size=1200}=options;
 await db.query(`insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes)
  values($1,$2,$3,$4,$5,'video','video/mp4',$6,now(),$7)`,[uuid(n),owner,uuid(owner),drive,name,revision,size]);
}
async function track(n){
 await db.query("insert into sma_private.music_catalog_v1(sha256,name,mime_type,size_bytes,listed) values($1,$2,'audio/wav',1200,true)",[hash(n),'Musik '+n]);
 await db.query("insert into storage.objects values('sma-katalog',$1,$2)",[hash(n)+'.wav',{size:1200,mimetype:'audio/wav'}]);
}
const count=()=>scalar('select count(*)::int as value from sma_private.gallery_music_v1');
const expire=id=>db.query("update sma_private.gallery_music_v1 set lease_until=now()-interval '1 minute',next_attempt=now() where id=$1",[id]);
const bound=job=>({id:job.id,lease:job.lease});
async function output(owner,job,n){
 const drive='output_'+n;
 await db.query(`insert into sma_private.publication_uploads_v1(id,user_id,customer_id,n8n_kunde_id,kunde_email,name,mime_type,size_bytes,status,drive_file_id)
 values($1,$2,$3,'sample','fixture@example.test',$4,'video/mp4',2100,'ready',$5)`,[job.id,uuid(owner),owner,job.name,drive]);
 await file(n,owner,{drive,name:job.name,revision:'sha256:'+hash(800)+':1',size:2100});
}
try{
 await db.exec(await readFile('tests/sql-runtime/music-library-fixture.sql','utf8'));
 await db.exec('alter table public.sma_kunden add column paket text');
 for(const [name,delimiter] of [['publication-preview','-- Definer is needed'],['publication-files','-- Metadata precheck'],['publication-device-upload','create or replace function']]){
  await db.exec((await sql(name)).split(delimiter)[0]);
 }
 await db.exec(await sql('music-credits'));
 for(const [n,pkg] of [[1,'Delta'],[2,'Alpha'],[3,'Beta']])await db.query('insert into public.sma_kunden values($1,$2,true,false,true,$3)',[n,uuid(n),pkg]);
 await file(100,1);await db.exec(await sql('gallery-music'));
 eq(await count(),0);eq((await rpc(1,'claim')).state,'idle');
 await db.query("update sma_private.publication_files_v1 set revision=revision||'0' where id=$1",[uuid(100)]);
 eq(await count(),0);
 await file(101,1,{name:'Clip/1.mp4'});await file(102,2);await file(103,3);
 await file(104,1,{size:24000001});eq(await count(),3);
 eq((await rpc(1,'claim')).state,'no_track');
 await track(1);eq((await rpc(2,'claim')).state,'no_track');eq((await rpc(3,'claim')).state,'no_track');
 let job=await rpc(1,'claim');eq(job.state,'claimed');eq(job.name,'Clip 1 – mit SMA-Musik.mp4');eq(job.track.sha256,hash(1));
 eq((await rpc(1,'claim')).state,'busy');eq((await rpc(2,'audio_present',bound(job))).code,'LEASE_CHANGED');
 await expire(job.id);const old=job;job=await rpc(1,'claim');
 eq(job.id,old.id);assert.notEqual(job.lease,old.lease);checks++;
 eq((await rpc(1,'audio_present',bound(old))).code,'LEASE_CHANGED');
 eq((await rpc(1,'audio_present',bound(job))).ok,true);eq((await rpc(1,'claim')).state,'idle');
 await db.query("update sma_private.publication_files_v1 set revision=$1 where id=$2",['sha256:'+hash(101)+':2',uuid(101)]);
 eq(await count(),3);
 await file(105,1);job=await rpc(1,'claim');eq((await rpc(1,'retry',bound(job))).ok,true);
 const wait=await rpc(1,'claim');eq(wait.state,'waiting');assert.ok(wait.retry_ms>0);checks++;
 await expire(job.id);job=await rpc(1,'claim');eq((await rpc(1,'unsupported',bound(job))).ok,true);
 // Use an isolated, synthetic receipt to establish an existing Alpha entitlement.
 const credits=(a,i={})=>rpc(2,a,i,'sma_music_credits_v1');
 const pack=(await credits('start')).id;
 const receipt={id:'tr_fixture123',status:'paid',mode:'live',amount:{currency:'EUR',value:'10.00'},metadata:{product:'sma-music-10-v1',order:pack}};
 eq((await scalar('select public.sma_music_pack_receipt_v1($1,$2) as value',[pack,receipt])).state,'paid');
 eq((await rpc(2,'claim')).state,'no_track');eq((await credits('unlock',{sha256:hash(1)})).ok,true);
 eq((await credits('overview')).credits,9);
 const reservation={sha256:hash(800),size_bytes:2100};
 job=await rpc(2,'claim');eq(job.file.id,uuid(102));
 eq((await rpc(2,'reserve',{...bound(job),size_bytes:-1})).code,'INVALID_OUTPUT');
 eq((await rpc(2,'reserve',{...bound(job),...reservation})).ok,true);
 eq((await rpc(2,'reserve',{...bound(job),...reservation,sha256:hash(801)})).code,'OUTPUT_CHANGED');
 eq((await rpc(2,'complete',bound(job))).code,'UPLOAD_INCOMPLETE');
 const before=await count();await output(2,job,106);eq(await count(),before);
 await db.query("update sma_private.publication_uploads_v1 set asset_id=$1,status='completed' where id=$2",[uuid(106),job.id]);
 eq((await rpc(2,'complete',bound(job))).asset_id,uuid(106));eq((await rpc(2,'claim')).state,'idle');
 eq((await credits('overview')).credits,9);eq((await rpc(3,'claim')).state,'no_track');
 // Recover a verified upload if the browser closed before its last acknowledgement.
 await file(107,1);job=await rpc(1,'claim');eq((await rpc(1,'reserve',{...bound(job),...reservation})).ok,true);
 await output(1,job,108);await expire(job.id);
 eq((await rpc(1,'claim')).asset_id,uuid(108));eq((await rpc(1,'claim')).state,'idle');
 await file(109,1);job=await rpc(1,'claim');eq((await rpc(1,'reserve',{...bound(job),...reservation})).ok,true);
 await expire(job.id);await track(2);await db.query('update sma_private.music_catalog_v1 set listed=false where sha256=$1',[job.track.sha256]);
 await file(110,1);eq((await rpc(1,'claim')).state,'deferred');const other=await rpc(1,'claim');eq(other.file.id,uuid(110));eq(other.track.sha256,hash(2));
 await db.query("update sma_private.publication_files_v1 set available=false where id=$1",[other.file.id]);
 eq((await rpc(1,'reserve',{...bound(other),...reservation})).code,'SOURCE_CHANGED');
 eq((await rpc(4,'claim')).code,'ACCESS_INACTIVE');
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select * from sma_private.gallery_music_v1'),/permission denied/);checks++;
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query("select public.sma_gallery_music_v1('claim')"),/permission denied/);checks++;
 console.log(checks+' gallery music SQL checks passed.');
}finally{await db.close();}
