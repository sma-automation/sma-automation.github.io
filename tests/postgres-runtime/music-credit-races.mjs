// Invoked after the music reservation fixtures in the isolated CI PostgreSQL instance.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function checkCreditRaces({admin,a,b,owner,waiting,pid,uid}){
 await admin.query("alter table public.sma_kunden add column paket text;update public.sma_kunden set paket='alpha',demo_delta_aktiv=false,zahlung_bestaetigt=true where id=91");
 await admin.query(await readFile('supabase/sql/music-credits.sql','utf8'));
 const hash=i=>i.toString(16).padStart(64,'0');
 for(let n=1;n<=11;n++){
  await admin.query("insert into sma_private.music_catalog_v1(sha256,name,mime_type,size_bytes,listed) values($1,'Fixture','audio/wav',1234,true)",[hash(n)]);
  await admin.query("insert into storage.objects values('sma-katalog',$1,$2)",[hash(n)+'.wav',{size:1234,mimetype:'audio/wav'}]);
 }
 const rpc=async(c,action,input={})=>(await c.query('select public.sma_music_credits_v1($1,$2) r',[action,input])).rows[0].r;
 await owner(a);const order=await rpc(a,'start');await a.query('commit');
 const receipt={id:'tr_fixture',amount:{value:'10.00',currency:'EUR'},mode:'live',status:'paid',metadata:{product:'sma-music-10-v1',order:order.id}};
 const confirm=c=>c.query('select public.sma_music_pack_receipt_v1($1,$2) r',[order.id,receipt]);
 await a.query('begin');await confirm(a);const replay=confirm(b);await waiting(pid);await a.query('commit');await replay;
 await owner(a);assert.equal((await rpc(a,'overview')).credits,10);
 for(let n=1;n<=9;n++)assert.equal((await rpc(a,'unlock',{sha256:hash(n)})).ok,true);
 await a.query('commit');
 await owner(a);await owner(b);
 assert.equal((await rpc(a,'unlock',{sha256:hash(10)})).ok,true);
 const last=rpc(b,'unlock',{sha256:hash(11)});await waiting(pid);await a.query('commit');
 assert.equal((await last).code,'INSUFFICIENT_CREDITS');
 assert.equal((await rpc(b,'unlock',{sha256:hash(10)})).ok,true);
 assert.equal((await rpc(b,'overview')).credits,0);await b.query('commit');
 assert.equal((await admin.query('select count(*)::int n from sma_private.music_track_unlocks_v1 where user_id=$1',[uid])).rows[0].n,10);
 console.log('Concurrent paid callbacks credit one pack; competing unlocks spend the last credit exactly once.');
}
