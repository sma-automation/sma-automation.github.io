import assert from 'node:assert/strict';

export async function checkProductContext({db,load,first}) {
  const files=await load('publication-files.sql');
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    alter table public.sma_kunden add column kunde_id text default 'fixture';
    create table public.sma_produkte(id bigint generated always as identity primary key, user_id uuid,
      kunde_id text, produkt_name text, sku text, sma_produkt_id text, beschreibung text, aktiv boolean);
  `);
  await db.exec(files.slice(files.indexOf('create or replace function sma_private.publication_files_request_v1'),
    files.indexOf('grant execute on function public.sma_publication_files_v1'))+
    'grant execute on function public.sma_publication_files_v1(text,jsonb) to authenticated;');
  await db.exec(await load('publication-product-context.sql'));
  const output=await first('select to_jsonb(f) value from sma_private.publication_files_v1 f');
  const parentHash='b'.repeat(64);
  const source=await first(`insert into sma_private.publication_files_v1(customer_id,user_id,drive_file_id,name,
    media_kind,mime_type,revision,modified_at,size_bytes)
    values (1,$1,'fixture-parent','unlabelled.mp4','video','video/mp4',$2,now(),40000) returning id value`,
    [output.user_id,'sha256:'+parentHash+':1']);
  await db.query(`update sma_private.publication_editor_exports_v1 set asset_id=$1,asset_revision=$2`,
    [source,'sha256:'+parentHash+':1']);
  const profile=await first(`insert into sma_private.publication_product_profiles_v1(customer_id,user_id,name,topic,purpose)
    values(1,$1,'Hotelgriff','Reisehygiene','Betätigt die vorhandene Türklinke.') returning id value`,[output.user_id]);
  const read=(action='product',extra={})=>first('select public.sma_publication_files_v1($1,$2) value',
    [action,JSON.stringify({asset_id:output.id,asset_revision:output.revision,platform:'youtube',...extra})]);
  const asUser=user=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  assert.equal((await read()).code,'AUTH_REQUIRED');
  await asUser(output.user_id);
  assert.equal((await read()).product_context,null);
  await db.query(`insert into sma_private.publication_product_sources_v1 values(1,$1,$2,$3)`,[output.user_id,parentHash,profile]);
  await db.exec(await load('publication-optimizer-file-labels.sql'));
  const catalog=async(platform)=>first("select public.sma_publication_files_v1('list',$1) value",[JSON.stringify(platform?{platform}:{})]);
  assert.ok((await catalog()).files.every(f=>!('display' in f)));
  await db.exec('begin');
  await db.query('update sma_private.publication_files_v1 set duration_ms=10000 where id=$1',[source]);
  const coverHash='c'.repeat(64);
  const cover=await first(`insert into sma_private.publication_files_v1(customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes)
    values(1,$1,'fixture-cover','technical-cover.png','image','image/png',$2,now(),54321) returning id value`,[output.user_id,'sha256:'+coverHash+':1']);
  await db.query(`update sma_private.publication_editor_exports_v1 set cover_asset_id=$1,
    outputs=jsonb_set(outputs,'{cover}',jsonb_build_object('sha256',$2::text,'size_bytes',54321))`,[cover,coverHash]);
  const list=(await catalog('youtube')).files;
  const originalLabel=list.find(f=>f.id===source).display,clipLabel=list.find(f=>f.id===output.id).display;
  assert.equal(originalLabel.variant,'original');assert.equal(clipLabel.variant,'clip');
  assert.equal(clipLabel.product,'Hotelgriff');assert.equal(clipLabel.draft_title,'Ein kurzer Test');
  assert.equal(list.find(f=>f.id===cover).display.variant,'cover');
  assert.equal(list.find(f=>f.id===cover).display.product,'Hotelgriff');
  assert.equal((await catalog('instagram')).files.find(f=>f.id===output.id).display.draft_title,undefined);
  await db.query('update sma_private.publication_files_v1 set size_bytes=size_bytes+1 where id=$1',[cover]);
  assert.equal((await catalog('youtube')).files.find(f=>f.id===cover).display.variant,undefined);
  await db.exec('rollback');
  assert.equal(await first("select has_function_privilege('authenticated','sma_private.publication_optimizer_file_label_v1(sma_private.publication_files_v1,text)','execute') value"),false);
  const matched=(await read()).product_context;
  assert.equal(matched.name,'Hotelgriff');
  assert.equal(matched.topic,'Reisehygiene');
  assert.equal(matched.method,'media');
  assert.equal(matched.asset_revision,output.revision);
  assert.equal(matched.visual,'Ein Gerät an der Tür.');
  assert.deepEqual((await read('get')).product_context,matched);
  assert.deepEqual((await read('product',{platform:'tiktok'})).product_context,matched);
  assert.equal((await read('product',{asset_revision:'stale'})).code,'FILE_CHANGED');
  assert.equal((await read('product',{asset_id:source,asset_revision:'sha256:'+parentHash+':1'})).product_context.name,'Hotelgriff');
  for(const change of [
    "update sma_private.publication_editor_exports_v1 set completed_at=null,local_probe=null",
    "update sma_private.publication_editor_exports_v1 set asset_revision='changed'",
    "update sma_private.publication_editor_exports_v1 set customer_id=20",
    "update sma_private.publication_editor_exports_v1 set user_id=gen_random_uuid()",
    "update sma_private.publication_editor_exports_v1 set local_probe=null,outputs=jsonb_set(outputs,'{media,size_bytes}','1')",
    "update sma_private.publication_editor_exports_v1 set local_probe=null,outputs=jsonb_set(outputs,'{media,sha256}',to_jsonb(repeat('e',64)))"
  ]) {
    await db.exec('begin');await db.exec(change);
    assert.equal((await read()).product_context,null);
    await db.exec('rollback');
  }
  await db.exec('delete from sma_private.publication_product_sources_v1');
  await db.query(`insert into public.sma_produkte(user_id,kunde_id,produkt_name,sku,beschreibung,aktiv)
    values($1,'fixture','Reisetasche','TG-209','Tasche für Reisen',true)`,[output.user_id]);
  await db.query("update sma_private.publication_files_v1 set name=' tg-209 .mp4' where id=$1",[source]);
  assert.equal((await read()).product_context.name,'Reisetasche');
  await db.query("update sma_private.publication_files_v1 set name='TG-209 ähnlich.mp4' where id=$1",[source]);
  assert.equal((await read()).product_context,null);
  await db.query(`insert into sma_private.publication_magic_results_v1(asset_id,asset_revision,policy_version,user_id,
    customer_id,n8n_kunde_id,kunde_email,status,result,content_sha256) values ($1,$2,'magic-video-2026-11-03.1',
    $3,1,'fixture','fixture@example.test','completed','{"visible_text":["TG-209"]}',$4)`,[source,'sha256:'+parentHash+':1',output.user_id,parentHash]);
  assert.equal((await read()).product_context.method,'catalog');
  for(const change of [
    "update public.sma_produkte set aktiv=false", "update public.sma_produkte set kunde_id='foreign'",
    "update public.sma_produkte set user_id=gen_random_uuid()",
    "update sma_private.publication_magic_results_v1 set content_sha256=repeat('d',64)",
    "update sma_private.publication_magic_results_v1 set kunde_email='other@example.test'",
    "update sma_private.publication_magic_results_v1 set status='failed'"
  ]) {
    await db.exec('begin');await db.exec(change);assert.equal((await read()).product_context,null);await db.exec('rollback');
  }
  await db.query("update sma_private.publication_files_v1 set name='Hotelgriff.mp4' where id=$1",[output.id]);
  assert.equal((await read()).product_context.state,'ambiguous');
  await db.exec("insert into public.sma_kunden(id,user_id,aktiv,demo_delta_aktiv,kunde_id) values(2,gen_random_uuid(),true,true,'foreign')");
  await asUser(await first('select user_id value from public.sma_kunden where id=2'));
  assert.deepEqual((await catalog('youtube')).files,[]);
  assert.equal((await read()).code,'FILE_UNAVAILABLE');
  assert.equal(await first('select sma_private.publication_product_context_v1($1) value',[output.id]),null);
  for(const table of ['publication_product_profiles_v1','publication_product_sources_v1']){
    for(const role of ['anon','authenticated','service_role']) {
      assert.equal(await first("select has_table_privilege($1,$2,'select') value",[role,'sma_private.'+table]),false);
    }
  }
  console.log('Product context SQL passed for authenticated reads, export lineage, catalog, OCR, ambiguity and tenant isolation.');
}
