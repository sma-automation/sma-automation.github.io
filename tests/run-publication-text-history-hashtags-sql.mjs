import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite(),id=n=>'ab112000-0000-4000-9000-'+String(n).padStart(12,'0'),uid=id(1),other=id(2),shop='https://sma-automation.com/app/shop.html?shop=fixture';let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;},sql=async name=>readFile(new URL('../supabase/sql/'+name+'.sql',import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role;
 create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);
 grant select on public.sma_kunden to service_role;`);
 for(const name of ['publication-preview','publication-files','publication-caption-history','publication-assignment-history','publication-text-edits','publication-text-history'])await db.exec(await sql(name));
 await db.query("insert into public.sma_kunden values(91,$1,'fixture','fixture@example.invalid',true,true,false,'fixture',true),(92,$2,'other','other@example.invalid',true,true,false,'other',true)",[uid,other]);
 const drafts=[{platform:'youtube',title:'Testtitel',body:'Ein roter Gegenstand wird in einer Tasche verstaut.',hashtags:['Alt'],caption:'Testcaption',review_notes:[]},{platform:'tiktok',title:'Testtitel',body:'Eine Tasche dient als Aufbewahrung für den Gegenstand.',hashtags:['Unverändert'],caption:'Testcaption',review_notes:[]}];
 const preview=async(n,owner=uid,customer=91)=>db.query("insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview) values($1,$2,$3,$4,$5,'completed',$6)",[id(n),owner,customer,JSON.stringify({language:'de',media_kind:'video',platforms:['youtube','tiktok']}),shop,JSON.stringify({can_publish:false,drafts})]);
 await preview(10);
 await db.query("insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,available,verified_at) values($1,91,$2,'fixture-video','Test.mp4','video','video/mp4','r1',now(),123,true,now())",[id(20),uid]);
 await db.query("insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft) values($1,'youtube',$2,1,'r1',$3)",[id(20),id(10),JSON.stringify(drafts[0])]);
 const roleCall=async(query,args=[],owner=uid)=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return (await db.query(query,args)).rows[0].r;}finally{await db.exec('reset role');}};
 const read=(input={month:null},owner=uid)=>roleCall('select public.sma_publication_text_history_v1($1) as r',[JSON.stringify(input)],owner);
 const history=async()=>(await db.query('select * from sma_private.publication_caption_history_v1 order by preview_id,revision,platform')).rows;
 const before=await history(),beforeRead=await read();
 await db.exec(await sql('publication-text-history-hashtags'));
 eq((await history()).map(({hashtags,...row})=>row),before);eq((await history()).map(x=>x.hashtags),[null,null]);
 const afterRead=await read();eq({...afterRead,entries:afterRead.entries.map(({hashtags,...row})=>row)},beforeRead);
 const save=async patch=>{const a=(await db.query('select * from sma_private.publication_assignments_v1 where asset_id=$1',[id(20)])).rows[0];return roleCall("select public.sma_publication_files_v1('save',$1) as r",[JSON.stringify({asset_id:id(20),asset_revision:'r1',platform:'youtube',assignment_revision:a.revision,title:drafts[0].title,body:drafts[0].body,...patch})]);};
 const tagsAt=async revision=>(await history()).filter(h=>h.preview_id===id(10)&&h.revision===revision).map(h=>({platform:h.platform,tags:h.hashtags}));
 const saved=await save({hashtags:['Café','Welt_1','界']});eq(saved.ok,true);eq(saved.preview.can_publish,false);
 eq(await tagsAt(2),[{platform:'tiktok',tags:['Unverändert']},{platform:'youtube',tags:['Café','Welt_1','界']}]);
 eq((await history()).filter(h=>h.revision===1).map(({hashtags,...row})=>row),before);
 eq((await save({})).ok,true);eq(await tagsAt(3),await tagsAt(2)); // Legacy client preserves current tags.
 eq((await save({hashtags:[]})).ok,true);eq((await tagsAt(4)).find(h=>h.platform==='youtube').tags,[]);
 eq((await read()).entries.find(e=>e.revision===2&&e.platform==='youtube').hashtags,['Café','Welt_1','界']);
 // Invalid saves leave both preview and history unchanged, even across portals.
 for(const hashtags of [null,[1],['a','A'],['<script>'],['x'.repeat(51)]]){const snapshot=await history();eq((await save({hashtags})).code,'INVALID_HASHTAGS');eq(await history(),snapshot);}
 // Future initial generations are recorded too; unrelated owners stay isolated.
 await preview(11,other,92);eq((await read({},other)).entries.length,2);eq((await read()).entries.some(e=>e.preview_id===id(11)),false);
 await db.query('update sma_private.publication_previews_v1 set user_id=$1 where id=$2',[uid,id(11)]);eq((await read({},other)).entries.length,0);eq((await read()).entries.some(e=>e.preview_id===id(11)),false);
 // Same revision cannot overwrite its snapshot; current content is never substituted.
 const frozen=await history();await db.query("update sma_private.publication_previews_v1 set preview=jsonb_set(preview,'{drafts,0,hashtags}','[\"Today\"]') where id=$1",[id(10)]);eq(await history(),frozen);
 for(let n=0;n<10;n++)eq((await save({hashtags:['Tag'+n]})).ok,true);
 const page=await read(),next=await read({month:null,...page.next});eq(page.entries.length,20);eq(page.total,28);eq(next.entries.length,8);
 eq(new Set([...page.entries,...next.entries].map(e=>[e.preview_id,e.revision,e.platform].join(':'))).size,28);
 eq(page.entries.every(e=>Object.hasOwn(e,'hashtags')),true);eq(next.entries.filter(e=>e.revision===1).map(e=>e.hashtags),[null,null]);
 const currentMonth=(await db.query("select to_char(now() at time zone 'Europe/Vienna','YYYY-MM') as m")).rows[0].m;
 eq((await read({month:currentMonth})).total,28);eq((await read({month:'2000-01'})).total,0);eq((await read({month:currentMonth,...page.next})).entries.length,8);
 eq((await read({month:null,before_at:page.next.before_at})).code,'INVALID_INPUT');
 const snapshot=await history();await read();await read({month:currentMonth});eq(await history(),snapshot);
 for(const value of [null,[],['Café','Welt_1','界'],['x'.repeat(50)]])eq((await db.query('select sma_private.publication_history_hashtags_valid_v1($1) as v',[value===null?null:JSON.stringify(value)])).rows[0].v,true);
 for(const value of ['null','{}','1','"tag"','[1]','[null]','[""]','["a","A"]','["a","b","c","d"]',JSON.stringify(['Cafe\u0301']),JSON.stringify(['x'.repeat(51)]),'["a b"]','["<img>"]']){
  await assert.rejects(()=>db.query("insert into sma_private.publication_caption_history_v1(preview_id,revision,customer_id,platform,body,hashtags) values($1,999,91,'youtube','Synthetic invalid record',$2)",[id(99),value]),/hashtags_check/);checks++;
 }
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  for(const query of ["select * from sma_private.publication_caption_history_v1","select sma_private.publication_history_hashtags_valid_v1('[]')","select sma_private.publication_caption_record_v1()",...(role==='authenticated'?[]:['select public.sma_publication_text_history_v1()'])]){await assert.rejects(()=>db.query(query),/permission denied/);checks++;}
  await db.exec('reset role');
 }
 eq((await read({},'')).code,'AUTH_REQUIRED');await db.exec('update public.sma_kunden set aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');
 await db.exec('update public.sma_kunden set aktiv=true,demo_delta_aktiv=false where id=91');eq((await read()).code,'ACCESS_INACTIVE');
 await db.query('update public.sma_kunden set user_id=$1 where id=92',[uid]);eq((await read()).code,'ACCOUNT_UNAVAILABLE');
 const fn=(await db.query("select provolatile,prosecdef,proconfig from pg_proc where oid='sma_private.publication_text_history_read_v1(jsonb)'::regprocedure")).rows[0];eq(fn,{provolatile:'s',prosecdef:true,proconfig:['search_path=""']});
 eq((await db.query("select relrowsecurity from pg_class where oid='sma_private.publication_caption_history_v1'::regclass")).rows[0].relrowsecurity,true);
 console.log(`${checks} historical hashtag SQL checks passed.`);
}finally{await db.close();}
