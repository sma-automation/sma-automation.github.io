import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const uid='ab660000-0000-4000-8000-000000000091',other='ab660000-0000-4000-8000-000000000092';
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema sma_private;grant usage on schema sma_private,auth to authenticated;"+
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;"+
 "create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);");
 await db.exec(await readFile(new URL('./sql-runtime/publication-history-fixture.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/sql/publication-history.sql',import.meta.url),'utf8'));
 await db.query('insert into public.sma_kunden values(91,$1,true,true,false),(92,$2,true,false,true)',[uid,other]);
 const read=async(input={},owner=uid)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return (await db.query('select public.sma_publication_history_v1($1) as r',[JSON.stringify(input)])).rows[0].r;}finally{await db.exec('reset role');}};
 const insert=async(n,{owner=uid,customer=91,state='checked',platform='youtube',visibility='public'}={})=>db.query(`insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,state,created_at,updated_at,account_check) values($1,$2,$3,$4,$5,$6,$7,$8,'2026-11-06T12:00:00Z','2026-11-06T12:01:00Z',$9)`,[id(n),owner,customer,{platform,asset_id:'not-exposed'},{title:'<script>fixture</script>',secret:'not-exposed'},{visibility},{id:'target-private-id',name:'Fixture channel',secret:'not-exposed'},state,{display_name:'Verified fixture channel'}]);
 eq(await read(),{ok:true,version:1,entries:[],has_more:false,next:null});
 eq((await read({},'')).code,'AUTH_REQUIRED');eq((await read({},id(500))).code,'ACCOUNT_UNAVAILABLE');
 for(const input of [null,[],false,'x',{user_id:other},{before_id:id(1)},{before_at:'2026-11-06T12:00:00Z'},{before_at:'2026-99-99T00:00:00Z',before_id:id(1)},{before_at:'infinity',before_id:id(1)}])eq((await read(input)).code,'INVALID_INPUT');
 for(let n=1;n<=23;n++)await insert(n);
 await insert(24,{owner:other,customer:92});await insert(25,{owner:uid,customer:92});await insert(26,{owner:other,customer:91});
 const first=await read();eq(first.entries.length,20);eq(first.entries.map(e=>e.id),Array.from({length:20},(_,i)=>id(23-i)));eq(first.has_more,true);
 const second=await read(first.next);eq(second.entries.map(e=>e.id),[id(3),id(2),id(1)]);eq(second.has_more,false);eq(second.next,null);
 eq((await read({},other)).entries.map(e=>e.id),[id(24)]);
 eq(Object.keys(first.entries[0]).sort(),['id','platform','title','target_name','status','created_at','updated_at'].sort());
 eq(JSON.stringify(first).includes('not-exposed'),false);eq(first.entries[0].status,'checked');
 const fingerprint=()=>db.exec('update sma_private.publication_provider_attempts_v1 a set fingerprint=sma_private.publication_provider_fingerprint_v1(j) from sma_private.publication_orders_v1 j where j.id=a.order_id');
 await db.query(`insert into sma_private.publication_provider_attempts_v1(order_id,fingerprint,platform,target_id,visibility,size_bytes,state,provider_id,session_url) values($1,'bad','youtube','target-private-id','public',100,'complete','fixture_001','SECRET_UPLOAD_URL')`,[id(23)]);
 eq((await read()).entries[0].status,'needs_review');await fingerprint();eq((await read()).entries[0].status,'complete_unknown');
 const receipt={platform:'youtube',target_id:'target-private-id',provider_id:'fixture_001',expected_visibility:'public',route:'youtube_video',state:'complete',can_upload:false,can_publish:false,upload_retry_allowed:false,visibility:'public',url:'https://www.youtube.com/watch?v=fixture_001',publicly_available:true};
 const setResult=async(result)=>db.query('update sma_private.publication_provider_attempts_v1 set result=$1',[result]);
 await setResult(receipt);eq((await read()).entries[0].status,'public_confirmed');
 for(const change of [{target_id:'wrong'},{provider_id:'wrong'},{can_publish:true},{route:'wrong'},{url:'https://evil.example/'},{publicly_available:'true'},{visibility:'private'}]){await setResult({...receipt,...change});eq((await read()).entries[0].status,'complete_unknown');}
 for(const [visibility,status] of [['private','private_complete'],['unlisted','unlisted_complete']]){
  await db.query("update sma_private.publication_orders_v1 set choices=jsonb_build_object('visibility',$1::text) where id=$2",[visibility,id(23)]);
  await db.query('update sma_private.publication_provider_attempts_v1 set visibility=$1',[visibility]);await fingerprint();
  await setResult({...receipt,visibility,expected_visibility:visibility,publicly_available:false});eq((await read()).entries[0].status,status);
 }
 await db.exec("update sma_private.publication_provider_attempts_v1 set platform='tiktok',visibility='PUBLIC_TO_EVERYONE'");
 await db.query("update sma_private.publication_orders_v1 set binding='{"+'"platform":"tiktok"'+"}',choices='{"+'"visibility":"PUBLIC_TO_EVERYONE"'+"}' where id=$1",[id(23)]);await fingerprint();
 const tt={...receipt,platform:'tiktok',route:'direct_post',expected_visibility:'PUBLIC_TO_EVERYONE',public_post_ids:['123456789'],publicly_available:true};delete tt.url;delete tt.visibility;
 await setResult(tt);eq((await read()).entries[0].status,'public_confirmed');
 for(const change of [{public_post_ids:[]},{public_post_ids:['evil']},{public_post_ids:[123]},{public_post_ids:null},{publicly_available:null}]){await setResult({...tt,...change});eq((await read()).entries[0].status,'complete_unknown');}
 for(const [visibility,status] of [['SELF_ONLY','private_complete'],['MUTUAL_FOLLOW_FRIENDS','limited_complete'],['FOLLOWER_OF_CREATOR','limited_complete']]){
  await db.query("update sma_private.publication_orders_v1 set choices=jsonb_build_object('visibility',$1::text) where id=$2",[visibility,id(23)]);
  await db.query('update sma_private.publication_provider_attempts_v1 set visibility=$1',[visibility]);await fingerprint();
  await setResult({...tt,expected_visibility:visibility,publicly_available:false,public_post_ids:[]});eq((await read()).entries[0].status,status);
 }
 for(const state of ['reserved','session_ready','uploading','processing','failed','uncertain','needs_review']){await db.query('update sma_private.publication_provider_attempts_v1 set state=$1',[state]);eq((await read()).entries[0].status,['reserved','session_ready'].includes(state)?'pending':state);}
 const snapshot=async()=>(await db.query("select (select jsonb_agg(j order by id) from sma_private.publication_orders_v1 j) as orders,(select jsonb_agg(a order by order_id) from sma_private.publication_provider_attempts_v1 a) as attempts,(select count(*)::int from sma_private.publication_provider_permissions_v1) as permissions")).rows[0];
 const before=await snapshot();await read();await read(first.next);eq(await snapshot(),before);
 await db.exec('update public.sma_kunden set aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');
 await db.exec('update public.sma_kunden set aktiv=true,demo_delta_aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');
 await db.query('update public.sma_kunden set user_id=$1 where id=92',[uid]);eq((await read()).code,'ACCOUNT_UNAVAILABLE');
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  for(const query of [...(role!=='service_role'?['select * from sma_private.publication_orders_v1']:[]),'select sma_private.publication_history_entry_v1(null)',...(role!=='authenticated'?['select public.sma_publication_history_v1()']:[])]){
   let denied=false;try{await db.exec(query);}catch{denied=true;}eq(denied,true);
  }await db.exec('reset role');
 }
 const functions=(await db.query("select p.provolatile,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='sma_publication_history_v1' and n.nspname='public'")).rows;
 eq(functions,[{provolatile:'s',prosecdef:false}]);
 console.log(`${checks} history SQL checks passed: tenant isolation, pagination, conservative receipts, access control, unchanged journals.`);
}catch(e){console.error(e.message,e.where||'');process.exitCode=1;}finally{await db.close();}
