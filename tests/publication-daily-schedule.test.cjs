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
  assert.equal(calls.length,0);view.open();await new Promise(setImmediate);
  const fields=[...panel.querySelectorAll('input[type=time]')];assert.equal(fields.length,12);
  const input=panel.querySelector('[aria-label="TikTok · Datei 2"]');input.value='15:30';input.dispatchEvent(new Event('input',{bubbles:true}));
  panel.querySelector('form').dispatchEvent(new Event('submit',{cancelable:true}));await new Promise(setImmediate);
  assert.deepEqual(calls[1].p_times.tiktok,['10:00','15:30','18:00']);assert.deepEqual(calls[1].p_times.youtube,['10:00','14:00','18:00']);
  assert.equal(calls[1].p_version,0);
});
