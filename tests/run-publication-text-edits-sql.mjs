import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite(),id=n=>'ab770000-0000-4000-9000-'+String(n).padStart(12,'0'),uid=id(1),other=id(2),shop='https://sma-automation.com/app/shop.html?shop=fixture';let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
try {
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,service_role;
 create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean default false,demo_delta_aktiv boolean default false,zahlung_bestaetigt boolean default false,shop_slug text,shop_oeffentlich boolean default false);
 grant select on public.sma_kunden to service_role;`);
 for(const file of ['publication-preview','publication-files','publication-caption-history','publication-assignment-history','publication-text-edits'])await db.exec(await readFile(new URL('../supabase/sql/'+file+'.sql',import.meta.url),'utf8'));
 await db.query("insert into public.sma_kunden values(91,$1,'fixture','fixture@example.invalid',true,true,false,'fixture',true),(92,$2,'other','other@example.invalid',true,true,false,'other',true)",[uid,other]);
 const draft=(platform,body)=>({platform,title:'Synthetischer Test',body,hashtags:['Alt','Hotel'],caption:body+'\n\n#Alt #Hotel\n\n🛒 Zum Shop: '+shop,review_notes:[]});
 const ds=[draft('youtube','Ein roter Gegenstand wird im künstlichen Test gezeigt.'),draft('tiktok','Ein Gegenstand kommt in die Tasche.')];
 await db.query("insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview) values($1,$2,91,$3,$4,'completed',$5)",[id(10),uid,JSON.stringify({language:'de',media_kind:'video',platforms:['youtube','tiktok']}),shop,JSON.stringify({can_publish:false,drafts:ds})]);
 await db.query("insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,available,verified_at) values($1,91,$2,'synthetic-video','Synthetic.mp4','video','video/mp4','sha256:'||repeat('a',64)||':1',now(),123,true,now())",[id(20),uid]);
 await db.query("insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft) values($1,'youtube',$2,1,'sha256:'||repeat('a',64)||':1',$3)",[id(20),id(10),JSON.stringify(ds[0])]);
 const state=async()=>(await db.query('select (select to_jsonb(p) from sma_private.publication_previews_v1 p) as preview,(select to_jsonb(a) from sma_private.publication_assignments_v1 a) as assignment,(select jsonb_agg(h order by revision,platform) from sma_private.publication_caption_history_v1 h) as history,(select jsonb_agg(h order by recorded_at,id) from sma_private.publication_assignment_history_v1 h) as assignments')).rows[0];
 const save=async(patch={},owner=uid)=>{
  const s=await state();const input={asset_id:id(20),asset_revision:s.assignment.asset_revision,platform:'youtube',assignment_revision:s.assignment.revision,title:ds[0].title,body:ds[0].body,...patch};
  await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  try{return (await db.query("select public.sma_publication_files_v1('save',$1) as r",[JSON.stringify(input)])).rows[0].r;}finally{await db.exec('reset role');}
 };
 // Reproduce two forms opened on the same file assignment, including the read before adoption.
 await db.exec('begin');
 const initialRevision=(await state()).assignment.revision;
 const firstTab=await save({assignment_revision:initialRevision,title:'Titel aus Tab eins'});
 eq(firstTab.ok,true);
 const committed=await state(),newBody='Die zweite Fassung zeigt das Produkt im Einsatz.';
 eq((await save({assignment_revision:initialRevision,body:newBody})).code,'ASSIGNMENT_CONFLICT');eq(await state(),committed);
 await db.exec('set role authenticated');
 const latest=(await db.query("select public.sma_publication_files_v1('get',$1) as r",[JSON.stringify({asset_id:id(20),platform:'youtube'})])).rows[0].r;
 await db.exec('reset role');
 eq(latest.id,id(10));eq(latest.assignment_revision,initialRevision+1);eq(await state(),committed);
 const accepted=await save({assignment_revision:latest.assignment_revision,title:latest.preview.drafts[0].title,body:newBody});
 eq(accepted.ok,true);eq(accepted.preview.drafts[0].title,'Titel aus Tab eins');eq(accepted.preview.drafts[0].body,newBody);
 eq(accepted.assignment_revision,initialRevision+2);await db.exec('rollback');
 const original=await state();const r=await save({hashtags:['Türzubehör','Gadget']});eq(r.ok,true);eq(r.preview.drafts[0].hashtags,['Türzubehör','Gadget']);eq(r.preview.drafts[0].caption,ds[0].body+'\n\n#Türzubehör #Gadget\n\n🛒 Zum Shop: '+shop);eq(r.preview.can_publish,false);
 let s=await state();eq(s.preview.preview.drafts[1],ds[1]);eq(s.assignment.preview_revision,s.preview.revision);eq(s.assignment.draft,r.preview.drafts[0]);eq(s.history.length,original.history.length+2);eq(s.assignments.length,original.assignments.length+1);eq(s.history.filter(h=>h.revision===1),original.history);
 eq((await save()).preview.drafts[0].hashtags,['Türzubehör','Gadget']); // old client omits optional field
 eq((await save({hashtags:[]})).preview.drafts[0].caption,ds[0].body+'\n\n🛒 Zum Shop: '+shop);
 eq((await save({hashtags:['Cafe\u0301','Welt_1','界']})).preview.drafts[0].hashtags,['Café','Welt_1','界']);
 for(const hashtags of [null,{},'Tag',[1],[null],[''],['x'.repeat(51)],['a','b','c','d'],['Test','test'],['Café','Cafe\u0301'],['#tag'],['a b'],['evil.com'],['a/b'],['@a'],['<x>'],['x\u202e']]){
  const before=await state();const result=await save({hashtags});eq(result.code,'INVALID_HASHTAGS');eq(await state(),before);
 }
 const nulBefore=await state();await assert.rejects(()=>save({hashtags:['x\u0000']}),/unsupported Unicode/);checks++;eq(await state(),nulBefore);
 for(const [patch,owner,code] of [[{},other,'FILE_UNAVAILABLE'],[{},'','AUTH_REQUIRED'],[{assignment_revision:0},uid,'ASSIGNMENT_CONFLICT'],[{asset_revision:'changed'},uid,'FILE_CHANGED'],[{body:'Ein fremder Link https://evil.com'},uid,'INVALID_EDIT']]){
  const before=await state();eq((await save(patch,owner)).code,code);eq(await state(),before);
 }
 await db.exec("update sma_private.publication_files_v1 set verified_at=now()-interval '16 minutes'");eq((await save({hashtags:[]})).code,'FILE_REFRESH_REQUIRED');await db.exec('update sma_private.publication_files_v1 set verified_at=now()');
 await db.exec('update public.sma_kunden set aktiv=false where id=91');eq((await save()).code,'ACCESS_INACTIVE');await db.exec('update public.sma_kunden set aktiv=true where id=91');
 // General preview save validates all portals before committing any of them.
 const generic=async(tags2)=>{
  const before=await state();await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  try{return (await db.query("select public.sma_publication_preview_v1('save',$1,$2) as r",[JSON.stringify({revision:before.preview.revision,drafts:ds.map((d,i)=>({...d,hashtags:i?tags2:[]}))}),id(10)])).rows[0].r;}finally{await db.exec('reset role');}
 };
 const before=await state();eq((await generic(['bad#tag'])).code,'INVALID_HASHTAGS');eq(await state(),before);
 const direct=await generic(['Neu']);eq(direct.ok,true);eq(direct.preview.drafts[0].hashtags,[]);eq(direct.preview.drafts[1].hashtags,['Neu']);eq(direct.preview.drafts[1].caption.endsWith(shop),true);
 // A direct template edit leaves a prior file assignment stale rather than silently rebinding it.
 eq((await save()).code,'REVISION_CONFLICT');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(()=>db.query('select * from sma_private.publication_previews_v1'),/permission denied/);checks++;await db.exec('reset role');
 }
 eq((await db.query("select prosecdef,proconfig from pg_proc where oid='public.sma_publication_files_v1(text,jsonb)'::regprocedure")).rows[0].prosecdef,false);
 console.log(checks+' publication text edit SQL checks passed.');
}catch(e){console.error(e.message,e.where||'',e.detail||'');process.exitCode=1;}finally{await db.close();}
