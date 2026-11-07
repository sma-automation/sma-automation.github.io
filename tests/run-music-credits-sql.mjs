import assert from 'node:assert/strict';
import {createPackHandler} from '../supabase/functions/sma-music-credit-pack/handler.mjs';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const uid=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
const hash=n=>n.toString(16).padStart(64,'0');
let checks=0;
function eq(a,b){assert.deepEqual(a,b);checks++;}
async function user(n,action,input={}){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);
 await db.exec('set role authenticated');
 try{return (await db.query('select public.sma_music_credits_v1($1,$2) r',[action,input])).rows[0].r;}
 finally{await db.exec('reset role');}
}
const receipt=(id,patch={})=>({id:'tr_fixture123',status:'paid',mode:'live',amount:{currency:'EUR',value:'10.00'},metadata:{product:'sma-music-10-v1',order:id},...patch});
async function record(id,patch){
 await db.exec('set role service_role');
 try{return (await db.query('select public.sma_music_pack_receipt_v1($1,$2) r',[id,receipt(id,patch)])).rows[0].r;}
 finally{await db.exec('reset role');}
}
async function objects(n){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid(n)]);
 await db.exec('set role authenticated');
 try{return (await db.query("select count(*)::int n from storage.objects where bucket_id='sma-katalog'")).rows[0].n;}
 finally{await db.exec('reset role');}
}
try{
 await db.exec(await readFile('tests/sql-runtime/music-library-fixture.sql','utf8'));
 await db.exec('grant usage on schema sma_private to service_role;alter table public.sma_kunden add column paket text;');
 await db.exec(await readFile('supabase/sql/music-credits.sql','utf8'));
 for(const [n,pkg] of [[1,'Alpha'],[2,'beta'],[3,'Delta'],[4,'unknown']]){
  await db.query('insert into public.sma_kunden values($1,$2,true,false,true,$3)',[n,uid(n),pkg]);
 }
 eq((await user(1,'start')).code,'CATALOG_EMPTY');
 for(let n=1;n<=11;n++){
  await db.query('insert into sma_private.music_catalog_v1(sha256,name,mime_type,size_bytes,listed) values($1,$2,\'audio/wav\',1200,true)',[hash(n),'Stück '+n]);
  await db.query("insert into storage.objects values('sma-katalog',$1,$2)",[hash(n)+'.wav',{size:1200,mimetype:'audio/wav'}]);
 }
 eq((await user(1,'overview')).tracks.length,11);eq((await user(1,'overview')).credits,0);
 eq((await user(4,'overview')).code,'ACCESS_INACTIVE');eq(await objects(1),0);eq(await objects(3),11);
 eq((await user(3,'unlock',{sha256:hash(1)})).ok,true);eq((await user(3,'start')).ok,false);
 eq((await user(2,'unlock',{sha256:hash(1)})).code,'INSUFFICIENT_CREDITS');
 const id=(await user(1,'start')).id;eq((await user(1,'start')).id,id);
 for(const patch of [{id:'invalid'},{mode:'test'},{status:'other'},{metadata:{product:'membership',order:id}},{amount:{currency:'EUR',value:'100.00'}},{amount:{currency:'USD',value:'10.00'}}]){
  eq((await record(id,patch)).ok,false);
 }
 for(const status of ['open','pending','authorized']){eq((await record(id,{status})).state,'open');eq((await user(1,'overview')).credits,0);}
 eq((await record(id,{})).state,'paid');eq((await record(id,{})).state,'paid');eq((await user(1,'overview')).credits,10);
 eq((await record(id,{status:'open'})).state,'paid');eq((await record(id,{id:'tr_wrong'})).ok,false);
 eq((await user(2,'overview')).credits,0);eq((await user(1,'unlock',{sha256:hash(1)})).ok,true);
 eq((await user(1,'unlock',{sha256:hash(1)})).ok,true);eq((await user(1,'overview')).credits,9);
 eq(await objects(1),1);eq(await objects(2),0);
 for(let n=2;n<=10;n++)eq((await user(1,'unlock',{sha256:hash(n)})).ok,true);
 eq((await user(1,'unlock',{sha256:hash(11)})).code,'INSUFFICIENT_CREDITS');
 const second=(await user(1,'start')).id;eq((await record(second,{})).ok,false);
 eq((await record(second,{id:'tr_fixture456'})).state,'paid');eq((await user(1,'overview')).credits,10);
 eq((await record(id,{amountRefunded:{currency:'EUR',value:'10.00'}})).state,'reversed');
 eq((await record(id,{})).state,'reversed');eq(await objects(1),0);eq((await user(1,'unlock',{sha256:hash(1)})).ok,true);
 eq((await user(1,'overview')).credits,9);eq(await objects(1),1);
 eq((await db.query('select count(*)::int n from sma_private.music_track_unlocks_v1 where customer_id=1 and track_sha256=$1',[hash(1)])).rows[0].n,2);
 await db.exec("update public.sma_kunden set paket='delta' where id=1");
 eq(await objects(1),11);eq((await user(1,'overview')).credits,9);
 await db.exec("update public.sma_kunden set paket='beta' where id=1");
 eq(await objects(1),1);
 await db.exec("update public.sma_kunden set aktiv=false where id=1");
 eq(await objects(1),0);eq((await user(1,'overview')).code,'ACCESS_INACTIVE');
 // Browser → trusted order → hosted checkout → webhook → usable credit, all with synthetic transport.
 const base='https://sma.example.test/functions/v1/sma-music-credit-pack';
 let state='open',callback,packId,gets=0;
 const service=createPackHandler({enabled:true,endpoint:base,signature:async id=>'fixture-'+id,
  userStart:()=>user(2,'start'),record:async(id,r)=>(await db.query('select public.sma_music_pack_receipt_v1($1,$2) r',[id,r])).rows[0].r,
  mollie:async(method,pid,input,key)=>{
   if(method==='POST'){packId=key;callback=input.webhookUrl;eq(input.amount,{currency:'EUR',value:'10.00'});eq(input.metadata.order,packId);}
   else{eq(pid,'tr_beta123');gets++;}
   return {...receipt(packId),id:'tr_beta123',status:state,_links:{checkout:{href:'https://www.mollie.com/checkout/test'}}};
  }});
 const post=()=>new Request(base,{method:'POST',headers:{Authorization:'Bearer fixture'}});
 eq((await (await service(post())).json()).checkout,'https://www.mollie.com/checkout/test');
 const hook=(url=callback)=>service(new Request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id=tr_beta123&status=paid'}));
 eq((await hook(callback.replace('proof=fixture','proof=bogus'))).status,403);eq(gets,0);
 eq((await hook()).status,200);eq((await user(2,'overview')).credits,0);
 state='paid';eq((await hook()).status,200);eq((await hook()).status,200);
 eq((await user(2,'overview')).credits,10);eq((await user(2,'unlock',{sha256:hash(9)})).ok,true);
 eq((await user(2,'overview')).credits,9);eq(await objects(2),1);
 await db.exec('set role authenticated');
 for(const query of ['select * from sma_private.music_catalog_v1','select * from sma_private.music_credit_packs_v1',
 'select public.sma_music_pack_receipt_v1(null,null)',"insert into storage.objects values('sma-katalog','unexpected','{}')"]){
  await assert.rejects(()=>db.query(query),/permission denied|row-level security/);checks++;
 }
 await db.exec('reset role;set role anon');
 await assert.rejects(()=>db.query("select public.sma_music_credits_v1('overview')"),/permission denied/);checks++;
 console.log(checks+' music credit and catalogue SQL checks passed.');
}finally{await db.close();}
