// Real order, account, worker and provider-journal functions. Synthetic media
// evidence and comparison projection only; no network or hosted database writes.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();let n=0;const eq=(a,b)=>{assert.deepEqual(a,b);n++;};
const id=k=>'ab660000-0000-4000-9000-'+String(k).padStart(12,'0'),uid=id(91),other=id(92),rev='sha256:'+'a'.repeat(64)+':2';
const src=f=>readFile(new URL('../supabase/sql/'+f+'.sql',import.meta.url),'utf8');
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated,service_role;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);grant select on public.sma_kunden to service_role;");
 for(const file of ['publication-preview','publication-files','publication-media-precheck','publication-content-review','publication-magic-effect','publication-video-technical','publication-video-magic','publication-media-profiles','publication-accounts','publication-orders'])await db.exec(await src(file));
 for(const f of JSON.parse(await readFile(new URL('sql-runtime/manual-review-live-baseline.json',import.meta.url),'utf8')))await db.exec(f.definition);
 await db.exec(await readFile(new URL('sql-runtime/provider-cover-pr57-journal.sql',import.meta.url),'utf8'));
 const sql=await src('publication-manual-review');eq(sql,await readFile(new URL('../supabase/migrations/20261106221606_publication_manual_media_review_v1.sql',import.meta.url),'utf8'));
 await db.exec(sql);
 await assert.rejects(()=>db.exec(sql),/MANUAL_REVIEW_BASELINE_CHANGED/);n++;
 // External byte/analysis evidence is supplied by the isolated fixture.
 await db.exec("create table sma_private.manual_fixture(m jsonb);grant select on sma_private.manual_fixture to service_role;create or replace function sma_private.publication_order_current_v1(j sma_private.publication_orders_v1) returns jsonb language sql stable as $$select jsonb_build_object('ok',true,'media_check',m) from sma_private.manual_fixture$$;create function sma_private.publication_comparison_media_v1(b jsonb,d jsonb,m jsonb) returns jsonb language sql stable as $$select m$$;");
 await db.query("insert into public.sma_kunden values(91,$1,'fixture91','owner@example.test',true,true,false,null,false),(92,$2,'fixture92','other@example.test',true,true,false,null,false)",[uid,other]);
 await db.query("insert into sma_private.publication_files_v1(id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,width_px,height_px,duration_ms) values($1,$2,91,'fixture_drive','Synthetic.mp4','video','video/mp4',$3,now(),2000,720,1280,4000)",[id(1),uid,rev]);
 const binding={platform:'youtube',media_kind:'video',asset_id:id(1),asset_revision:rev,drive_file_id:'fixture_drive',preview_id:id(2),preview_revision:1,assignment_revision:1},target={platform:'youtube',id:'UC'+'a'.repeat(22),name:'Synthetic',source_revision:'b'.repeat(64)},choices={visibility:'private',made_for_kids:false,contains_synthetic_media:false};
 const evidence={version:1,platform:'youtube',target_id:target.id,target_revision:target.source_revision,display_name:'Synthetic',permissions:['youtube.upload'],policy:{},checked_at:new Date().toISOString(),expires_at:new Date(Date.now()+240000).toISOString()};
 await db.query("insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,state,account_check) values($1,$2,91,$3,'{\"platform\":\"youtube\",\"title\":\"Synthetic\",\"caption\":\"Synthetic text\"}',$4,$5,'prepared',$6)",[id(10),uid,binding,choices,target,evidence]);
 const check=(code,status='pass')=>({code,status,message:code});
 const media={asset_id:id(1),asset_revision:rev,can_publish:false,status:'needs_review',facts:{mime_type:'video/mp4',size_bytes:2000,duration_ms:4000},content_review:{asset_id:id(1),asset_revision:rev,policy_version:'visual-2026-11-01.1',status:'failed',error_code:'VIDEO_PLAN_REQUIRED'},checks:[check('BINARY_INSPECTION'),check('FILE_SIZE'),check('PORTAL_TEXT_COMPARISON'),check('CONTENT_REVIEW_PENDING','pending'),check('SEMANTIC_REVIEW_PENDING','pending'),check('PUBLICATION_APPROVAL_PENDING','pending')]};
 await db.query('insert into sma_private.manual_fixture values($1)',[media]);
 const setMedia=m=>db.query('update sma_private.manual_fixture set m=$1',[m]);
 const available=async m=>(await db.query('select sma_private.publication_human_review_available_v1(j,$1) r from sma_private.publication_orders_v1 j',[m])).rows[0].r;
 const view=async()=>(await db.query('select sma_private.publication_order_view_v1(j) r from sma_private.publication_orders_v1 j')).rows[0].r;
 const asRole=async(role,fn)=>{await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}};
 const request=async(action,input,owner=uid)=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);return asRole('authenticated',async()=>(await db.query('select public.sma_publication_order_v1($1,$2) r',[action,input])).rows[0].r);};
 const worker=async(action,d={},lease=null)=>asRole('service_role',async()=>(await db.query('select public.sma_publication_order_worker_v1($1,$2,$3,$4) r',[action,id(10),lease,d])).rows[0].r);
 const provider=async(d={})=>asRole('service_role',async()=>(await db.query("select public.sma_publication_provider_v1('begin',$1,null,$2) r",[id(10),d])).rows[0].r);
 // Install the actual history projections and test the same deadline in both customer reads.
 await db.exec((await src('publication-provider-cover')).split('create or replace function')[0]);
 for(const f of ['publication-history','publication-history-months','publication-cover-history','publication-approval-window','publication-pending-preparation','publication-history-order-caption','publication-history-order-page'])await db.exec(await src(f));
 const existingApproval=await src('publication-existing-approval');
 eq(existingApproval,await readFile(new URL('../supabase/migrations/20261107231249_publication_existing_approval_v1.sql',import.meta.url),'utf8'));
 await db.exec(existingApproval);
 await assert.rejects(()=>db.exec(existingApproval),/PUBLICATION_EXISTING_APPROVAL_BASELINE_CHANGED/);n++;
 const cancelPreparation=await src('publication-cancel-preparation');
 eq(cancelPreparation,await readFile(new URL('../supabase/migrations/20261108085618_publication_cancel_preparation_v1.sql',import.meta.url),'utf8'));
 await db.exec(cancelPreparation);
 await assert.rejects(()=>db.exec(cancelPreparation),/PUBLICATION_CANCEL_PREPARATION_BASELINE_CHANGED/);n++;
 const history=async()=>asRole('authenticated',async()=>(await db.query("select public.sma_publication_history_v3('{\"month\":null}') as r")).rows[0].r);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 for(const [age,expected] of [['1 minute','active'],['30 minutes','expired'],['1 day','expired']]){
  await db.exec('begin');
  await db.query("update sma_private.publication_orders_v1 set created_at=now()-$1::interval,state='preparing',target=null,account_check=null",[age]);
  const saved=await request('get',{id:id(10)}),entry=(await history()).entries[0];
  eq(saved.preparation_window.status,expected);eq(entry.preparation_window,saved.preparation_window);
  eq(Date.parse(entry.created_at)+1800000,Date.parse(saved.preparation_window.expires_at));
  eq(saved.approval_window,null);eq(saved.approval_token,null);eq(saved.human_review_option,null);
  eq(saved.approved_at,null);eq(saved.can_upload,false);eq(saved.can_publish,false);
  eq((await request('get',{id:id(10)},other)).code,'ORDER_UNAVAILABLE');
  await db.exec('rollback');
 }
 // Cancellation uses the same owner and customer locks as approval. Exercise both
 // serialized outcomes, including a worker returning from its target check.
 const cancelInput={id:id(10)},cancel=()=>request('cancel',cancelInput);
 for(const state of ['preparing','prepared']){
  await db.exec('begin');
  if(state==='preparing')await db.exec("update sma_private.publication_orders_v1 set state='preparing',target=null,account_check=null");
  const before=await view(),cancelled=await cancel();
  eq(cancelled.state,'cancelled');eq(cancelled.id,cancelInput.id);
  eq(cancelled.approval_token,null);eq(cancelled.approval_window,null);eq(cancelled.preparation_window,null);
  eq(cancelled.approved_at,null);eq(cancelled.can_upload,false);eq(cancelled.can_publish,false);
  eq(cancelled.binding,before.binding);eq(cancelled.choices,before.choices);eq(cancelled.draft,before.draft);
  eq((await history()).entries[0].status,'cancelled');
  eq((await worker('bind_target',{target,account_check:evidence})).code,'ORDER_CHANGED');
  eq((await worker('claim')).code,'FINAL_APPROVAL_REQUIRED');
  await db.exec("update sma_private.publication_orders_v1 set updated_at='2026-11-01'");
  eq((await cancel()).state,'cancelled');
  eq((await db.query("select updated_at='2026-11-01'::timestamptz as unchanged from sma_private.publication_orders_v1")).rows[0].unchanged,true);
  await db.exec('rollback');
 }
 eq((await request('cancel',cancelInput,other)).code,'ORDER_UNAVAILABLE');
 eq((await request('cancel',cancelInput,'')).code,'AUTH_REQUIRED');
 eq((await request('cancel',{id:id(77)})).code,'ORDER_UNAVAILABLE');
 eq((await request('cancel',{...cancelInput,confirm:true})).code,'INVALID_INPUT');
 await db.exec('begin');await db.exec('update public.sma_kunden set aktiv=false where id=91');
 eq((await cancel()).code,'ACCESS_INACTIVE');await db.exec('rollback');
 await db.exec('begin');
 const selected={platform:'youtube',asset_id:id(1),asset_revision:rev,assignment_revision:1,preview_id:id(2),preview_revision:1};
 await db.query("update sma_private.publication_orders_v1 set state='preparing',target=null,account_check=null,binding=binding||$1::jsonb",[selected]);
 const retry={id:id(10),...selected,choices};
 eq((await request('prepare',retry)).state,'preparing');
 eq((await request('prepare',{...retry,choices:{...choices,visibility:'public'}})).code,'REQUEST_CONFLICT');
 const bound=await worker('bind_target',{target,account_check:evidence});
 eq(bound.state,'prepared');eq(bound.id,retry.id);eq(bound.target.id,target.id);eq(bound.approved_at,null);
 eq((await request('prepare',retry)).state,'prepared');eq((await history()).entries.length,1);
 eq((await db.query('select count(*)::int as n from sma_private.publication_journal_v1')).rows[0].n,0);
 await db.exec('rollback');
 eq((await view()).preparation_window,null);
 eq((await view()).approval_window.status,'active');
 eq(Date.parse((await view()).approval_window.expires_at),Date.parse(evidence.expires_at));
 eq((await history()).entries[0].approval_window,(await view()).approval_window);
 for(const [change,status] of [
  ["created_at=now()-interval '31 minutes'",'expired'],
  ["account_check=jsonb_set(account_check,'{expires_at}',to_jsonb(now()-interval '1 second'))",'expired'],
  ["account_check=jsonb_set(account_check,'{expires_at}','\"invalid\"')",'recheck'],
  ["account_check=null",'recheck'],
  ["state='cancelled'",null]
 ]){
  await db.exec('begin');await db.exec('update sma_private.publication_orders_v1 set '+change);
  const row=await view();eq(row.approval_window?.status??null,status);eq(row.approval_token,null);eq(row.human_review_option,null);
  eq((await history()).entries[0].approval_window,row.approval_window);
  await db.exec('rollback');
 }
 await db.exec('begin');await db.exec("update sma_private.publication_orders_v1 set binding=jsonb_set(binding,'{platform}','\"instagram\"'),account_check=null");
 eq((await view()).approval_window.status,'active');await db.exec('rollback');
 eq((await request('get',{id:id(10)},other)).code,'ORDER_UNAVAILABLE');
 const v=await view(),base={policy_version:'media-consent-2026-11-03.1',content_checked:true,media_rights:true,music_rights:true,tiktok_music_terms:false,tiktok_branded_terms:false};
 const human={...v.human_review_option,full_playback:true,visual_clear:true,speech_text_checked:true,claims_match:true},review={...base,human_review:human};
 const approval={id:id(10),approval_token:v.approval_token,confirm:true,review};
 eq(v.can_publish,false);eq(v.can_upload,false);eq(await available(media),true);eq(v.media_check,media);
 eq(await available({...media,content_review:{...media.content_review,status:'unreviewed',error_code:null}}),true);
 const clear={...media,content_review:{...media.content_review,status:'completed',result:{outcome:'clear'}},checks:media.checks.map(x=>x.code==='CONTENT_REVIEW_PENDING'?check('VISUAL_REVIEW'):x)};eq(await available(clear),true);
 for(const r of [{status:'processing'},{status:'failed',error_code:'REVIEW_TIMEOUT'},{status:'completed',result:{outcome:'needs_review'}},{status:'unknown'},{asset_revision:'changed'},{asset_id:id(2)},{policy_version:'unknown'}])eq(await available({...media,content_review:{...media.content_review,...r}}),false);
 for(const c of ['VISUAL_REVIEW','PORTAL_TEXT_COMPARISON','VIDEO_CODEC','TIKTOK_CREATOR_LIMIT','OTHER_GATE'])for(const status of ['pending','fail',null])eq(await available({...media,checks:[...media.checks,check(c,status)]}),false);
 for(const c of ['CONTENT_REVIEW_PENDING','SEMANTIC_REVIEW_PENDING','PUBLICATION_APPROVAL_PENDING'])eq(await available({...media,checks:media.checks.map(x=>x.code===c?{...x,status:'fail'}:x)}),false);
 for(const c of ['BINARY_INSPECTION','PORTAL_TEXT_COMPARISON','SEMANTIC_REVIEW_PENDING'])eq(await available({...media,checks:media.checks.filter(x=>x.code!==c)}),false);
 for(const facts of [{mime_type:'video/quicktime'},{size_bytes:24000001},{duration_ms:60001},{duration_ms:'4000'},{size_bytes:0},{duration_ms:null}])eq(await available({...media,facts:{...media.facts,...facts}}),false);
 for(const m of [null,{}, {...media,checks:null},{...media,asset_revision:'changed'}])eq(await available(m),false);
 for(const field of Object.keys(human))for(const bad of [null,false,'true',1]){
  const h={...human,[field]:bad};eq((await db.query('select sma_private.publication_human_review_valid_v1($1) r',[h])).rows[0].r,false);
 }
 eq((await db.query('select sma_private.publication_human_review_valid_v1($1) r',[{...human,can_publish:true}])).rows[0].r,false);
 for(const platform of ['instagram','facebook'])eq((await db.query('select sma_private.publication_order_review_valid_v1($1,$2,$3) r',[review,platform,choices])).rows[0].r,false);
 eq((await db.query('select sma_private.publication_order_review_valid_v1($1,\'youtube\',$2) r',[base,choices])).rows[0].r,true);
 eq((await request('approve',approval,other)).code,'ORDER_UNAVAILABLE');eq((await request('approve',approval,'')).code,'AUTH_REQUIRED');
 eq((await request('approve',{...approval,confirm:false})).code,'FINAL_APPROVAL_REQUIRED');eq((await request('approve',{...approval,approval_token:id(99)})).code,'FINAL_APPROVAL_REQUIRED');
 eq((await request('approve',{...approval,review:{...review,human_review:{...human,source_fingerprint:'f'.repeat(64)}}})).code,'HUMAN_REVIEW_UNAVAILABLE');
 await setMedia({...media,checks:[...media.checks,check('VISUAL_REVIEW','pending')]});eq((await request('approve',approval)).code,'HUMAN_REVIEW_UNAVAILABLE');await setMedia(media);
 await db.exec('begin');eq((await cancel()).state,'cancelled');
 eq((await request('approve',approval)).code,'ORDER_NOT_PREPARED');
 eq((await db.query('select count(*)::int as n from sma_private.publication_journal_v1')).rows[0].n,0);
 await db.exec('rollback');
 const approved=await request('approve',approval);eq(approved.state,'approved');eq(approved.media_check.human_review.method,'customer_attestation');eq(approved.media_check.content_review,media.content_review);eq(approved.can_publish,false);eq(approved.can_upload,false);
 eq((await cancel()).code,'ORDER_NOT_CANCELLABLE');
 eq((await request('get',cancelInput)).approved_at,approved.approved_at);
 // Even an inconsistent preparing row cannot revoke a journaled approval.
 await db.exec('begin');
 await db.exec("update sma_private.publication_orders_v1 set state='preparing',approved_at=null,approval_review=null");
 eq((await cancel()).code,'ORDER_NOT_CANCELLABLE');await db.exec('rollback');
 eq(approved.media_check.checks.map(x=>x.code),['BINARY_INSPECTION','FILE_SIZE','PORTAL_TEXT_COMPARISON','HUMAN_VISUAL_REVIEW','HUMAN_SEMANTIC_REVIEW','PUBLICATION_APPROVAL_PENDING']);
 eq((await request('approve',approval)).approved_at,approved.approved_at);eq((await request('approve',{...approval,review:base})).code,'FINAL_APPROVAL_REQUIRED');
 const count=async t=>(await db.query('select count(*)::int n from sma_private.'+t)).rows[0].n;
 eq(await count('publication_journal_v1'),1);eq(await count('publication_provider_permissions_v1'),0);eq(await count('publication_provider_attempts_v1'),0);
 // A new request for a later caption should return the original before inserting a row.
 await db.exec('begin');
 const freshId=id(40), later={...selected,preview_id:id(3),preview_revision:2,assignment_revision:2};
 const prepareInput={id:freshId,...later,choices,expected_target_id:target.id};
 async function assignLaterDraft(platform){
  await db.exec("update public.sma_kunden set shop_oeffentlich=true,shop_slug='fixture' where id=91");
  await db.query(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,revision)
   values($1,$2,91,'{}','https://sma-automation.com/app/shop.html?shop=fixture','completed',2)`,[later.preview_id,uid]);
  await db.query(`insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,revision,draft)
   values($1,$4,$2,2,$3,2,'{"title":"Later caption"}')`,[id(1),later.preview_id,rev,platform]);
 }
 await assignLaterDraft('youtube');
 const existing={ok:false,code:'DUPLICATE_PUBLICATION',existing_order_id:approved.id};
 eq(await request('prepare',prepareInput),existing);
 eq(await request('prepare',{...prepareInput,choices:{...choices,visibility:'public'}}),existing);
 eq(await count('publication_orders_v1'),1);
 eq((await request('prepare',{...prepareInput,asset_revision:'outdated'})).code,'ORDER_CHANGED');
 eq((await request('prepare',prepareInput,other)).code,'FILE_UNAVAILABLE');
 for(const invalid of [null,42,{},'ab','bad id','a'.repeat(201)]){
  eq((await request('prepare',{...prepareInput,expected_target_id:invalid})).code,'INVALID_INPUT');
 }
 eq((await request('prepare',{...prepareInput,platform:'facebook'})).code,'INVALID_INPUT');
 eq((await request('approve',{...approval,expected_target_id:target.id})).code,'INVALID_INPUT');
 eq((await request('get',{id:approved.id,expected_target_id:target.id})).code,'INVALID_INPUT');
 await db.exec('savepoint changed_owner');
 await db.query('update sma_private.publication_orders_v1 set user_id=$1 where id=$2',[other,approved.id]);
 eq(await request('prepare',prepareInput),{ok:false,code:'REQUEST_CONFLICT'});
 await db.exec('rollback to changed_owner');
 // No match and clients without a target hint still use ordinary unbound preparation.
 const alternative=await request('prepare',{...prepareInput,expected_target_id:'another-channel'});
 eq(alternative.state,'preparing');eq(alternative.target,null);eq(alternative.approved_at,null);
 eq((await request('prepare',{...prepareInput,expected_target_id:'another-channel'})).id,freshId);
 const legacy=await request('prepare',{id:id(41),...later,choices});eq(legacy.state,'preparing');
 eq(await count('publication_orders_v1'),3);eq(await count('publication_journal_v1'),1);
 eq(await count('publication_provider_attempts_v1'),0);await db.exec('rollback');
 // A later text revision for the same asset version and target collides with the first approval.
 await db.exec('begin');
 const secondId=id(11);
 await db.query(`insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,state,account_check)
  select $2,user_id,customer_id,binding||$3::jsonb,draft||$4::jsonb,choices||$5::jsonb,target,'prepared',account_check
  from sma_private.publication_orders_v1 where id=$1`,[id(10),secondId,{preview_id:id(3),preview_revision:2,assignment_revision:2},
  {title:'Later draft',caption:'Later caption'},{visibility:'unlisted'}]);
 const second=await request('get',{id:secondId});
 const duplicate=await request('approve',{id:secondId,approval_token:second.approval_token,confirm:true,review:base});
 eq(duplicate.code,'DUPLICATE_PUBLICATION');eq(duplicate.existing_order_id,approved.id);
 const original=await request('get',{id:duplicate.existing_order_id});eq(original.approved_at,approved.approved_at);
 eq(original.binding.preview_revision,1);eq(second.binding.preview_revision,2);
 const locate=()=>asRole('authenticated',async()=>(await db.query('select public.sma_publication_history_order_page_v1($1) r',[duplicate.existing_order_id])).rows[0].r);
 const located=await locate();eq(located.order_page,1);eq(located.entries.find(e=>e.id===original.id).order_caption,'Synthetic text');
 eq((await request('get',{id:secondId})).approved_at,null);eq(await count('publication_journal_v1'),1);
 eq((await request('get',{id:original.id},other)).code,'ORDER_UNAVAILABLE');eq((await locate()).code,'ORDER_UNAVAILABLE');
 eq(await count('publication_provider_attempts_v1'),0);await db.exec('rollback');
 for(const change of ["draft=draft||'{\"caption\":\"Changed\"}'","choices=choices||'{\"visibility\":\"public\"}'","target=target||'{\"id\":\"other\"}'","binding=binding||'{\"preview_revision\":2}'","user_id='"+other+"'","customer_id=92","state='cancelled'","approved_at=null"]){await db.exec('begin');await db.exec('update sma_private.publication_orders_v1 set '+change);eq((await view()).media_check?.human_review,undefined);await db.exec('rollback');}
 const data={target,drive_verified:true,text_verified:true,account_check:evidence,blockers:[]};
 const claim=await worker('claim');eq(claim.ok,true);const checked=await worker('finish_check',data,claim.lease_id);eq(checked.state,'checked');eq(checked.blockers,[]);
 eq((await provider({...data,size_bytes:2000})).code,'UPLOAD_TEST_APPROVAL_REQUIRED');eq(await count('publication_provider_attempts_v1'),0);
 // With a synthetic operator permission only inside a rolled-back transaction,
 // prove the actual provider journal rechecks the manual and remaining gates.
 for(const [changed,expected] of [[media,'init'],[{...media,checks:[...media.checks,check('VIDEO_CODEC','fail')]},'MEDIA_REVIEW_REQUIRED'],[{...media,content_review:{...media.content_review,status:'processing'}},'MEDIA_REVIEW_REQUIRED']]){
  await db.exec('begin');await setMedia(changed);await db.exec("insert into sma_private.publication_provider_permissions_v1(order_id,fingerprint,expires_at) select id,sma_private.publication_provider_fingerprint_v1(j),now()+interval '1 hour' from sma_private.publication_orders_v1 j");
  const r=await provider({...data,size_bytes:2000});eq(r.operation||r.code,expected);await db.exec('rollback');
 }
 eq(await count('publication_provider_permissions_v1'),0);eq(await count('publication_provider_attempts_v1'),0);
 // Exact TikTok creator evidence is still required before the human option can
 // appear; the new review also preserves TikTok music/commercial declarations.
 await db.exec('begin');
 const ttTarget={...target,platform:'tiktok',id:'synthetic_open_id'},ttChoices={visibility:'SELF_ONLY',disable_comment:false,disable_duet:false,disable_stitch:false,brand_content_toggle:false,brand_organic_toggle:false};
 const ttEvidence={...evidence,platform:'tiktok',target_id:ttTarget.id,permissions:['video.publish','user.info.basic'],policy:{privacy_levels:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_duration_sec:60}};
 await db.query("update sma_private.publication_orders_v1 set binding=$1,target=$2,choices=$3,account_check=$4,approved_at=null,approval_review=null,state='prepared'",[{...binding,platform:'tiktok'},ttTarget,ttChoices,ttEvidence]);
 const ttMedia={...media,checks:[...media.checks,check('TIKTOK_CREATOR_LIMIT','pending')]};await setMedia(ttMedia);
 let tt=await view();eq(tt.media_check.checks.find(x=>x.code==='TIKTOK_CREATOR_LIMIT').status,'pass');eq(!!tt.human_review_option,true);
 await db.exec('update sma_private.publication_orders_v1 set account_check=null');eq((await view()).human_review_option,null);
 await db.query('update sma_private.publication_orders_v1 set account_check=$1',[ttEvidence]);
 await setMedia({...ttMedia,facts:{...ttMedia.facts,duration_ms:61000}});eq((await view()).human_review_option,null);await setMedia(ttMedia);
 const ttApproval={...approval,review:{...base,tiktok_music_terms:true,human_review:{...human,...tt.human_review_option}}};
 eq((await request('approve',{...ttApproval,review:{...ttApproval.review,tiktok_music_terms:false}})).code,'FINAL_APPROVAL_REQUIRED');
 await db.exec('delete from sma_private.publication_journal_v1');tt=await request('approve',ttApproval);eq(tt.state,'approved');eq(tt.media_check.human_review.method,'customer_attestation');
 await assignLaterDraft('tiktok');
 eq(await request('prepare',{...prepareInput,platform:'tiktok',expected_target_id:ttTarget.id,choices:ttChoices}),existing);
 eq(await count('publication_orders_v1'),1);
 const ttClaim=await worker('claim');tt=await worker('finish_check',{...data,target:ttTarget,account_check:ttEvidence},ttClaim.lease_id);eq(tt.state,'checked');eq(tt.blockers,[]);
 eq((await provider({...data,target:ttTarget,account_check:ttEvidence,size_bytes:2000})).code,'UPLOAD_TEST_APPROVAL_REQUIRED');await db.exec('rollback');
 // A late machine finding blocks a previously accepted manual attestation.
 await db.exec("update sma_private.publication_orders_v1 set state='blocked'");await setMedia({...media,checks:[...media.checks,check('VISUAL_REVIEW','pending')]});
 const c2=await worker('claim'),blocked=await worker('finish_check',data,c2.lease_id);eq(blocked.state,'blocked');eq(blocked.blockers.includes('VISUAL_REVIEW'),true);eq(blocked.media_check.human_review,undefined);
 for(const role of ['anon','authenticated'])await asRole(role,async()=>{for(const query of ["select sma_private.publication_human_review_valid_v1('{}')","select * from sma_private.publication_orders_v1","select public.sma_publication_provider_v1('begin',$1)"]){await assert.rejects(()=>db.query(query,query.includes('$1')?[id(10)]:[]),/permission denied/);n++;}});
 console.log(n+' manual review SQL checks passed. No network requests.');
}catch(e){console.error(e.message,e.where||'',e.actual,e.expected);process.exitCode=1;}finally{await db.close();}
