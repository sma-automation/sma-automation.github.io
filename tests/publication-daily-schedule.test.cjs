const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sql=name=>fs.readFileSync('supabase/sql/'+name+'.sql','utf8');
const platforms=['youtube','tiktok','instagram','facebook'];
const defaultTimes=()=>Object.fromEntries(platforms.map(key=>[key,['10:00','14:00','18:00']]));

test('each customer gets three separate files, all portal times, an idempotent daily run and no dispatch',
  {skip:!fs.existsSync('tests/sql-runtime/node_modules/@electric-sql/pglite')},async t=>{
  const {PGlite}=await import('./sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select current_setting('request.jwt.claim.sub',true)::uuid$$;
  create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);
  create schema cron;create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;`);
  for(const name of ['publication-preview','publication-files','publication-accounts','publication-orders','publication-joint-plan'])await db.exec(sql(name));
  await db.exec('create table sma_private.publication_editor_exports_v1(customer_id bigint,user_id uuid,asset_id uuid,media_asset_id uuid);create table sma_private.gallery_music_v1(customer_id bigint,user_id uuid,source_id uuid,result_id uuid);');
  await db.exec(sql('publication-daily-schedule'));
  await db.exec(sql('publication-gallery-rotation'));
  await db.exec(fs.readFileSync('supabase/migrations/20261127220031_daily_schedule_editor_binding.sql','utf8'));
  await db.exec(sql('publication-drive-rotation-import'));
  await db.exec(sql('publication-rotation-metadata'));
  await db.exec(sql('publication-provider-journal'));
  await db.exec(sql('publication-rotation-dispatch'));
  const id=n=>'e3600000-0000-4000-9000-'+String(n).padStart(12,'0');
  const [a,b]=[id(1),id(2)];
  await db.query("insert into public.sma_kunden(id,user_id,aktiv,demo_delta_aktiv) values(1,$1,true,true),(2,$2,true,true)",[a,b]);
  for(let n=10;n<18;n++)await db.query("insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes) values($1,1,$2,$3,$3,'video','video/mp4','v',now(),10)",[id(n),a,'video'+n]);
  const tomorrow=(await db.query("select ((now() at time zone 'Europe/Vienna')::date+1)::text d")).rows[0].d;
  const run=async(action,owner,actor,times=null,version=null)=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');
    try{return (await db.query('select public.sma_publication_daily_schedule_v1($1,$2,$3,$4,$5) r',[action,owner,tomorrow,times,version])).rows[0].r;}
    finally{await db.exec('reset role');}
  };
  const times=defaultTimes();times.tiktok=['09:30','13:15','19:45'];
  assert.equal((await run('get',a,a)).version,0);
  assert.equal((await run('save',a,b,times,0)).code,'AUTH_REQUIRED');
  assert.equal((await run('save',a,a,{...times,tiktok:['08:00','08:00','23:00']},0)).code,'INVALID_TIMES');
  for(const bad of [null,{}, { ...times, youtube:['24:00','13:00','19:00']},{...times,facebook:[null,'12:00','19:00']}]){
    assert.equal((await run('save',a,a,bad,0)).code,'INVALID_TIMES');
  }
  // A pre-existing one-off time must survive enrollment, with its original portals.
  await db.query("insert into sma_private.publication_joint_plans_v1(customer_id,asset_id,asset_revision,owner_id,desired_at,version) values(1,$1,'v',$2,($3::date+time '14:00') at time zone 'Europe/Vienna',1)",[id(11),a,tomorrow]);
  const saved=await run('save',a,a,times,0);
  assert.equal(saved.version,1);assert.equal(saved.files.length,3);
  assert.equal(saved.files[1].asset_id,id(11));
  assert(saved.files.every(file=>file.asset_revision==='v'&&file.media_kind==='video'));
  assert.deepEqual(saved.files.map(file=>file.slot),[1,null,3]);
  assert.equal(Object.keys(saved.files[1].times).length,2);
  const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit'});
  assert.equal(fmt.format(new Date(saved.files[0].times.tiktok)),'09:30');
  assert.equal(fmt.format(new Date(saved.files[2].times.tiktok)),'19:45');
  assert.deepEqual((await run('fill',a,a)).files,saved.files);
  await db.exec('select sma_private.publication_daily_tick_v1()');
  assert.deepEqual((await run('save',a,a,times,0)).files,saved.files);
  assert.equal((await run('save',a,a,defaultTimes(),0)).code,'VERSION_CONFLICT');
  const asOther=await run('get',b,b);assert.equal(asOther.files.length,0);assert.deepEqual(asOther.times,defaultTimes());
  await run('get',a,a);
  const file=(await db.query('select asset_id from sma_private.publication_joint_plans_v1 where daily_slot=3')).rows[0].asset_id;
  const joint=(await db.query("select public.sma_publication_joint_plan_v1('get',$1,$2,'v') r",[a,file])).rows[0].r;
  assert.equal(joint.daily_slot,3);assert.deepEqual(joint.portal_times,saved.files[2].times);
  const fourth=(await db.query(`select public.sma_publication_joint_plan_v1('save',$1,$2,'v',0,($3::date+time '20:00') at time zone 'Europe/Vienna',$3::text||'T20:00') r`,[a,id(17),tomorrow])).rows[0].r;
  assert.equal(fourth.code,'DAILY_PLAN_FULL');
  await db.query('select sma_private.publication_daily_fill_v1(1,$1,$2::date+1)',[a,tomorrow]);
  assert.equal((await db.query('select count(distinct asset_id)::int c from sma_private.publication_joint_plans_v1')).rows[0].c,6);
  assert.equal((await db.query('select count(*)::int c from sma_private.publication_orders_v1')).rows[0].c,0);
  // Reuse yesterday's original only after unused content. Preserve the old day and
  // keep an exact-content duplicate, a cleared choice and a future manual plan out.
  await db.query("insert into sma_private.publication_rotation_sources_v1(customer_id,owner_id,source_folder,processing_folder) values(2,$1,'source','processing')",[b]);
  await db.query("insert into sma_private.publication_daily_settings_v1 values(2,$1,$2,1)",[b,JSON.stringify(defaultTimes())]);
  const sha=n=>'sha256:'+String(n).padStart(64,'0')+':1';
  for(const n of [21,22,23,24,25,26,27])await db.query("insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes) values($1,2,$2,$3,$3,'video','video/mp4',$4,now(),10)",[id(n),b,'original'+n,sha(n===24?23:n)]);
  const past=(await db.query("select ((now() at time zone 'Europe/Vienna')::date-1)::text d")).rows[0].d;
  const plan=(n,day,slot)=>db.query("insert into sma_private.publication_joint_plans_v1(customer_id,owner_id,asset_id,asset_revision,desired_at,version) values(2,$1,$2,$3,($4::date+($5::int*interval '1 hour')) at time zone 'Europe/Vienna',4)",[b,id(n),sha(n),day,slot]);
  await plan(21,past,9);await plan(22,past,10);await plan(25,null,15);await plan(26,'2099-01-01',15);
  await db.query("insert into sma_private.publication_rotation_exclusions_v1 select id,$1 from sma_private.publication_rotation_sources_v1 where customer_id=2",[id(27)]);
  const sourceId=(await db.query('select id from sma_private.publication_rotation_sources_v1 where customer_id=2')).rows[0].id;
  const action=async(op,input)=>(await db.query('select public.sma_rotation_import_v1($1,$2,$3) r',[sourceId,op,JSON.stringify(input)])).rows[0].r;
  const digest='a'.repeat(64),reserve={digest,original_id:'originalDriveId',copy_id:'reservedDriveId'};
  assert.equal((await action('reserve',reserve)).id,'reservedDriveId');
  assert.equal((await action('reserve',{...reserve,copy_id:'secondDriveId'})).id,'reservedDriveId');
  const metadata={id:'reservedDriveId',sha256Checksum:digest,appProperties:{sma_rotation_source:sourceId},
    mimeType:'video/mp4',name:'import.mp4',size:'10',version:'1',parents:['processing'],trashed:false,modifiedTime:new Date().toISOString()};
  await assert.rejects(action('verify',{digest,file:{...metadata,parents:['foreign']}}),/IMPORT_COPY_CHANGED/);
  await db.exec('set role authenticated');
  await assert.rejects(action('context',{}),/permission denied/);
  await db.exec('reset role');
  const rotated=await run('fill',b,b);assert.deepEqual(rotated.files.map(x=>x.name),['original23','original21','original22']);
  assert.deepEqual((await run('fill',b,b)).files,rotated.files);
  assert.equal((await db.query("select count(*)::int c from sma_private.publication_rotation_history_v1 where customer_id=2")).rows[0].c,2);
  const historic=(await db.query("select public.sma_publication_daily_schedule_v1('get',$1,$2) r",[b,past])).rows[0].r;
  assert.deepEqual(historic.files.map(x=>x.name),['original21','original22']);
  assert.equal((await db.query("select version from sma_private.publication_joint_plans_v1 where asset_id=$1",[id(21)])).rows[0].version,5);
  assert.equal((await action('verify',{digest,file:metadata})).verified,true);
  assert.equal((await action('verify',{digest,file:metadata})).verified,true);
  assert.deepEqual((await action('context',{})).completed,[digest]);
  assert.equal((await db.query("select count(*)::int c from sma_private.publication_files_v1 where drive_file_id='reservedDriveId' and customer_id=2")).rows[0].c,1);
  const present=(await db.query("select id,revision from sma_private.publication_files_v1 where drive_file_id='reservedDriveId'")).rows[0];
  const future='2098-06-01',later='2098-06-01T08:00:00Z';
  await db.query("insert into sma_private.publication_joint_plans_v1(customer_id,owner_id,asset_id,asset_revision,version,plan_day,daily_slot,desired_at,portal_times) values(2,$1,$2,$3,1,$4,1,$5::timestamptz,jsonb_build_object('youtube',$5::timestamptz))",[b,present.id,present.revision,future,later]);
  await db.query("update sma_private.publication_files_v1 set revision=$2 where id=$1",[present.id,'sha256:'+digest+':2']);
  assert.equal((await db.query('select version from sma_private.publication_joint_plans_v1 where asset_id=$1',[present.id])).rows[0].version,2);
  const oid=id(81),pid=id(82),rev='sha256:'+digest+':2';
  const choices={visibility:'private',made_for_kids:false,contains_synthetic_media:false};
  const review={policy_version:'media-consent-2026-11-03.1',content_checked:true,media_rights:true,music_rights:true,tiktok_music_terms:false,tiktok_branded_terms:false};
  await db.query("insert into sma_private.publication_rotation_channels_v1(source_id,platform,target_id) values($1,'youtube','test-account')",[sourceId]);
  await db.query("insert into sma_private.publication_previews_v1(id,customer_id,user_id,input,shop_url,status) values($1,2,$2,'{}','https://example.test','completed')",[pid,b]);
  await db.query("insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft) values($1,'youtube',$2,1,$3,'{}')",[present.id,pid,rev]);
  await db.query("insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,state) values($1,$2,2,$3,'{}',$4,$5,'prepared')",[oid,b,JSON.stringify({asset_id:present.id,asset_revision:rev,platform:'youtube',preview_id:pid,preview_revision:1,assignment_revision:1}),JSON.stringify(choices),JSON.stringify({id:'test-account',platform:'youtube'})]);
  const due=async()=>(await db.query('select public.sma_rotation_due_v1($1) r',[sourceId])).rows[0].r.jobs;
  assert.deepEqual(await due(),[]);
  await db.query("update sma_private.publication_orders_v1 set approved_at=now(),approval_review=$2,state='checked' where id=$1",[oid,JSON.stringify(review)]);
  assert.equal((await db.query('select count(*)::int c from sma_private.publication_rotation_deliveries_v1')).rows[0].c,1);
  assert.deepEqual(await due(),[]);
  const elapsed=(await db.query("select now()-interval '10 seconds' t")).rows[0].t.toISOString();
  await db.query("update sma_private.publication_joint_plans_v1 set portal_times=jsonb_build_object('youtube',$2::text) where asset_id=$1",[present.id,elapsed]);
  await db.query("update sma_private.publication_rotation_deliveries_v1 set due_at=$2,next_check=$2 where order_id=$1",[oid,elapsed]);
  assert.deepEqual(await due(),[],'the calendar cannot grant a provider permission');
  await db.query("insert into sma_private.publication_provider_permissions_v1 select id,sma_private.publication_provider_fingerprint_v1(o),now()+interval '5 minutes',now() from sma_private.publication_orders_v1 o where id=$1",[oid]);
  assert.deepEqual(await due(),[{operation:'provider.cover',payload:{id:oid},context:{deadlineAt:null}}]);
  assert.deepEqual(await due(),[],'concurrent or repeated claims do not send twice');
  await db.query("update sma_private.publication_rotation_deliveries_v1 set next_check=now() where order_id=$1",[oid]);
  await db.query("update sma_private.publication_joint_plans_v1 set version=version+1 where asset_id=$1",[present.id]);
  assert.deepEqual(await due(),[],'a changed plan needs a new approval');
  await db.exec(sql('publication-device-upload'));
  await db.exec(sql('publication-portal-folders'));
  await db.exec(sql('publication-portal-gallery'));
  const folders={};
  for(const [i,platform] of platforms.entries()){
    const folder='portal-folder-'+platform;
    await db.query('insert into sma_private.publication_portal_folders_v1 values($1,$2,$3)',[sourceId,platform,folder]);
    folders[folder]=[];
    for(let k=0;k<3;k++){
      const number=100+3*i+k,revision=sha(number);
      folders[folder].push(revision.split(':')[1]);
      await db.query("insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes) values($1,2,$2,$3,$3,'video','video/mp4',$4,now(),10)",[id(number),b,'portal'+number,revision]);
    }
  }
  // A copy with a different name still collides on its media content.
  for(const clips of Object.values(folders))clips.push(digest);
  const scan=async(op,ticket=null,rows=null)=>(await db.query('select public.sma_publication_portal_scan_v1($1,$2,$3,$4) r',[sourceId,op,ticket,rows])).rows[0].r;
  const snapshot=await scan('start');
  await assert.rejects(scan('finish',snapshot.ticket,{}),/INCOMPLETE_PORTAL_SCAN/);
  const gallery=async(owner,platform)=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    return (await db.query("select public.sma_publication_files_v1('list',$1) r",[JSON.stringify(platform?{platform}:{})])).rows[0].r.files;
  };
  assert.equal((await gallery(b,'tiktok')).length,0);
  assert.equal((await scan('finish',snapshot.ticket,folders)).videos,12);
  for(const [i,platform] of platforms.entries()){
    const expected=[0,1,2].map(k=>id(100+3*i+k));
    assert.deepEqual((await gallery(b,platform)).map(f=>f.id).sort(),expected);
  }
  assert.equal((await gallery(a,'youtube')).length,0);
  assert((await gallery(a)).length>0);
  assert((await gallery(b)).length>12);
  await assert.rejects(scan('finish',snapshot.ticket,folders),/STALE_PORTAL_SCAN/);
  for(let i=0;i<2;i++)await db.query("select sma_private.publication_daily_fill_v1(2,$1,'2097-06-01')",[b]);
  const scheduled=(await db.query("select jsonb_object_keys(portal_times) p,asset_revision from sma_private.publication_joint_plans_v1 where plan_day='2097-06-01'")).rows;
  assert.equal(scheduled.length,12);
  assert.equal(new Set(scheduled.map(x=>x.asset_revision)).size,12);
  for(const {p,asset_revision} of scheduled)assert(folders['portal-folder-'+p].includes(asset_revision.split(':')[1]));
  assert.equal((await db.query("select sma_private.publication_portal_allowed_v1($1,'facebook',$2) ok",[sourceId,sha(100)])).rows[0].ok,false);
  assert.equal((await due()).length,0);
  await db.exec(fs.readFileSync('supabase/migrations/20261127143600_customer_rotation_slots.sql','utf8'));
  await db.exec(`create schema net;create function net.http_post(url text,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
    create table sma_private.day_publish_channels_v1(source_id uuid,platform text,owner_id uuid,customer_id bigint,target_id text,folder_id text);
    create table sma_private.day_publish_entries_v1(order_id uuid,platform text,target_id text,choices jsonb);`);
  for(const name of ['20261127173429_immediate_portal_schedule','20261127174133_manual_portal_send']){
    await db.exec(fs.readFileSync('supabase/migrations/'+name+'.sql','utf8'));
  }
  const moved=defaultTimes();moved.tiktok=['18:35','14:00','18:00'];
  const newTimes=await run('save',b,b,moved,1);assert.equal(newTimes.ok,true,JSON.stringify(newTimes));
  assert.deepEqual((await run('get',b,b)).times.tiktok,moved.tiktok);
  const rows=(await db.query("select daily_slot,desired_at=(portal_times->>'tiktok')::timestamptz as aligned, to_char(desired_at at time zone 'Europe/Vienna','HH24:MI') as clock from sma_private.publication_joint_plans_v1 where plan_day='2097-06-01' and portal_times?'tiktok' order by daily_slot")).rows;
  assert.deepEqual(rows.map(r=>r.clock),moved.tiktok);assert(rows.every(r=>r.aligned));
  const portal=async(action,platform,asset=null,revision=null,order=null,token=null)=>(await db.query('select public.sma_manual_portal_v1($1,$2,$3,$4,$5,$6,null) as r',[action,platform,asset,revision,order,token])).rows[0].r;
  assert.equal((await portal('folder','tiktok')).folder,'portal-folder-tiktok');
  await db.query("insert into sma_private.day_publish_channels_v1 values($1,'youtube',$2,2,'test-account','portal-folder-youtube')",[sourceId,b]);
  assert.equal((await portal('read','youtube',id(100),sha(100))).state,'approval_required');
  assert.equal((await portal('read','youtube',id(103),sha(103))).ok,false);
  assert.equal((await portal('send','youtube',id(100),sha(100),oid,id(300))).accepted,undefined);
  assert.equal((await db.query('select count(*)::int n from sma_private.manual_portal_sends_v1')).rows[0].n,0);
  assert.deepEqual((await db.query('select public.sma_claim_portal_schedule_v1($1) r',[id(300)])).rows[0].r.jobs,[]);
  const chosen=id(103),approvedOrder=id(310),requestId=id(311),revision=sha(103),target='manual-tiktok';
  await db.query("insert into sma_private.publication_rotation_channels_v1(source_id,platform,target_id) values($1,'tiktok',$2)",[sourceId,target]);
  await db.query("insert into sma_private.day_publish_channels_v1 values($1,'tiktok',$2,2,$3,'portal-folder-tiktok')",[sourceId,b,target]);
  const binding={asset_id:chosen,asset_revision:revision,platform:'tiktok',media_kind:'video',preview_id:pid,preview_revision:1,assignment_revision:1};
  await db.query("insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft) values($1,'tiktok',$2,1,$3,'{}')",[chosen,pid,revision]);
  await db.query("insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,target,approved_at,approval_review,state) values($1,$2,2,$3,'{}',$4,$5,now(),$6,'checked')",
    [approvedOrder,b,binding,{visibility:'SELF_ONLY',brand_content_toggle:false},{id:target,platform:'tiktok'},{...review,tiktok_music_terms:true}]);
  await db.query("insert into sma_private.publication_journal_v1(customer_id,asset_id,asset_revision,platform,target_id,order_id) values(2,$1,$2,'tiktok',$3,$4)",[chosen,revision,target,approvedOrder]);
  const submit=(action,token)=>portal(action,'tiktok',chosen,revision,approvedOrder,token);
  assert.equal((await submit('read')).can_send,true);
  assert.equal((await submit('send',requestId)).accepted,true);
  assert.equal((await submit('send',requestId)).accepted,true);
  assert.equal((await submit('send',id(312))).accepted,false);
  await db.query("insert into sma_private.publication_provider_attempts_v1(order_id,fingerprint,platform,target_id,visibility,size_bytes,state,last_operation,sequence) select id,sma_private.publication_provider_fingerprint_v1(o),'tiktok',$2,'SELF_ONLY',100,'uncertain','init',1 from sma_private.publication_orders_v1 o where id=$1",[approvedOrder,target]);
  await db.query("insert into sma_private.publication_provider_events_v1(order_id,sequence,request_id,operation,outcome,finished_at) values($1,1,$2,'init',$3,now())",[approvedOrder,id(315),{state:'uncertain',code:'PROVIDER_INIT_UNCERTAIN'}]);
  assert.equal((await submit('send',id(313))).accepted,true);
  const retryEligible=async()=>(await db.query('select sma_private.manual_restart_allowed_v1($1) as ok',[approvedOrder])).rows[0].ok;
  assert.equal(await retryEligible(),true);
  await db.query("update sma_private.publication_provider_attempts_v1 set received_bytes=10 where order_id=$1",[approvedOrder]);
  assert.equal(await retryEligible(),false);assert.equal((await submit('read')).can_send,false);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[a]);
  assert.equal((await portal('folder','tiktok')).ok,false);
  await db.exec('set role anon');await assert.rejects(db.exec("select public.sma_publication_daily_schedule_v1('get',null,current_date)"),/permission denied/);
});

test('schedule editor loads on demand and saves all three times independently for each portal',async()=>{
  const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
  const {mountDailySchedule,nextViennaDay}=await import('../app/assets/publication-daily-schedule.mjs');
  assert.equal(nextViennaDay('2026-11-20T23:30:00Z'),'2026-11-22');
  const {document,Event}=parseHTML('<html><body><section></section></body></html>');
  const panel=document.querySelector('section'),calls=[];
  const view=mountDailySchedule(document,panel,async args=>{
    calls.push(args);return {ok:true,version:args.p_times?1:0,times:args.p_times||defaultTimes(),files:[]};
  });
  assert.equal(calls.length,0);view.open('tiktok');await new Promise(setImmediate);
  const fields=[...panel.querySelectorAll('input[type=time]')];assert.equal(fields.length,3);
  assert.equal(panel.querySelector('h2').getAttribute('aria-label'),'TikTok');
  assert(!panel.textContent.includes('Freie Plätze füllen'));
  const input=fields[1];input.value='15:30';input.dispatchEvent(new Event('input',{bubbles:true}));
  panel.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.deepEqual(calls[1].p_times.tiktok,['10:00','15:30','18:00']);assert.deepEqual(calls[1].p_times.youtube,['10:00','14:00','18:00']);
  assert.equal(calls[1].p_version,0);
  fields[0].value='18:35';fields[0].dispatchEvent(new Event('change',{bubbles:true}));await new Promise(setImmediate);
  assert.deepEqual(calls[2].p_times.tiktok,['18:35','15:30','18:00']);
  assert.equal(fields[0].value,'18:35');
  view.open('instagram'); assert.equal(panel.querySelector('h2').getAttribute('aria-label'),'Instagram');
  assert.equal(fields[1].value,'14:00');
  view.open('tiktok'); assert.equal(fields[1].value,'15:30');
  assert.equal(calls.length,3);
  const chosen=panel.querySelector('input[type=date]');chosen.value=nextViennaDay();
  chosen.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(setImmediate);
  assert.equal(calls[3].p_action,'get');assert.equal(calls[3].p_day,chosen.value);
  view.destroy();
});

test('every scheduled video opens its own editor, including matching names and repeated time slots',async()=>{
  const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
  const {mountDailySchedule}=await import('../app/assets/publication-daily-schedule.mjs');
  const {document}=parseHTML('<html><body><section></section></body></html>');
  const panel=document.querySelector('section');
  const files=Array.from({length:4},(_,i)=>({
    asset_id:'00000000-0000-4000-8000-00000000000'+i,asset_revision:'rev:'+i+'+1',
    name:'Gleicher Titel.mp4',media_kind:'video',current:i!==3,texts:[],
    times:Object.fromEntries(platforms.map(p=>[p,'2026-11-27T0'+(8+i%2)+':00:00Z']))
  }));
  const rows=[files[0],files[2],files[1],files[3]];
  const media={reset(){},show(host,file){host.dataset.asset=file.asset_id;return file.name;}};
  const view=mountDailySchedule(document,panel,async()=>({ok:true,version:1,times:defaultTimes(),files}),media,'https://sma.example/app/media-editor.html?kundenmedien=pilot');
  for(const portal of platforms){
    view.open(portal);await new Promise(setImmediate);
    const cards=[...panel.querySelectorAll('li')];assert.equal(cards.length,files.length);
    for(const [index,card] of cards.entries()){
      const file=rows[index],edit=card.lastElementChild;
      assert.equal(edit.textContent,'Video bearbeiten');
      if(!file.current){
        assert(edit.disabled);assert(!edit.hasAttribute('href'));assert.match(card.textContent,/nicht mehr verfügbar/);continue;
      }
      const url=new URL(edit.getAttribute('href')),params=new URLSearchParams(url.hash.slice(1));
      assert.equal(edit.target,'_blank');assert.equal(url.pathname,'/app/media-editor.html');
      assert.equal(url.searchParams.get('kundenmedien'),'pilot');
      assert.deepEqual(Object.fromEntries(params),{asset:file.asset_id,revision:file.asset_revision,portal});
      assert.equal(card.querySelector('.sma-schedule-thumbnail').dataset.asset,file.asset_id);
    }
    assert.doesNotMatch(panel.textContent,/Private Tagesentwürfe|Gemeinsame Tagesfreigabe öffnen/);
    assert.equal(panel.querySelector('#sma-daily-calendar,a[href*="tagesplan.html"]'),null);
  }
  view.destroy();
});

test('portal scans follow only real assigned folders and keep page and content boundaries',()=>{
  const {beginScan,collectPage}=require('../n8n/publishing/drive-portal-folders.cjs');
  const root='parentFolderID', child='subFolderInside', type='application/vnd.google-apps.folder';
  const folders=Object.fromEntries(platforms.map(p=>['portalFolder_'+p,p]));
  const row=(id,parent,mimeType)=>({id,parents:[parent],mimeType,trashed:false});
  let state=beginScan({root,ticket:'scan',folders});
  state=collectPage(state,{files:[row('unassignedFolder',root,type)],nextPageToken:'next'});
  assert.deepEqual(state.queue,[{id:root,pool:null}]);
  assert.throws(()=>collectPage(structuredClone(state),{files:[],nextPageToken:'next'}),/REPEATED_PAGE/);
  state=collectPage(state,{files:Object.keys(folders).map(id=>row(id,root,type))});
  const first=state.queue[0].id,hash='a'.repeat(64);
  const video=(parent)=>({...row('driveVideoID1',parent,'video/mp4'),size:'111',sha256Checksum:hash});
  state=collectPage(state,{files:[row(child,first,type),video(first)]});
  while(state.queue.length>1)state=collectPage(state,{files:[]});
  assert.deepEqual(state.queue,[{id:child,pool:first}]);
  assert.throws(()=>collectPage(structuredClone(state),{incompleteSearch:true,files:[]}),/INCOMPLETE_LISTING/);
  state=collectPage(state,{files:[video(child)]});
  assert.deepEqual(state.rows[first],[hash]);
  assert.equal(Object.values(state.rows).flat().length,1);
  assert.throws(()=>collectPage(beginScan({root,ticket:'scan',folders}),{files:[]}),/PORTAL_FOLDER_MISSING/);
});
