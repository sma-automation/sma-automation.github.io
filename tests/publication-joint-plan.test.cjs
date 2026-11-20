const test = require('node:test');
const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');

test('Vienna time resolves ordinary minutes, the spring gap and both autumn occurrences', async () => {
  const {viennaInstants} = await import('../app/assets/publication-joint-plan.mjs');
  assert.deepEqual(viennaInstants('2030-01-10T16:00'), ['2030-01-10T15:00:00.000Z']);
  assert.deepEqual(viennaInstants('2030-06-10T16:00'), ['2030-06-10T14:00:00.000Z']);
  assert.deepEqual(viennaInstants('2030-03-31T02:30'), []);
  assert.deepEqual(viennaInstants('2030-10-27T02:30'), ['2030-10-27T00:30:00.000Z','2030-10-27T01:30:00.000Z']);
  assert.deepEqual(viennaInstants('2030-02-31T15:00'), []);
});

test('a shared editorial time survives portal switches and cannot modify orders or cross owners or revisions', async t => {
  const {PGlite} = await import('./sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role authenticated; create role anon; create role service_role bypassrls; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,
      demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);`);
  for (const name of ['publication-preview','publication-files','publication-accounts','publication-orders','publication-joint-plan']) {
    await db.exec(await readFile('supabase/sql/'+name+'.sql','utf8'));
  }
  const id = n => 'ba660000-0000-4000-9000-'+String(n).padStart(12,'0');
  const [user,other,asset,preview,order] = [1,2,3,4,5].map(id);
  await db.query("insert into public.sma_kunden(id,user_id,aktiv,demo_delta_aktiv) values(1,$1,true,true),(2,$2,true,true)",[user,other]);
  await db.query("insert into sma_private.publication_files_v1(id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes) values($1,1,$2,'fixture','clip','video','video/mp4','rev1',now(),100)",[asset,user]);
  await db.query("insert into sma_private.publication_previews_v1(id,customer_id,user_id,input,shop_url,status) values($1,1,$2,'{}','fixture','completed')",[preview,user]);
  await db.query("insert into sma_private.publication_assignments_v1 values($1,'tiktok',$2,1,'rev1',1,'{}',now())",[asset,preview]);
  const binding = {platform:'tiktok',asset_id:asset,asset_revision:'rev1',preview_id:preview,preview_revision:1,assignment_revision:1};
  await db.query(`insert into sma_private.publication_orders_v1(id,customer_id,user_id,binding,draft,choices,target,account_check,state,approved_at)
    values($1,1,$2,$3,'{}','{}','{"id":"T","platform":"tiktok","source_revision":"v1"}',
      '{"display_name":"Testziel","target_id":"T","target_revision":"v1"}','blocked',now())`,[order,user,binding]);
  const read = async (action, version=null, time=null, local=null, owner=user, actor=user, rev='rev1') => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    await db.exec('set role authenticated');
    try {
      return (await db.query("select public.sma_publication_joint_plan_v1($1,$2,$3,$4,$5,$6,$7) r",[action,owner,asset,rev,version,time,local])).rows[0].r;
    } finally { await db.exec('reset role'); }
  };
  const empty = await read('get');
  assert.equal(empty.status,'empty');
  assert.deepEqual(empty.channels.map(c=>[c.platform,c.target,c.order_state]),[['youtube',null,null],['tiktok','Testziel','blocked']]);
  const when = '2099-01-10T15:00:00Z', local='2099-01-10T16:00';
  assert.equal((await read('save',0,when,local)).version,1);
  assert.equal((await read('save',0,when,local)).version,1);
  const saved=await read('get');
  assert.equal(saved.status,'draft'); assert.equal(Date.parse(saved.desired_at),Date.parse(when));
  assert.equal((await read('clear',0)).code,'VERSION_CONFLICT');
  assert.equal((await read('save',1,when,'2099-01-10T14:00')).code,'INVALID_TIME');
  assert.equal((await read('get',null,null,null,user,other)).code,'AUTH_REQUIRED');
  assert.equal((await read('get',null,null,null,other,other)).code,'FILE_CHANGED');
  await db.exec("update sma_private.publication_assignments_v1 set revision=2");
  assert.equal((await read('get')).channels[1].target,null);
  assert.equal((await read('clear',1)).version,2);
  assert.equal((await read('save',1,when,local)).code,'VERSION_CONFLICT');
  assert.equal((await read('save',2,'2020-01-01T00:00Z','2020-01-01T01:00')).code,'INVALID_TIME');
  assert.equal((await read('save',2,when,local)).version,3);
  await db.exec("update sma_private.publication_files_v1 set revision='rev2'");
  assert.equal((await read('get')).code,'FILE_CHANGED');
  assert.equal((await read('get',null,null,null,user,user,'rev2')).status,'empty');
  assert.deepEqual((await db.query("select state from sma_private.publication_orders_v1")).rows,[{state:'blocked'}]);
  await db.exec('set role authenticated');
  await assert.rejects(()=>db.exec('select * from sma_private.publication_joint_plans_v1'), /permission denied/);
  await db.exec('reset role; set role anon');
  await assert.rejects(()=>db.exec("select public.sma_publication_joint_plan_v1('get',null,null,null)"),/permission denied/);
});

test('the preview saves one draft for both portals and ignores a late response after switching files', async () => {
  const {parseHTML} = await import('./dom-runtime/node_modules/linkedom/esm/index.js');
  const {mountJointPlan} = await import('../app/assets/publication-joint-plan.mjs');
  const {document, Event} = parseHTML(await readFile('app/publication-preview.html','utf8'));
  const el = id => document.getElementById(id);
  // The test DOM omits the native value setter of HTMLSelectElement.
  Object.defineProperty(el('jointPlanOccurrence'),'value',{writable:true,value:''});
  const calls = [];
  let complete;
  const view = mountJointPlan(document, args => {calls.push(args); return new Promise(resolve => {complete=resolve;});});
  const flush = () => new Promise(resolve=>setImmediate(resolve));
  const file = {id:'video1',media_kind:'video',revision:'r1'};
  const empty = {ok:true,status:'empty',version:0,desired_at:null,channels:[
    {platform:'youtube',order_state:null,target:null},{platform:'tiktok',order_state:'blocked',target:'Testziel'}]};
  view.select(file,'owner');
  assert.equal(calls.length,0);
  el('jointPlan').open=true;
  el('jointPlan').dispatchEvent(new Event('toggle'));
  assert.equal(calls[0].p_action,'get');
  complete(empty); await flush();
  assert.match(el('jointPlanChannels').textContent,/TikTok · Testziel · Auftrag blockiert/);
  el('jointPlanTime').value='2099-01-10T16:00';
  el('jointPlanTime').dispatchEvent(new Event('input'));
  el('jointPlanSave').click();
  assert.equal(calls[1].p_time,'2099-01-10T15:00:00.000Z');
  assert.equal(calls[1].p_version,0);
  complete({...empty,version:1,desired_at:calls[1].p_time}); await flush();
  assert.match(el('jointPlanStatus').textContent,/Terminentwurf gespeichert/);
  el('jointPlanRefresh').click();
  view.select({...file,id:'video2'},'owner');
  complete({...empty,desired_at:'2099-03-20T12:00Z'}); await flush();
  assert.equal(el('jointPlanTime').value,'');
  assert.equal(el('jointPlanChannels').textContent,'');
  view.select(null,null);
  assert.equal(el('jointPlan').hidden,true);
});
