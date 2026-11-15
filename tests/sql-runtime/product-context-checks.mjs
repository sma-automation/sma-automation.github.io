import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {checkProductComparison} from './product-comparison-checks.mjs';
import catalogWorkflow from '../fixtures/private-file-catalog.cjs';
import {verifiedFolders} from '../../n8n/publishing/file-catalog.cjs';
import {filterDashboardFiles,searchFilePage} from '../../app/assets/dashboard-file-search.mjs';

async function checkDashboardCatalogPages({db,first,asUser,dashboardList,owner,other}){
  // Separate RPC calls commit independently, as they do for the dashboard and worker.
  try{
    const foreign='f0000000-0000-4000-8000-000000009999';
    await db.query(`insert into sma_private.publication_files_v1
      (id,customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes)
      values ($1,2,$2,'foreign_fixture','Fremder Ordner.mp4','video','video/mp4','test',now(),10)`,[foreign,other]);
    await db.exec('grant select on public.sma_kunden to service_role');
    await asUser(owner);
    const row={kunde_id:'fixture',kunde_email:'fixture@example.test',upload_folder_id:'upload_fixture',processing_folder_id:'processing_fixture',zugang_aktiv:true,demo_delta_aktiv:true};
    const mapping=verifiedFolders([row],{ok:true,n8n_kunde_id:row.kunde_id,kunde_email:row.kunde_email});
    const source={parents:[row.upload_folder_id],mimeType:'video/mp4',version:'1',size:'1000',modifiedTime:'2026-11-14T11:00:00Z'};
    const firstPage=Array.from({length:1000},(_,i)=>({...source,id:'drive_fixture_'+i,name:'Kundenclip '+i+'.mp4'}));
    const video=await readFile(new URL('../fixtures/original-video.mp4',import.meta.url));
    const target={...source,id:'drive_fixture_1000',name:'Werkstatt Finale.mp4',
      parents:[row.processing_folder_id],modifiedTime:'2026-11-13T11:00:00Z',
      size:String(video.length),sha256Checksum:createHash('sha256').update(video).digest('hex'),
      videoMediaMetadata:{width:160,height:90,durationMillis:'3000'}};
    async function scan(mode='complete',whileReserved){
      await db.exec('reset role');
      await db.query("update sma_private.publication_file_sync_v1 set started_at=now()-interval '20 seconds' where user_id=$1",[owner]);
      await db.exec('set role authenticated');
      const lease=await first("select public.sma_publication_files_v1('sync_start') value");
      assert(lease.ok);
      if(whileReserved)await whileReserved();
      let calls=0,finishes=0;
      await db.exec('reset role; set role service_role');
      const result=await catalogWorkflow.runCatalog({mapping,lease,readPage:query=>{
        calls++;
        if(calls===1){
          assert(!Object.hasOwn(query,'pageToken'));
          if(mode==='first-only')return {files:firstPage};
          return {files:mode==='interrupt'?[{...firstPage[0],name:'Unvollständige Änderung.mp4'}]:firstPage,nextPageToken:'weiter/+=1'};
        }
        assert.equal(query.pageToken,'weiter/+=1');
        if(mode==='interrupt')throw Error('Drive connection lost');
        return {files:[target]};
      },finish:async({p_user_id,p_lease_id,p_files,p_error})=>{
        finishes++;
        assert.equal(p_user_id,owner);assert.equal(p_lease_id,lease.lease_id);
        return first('select public.sma_publication_files_finish_v1($1,$2,$3,$4) value',
          [p_user_id,p_lease_id,p_files?JSON.stringify(p_files):null,p_error??null]);
      }});
      assert.equal(calls,mode==='first-only'?1:2);assert.equal(finishes,1);
      assert.equal(await first('select lease_id is null and lease_until is null as value from sma_private.publication_file_sync_v1 where user_id=$1',[owner]),true);
      await db.exec('reset role; set role authenticated');
      return result;
    }
    await db.exec('set role authenticated');
    const previous=await dashboardList();
    assert.equal(previous.sync_state,'idle');
    assert(!previous.files.some(f=>f.name===target.name));
    assert.deepEqual(await scan('interrupt'),{ok:false,code:'FILE_SYNC_UNAVAILABLE'});
    assert.deepEqual(await dashboardList(),{...previous,sync_state:'interrupted'});
    assert.deepEqual(await scan(),{ok:true,count:1001});
    const own=await dashboardList(),wanted=own.files.at(-1);
    assert.equal(own.sync_state,'complete');
    assert.equal(own.files.length,1001);assert.equal(wanted.name,target.name);
    assert.deepEqual(own.files.slice(0,-1).map(f=>f.id),own.files.slice(0,-1).map(f=>f.id).sort());
    assert.equal(searchFilePage(own.files,wanted.id),100);
    assert.deepEqual(filterDashboardFiles(own.files,'Werkstatt Finale').map(f=>f.id),[wanted.id]);
    const portalList=()=>first(`select public.sma_publication_files_v1('list','{"platform":"youtube"}') value`);
    assert.equal((await portalList()).files.at(-1).id,wanted.id);
    assert(!Object.hasOwn(await portalList(),'sync_state'));
    assert.deepEqual(await scan('interrupt'),{ok:false,code:'FILE_SYNC_UNAVAILABLE'});
    assert.deepEqual(await dashboardList(),{...own,sync_state:'interrupted'});
    if(process.argv.includes('--catalog-browser')){
      const {checkPrivateCatalogReturn}=await import('../run-dashboard-mobile.mjs');
      await checkPrivateCatalogReturn({wanted,dashboardList,portalList,scan});
    }
    await db.exec('reset role');
    await db.query("update sma_private.publication_file_sync_v1 set started_at=now()-interval '20 seconds' where user_id=$1",[owner]);
    await db.exec('set role authenticated');
    const lease=await first("select public.sma_publication_files_v1('sync_start') value");
    assert(lease.ok);
    const running=await dashboardList();assert.equal(running.sync_state,'running');
    await asUser(other);const isolated=await dashboardList();
    assert.deepEqual(isolated.files.map(f=>f.id),[foreign]);assert.equal(isolated.sync_state,'idle');assert.equal(isolated.synced_at,null);
    await asUser(owner);await db.exec('reset role');
    await db.query("update sma_private.publication_file_sync_v1 set lease_until=now()-interval '1 second' where user_id=$1",[owner]);
    await db.exec('set role service_role');
    assert.equal((await first("select public.sma_publication_files_finish_v1($1,$2,'[]',null) value",[owner,lease.lease_id])).code,'INVALID_LEASE');
    await db.exec('reset role; set role authenticated');
    assert.deepEqual(await dashboardList(),{...running,sync_state:'interrupted'});
    console.log('Two Drive pages, atomic 1001-file finish, dashboard and portal reads, failed refresh before and after success, and tenant isolation passed.');
  }finally{await db.exec('reset role');}
}

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
  await db.exec(files.slice(files.indexOf('create or replace function public.sma_publication_files_finish_v1'),
    files.indexOf('-- Publisher contract:')));
  await db.exec(await load('publication-product-context.sql'));
  const installedFinish=await load('../migrations/20261113163657_publication_content_bound_metadata_v1.sql');
  await db.exec(installedFinish.split('CREATE OR REPLACE FUNCTION public.sma_publication_upload_finish_v1')[0]);
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
  await db.exec(await load('dashboard-file-titles.sql'));
  const pages=await load('publication-file-catalog-pages.sql');
  assert.equal(pages,await load('../migrations/20261114222500_publication_file_catalog_pages_v1.sql'));
  await db.exec(pages);
  const status=await load('publication-file-catalog-status.sql');
  assert.equal(status,await load('../migrations/20261115001000_publication_file_catalog_status_v1.sql'));
  await db.exec(status);
  const dashboardList=()=>first("select public.sma_publication_files_v1('list', '{\"dashboard_labels\":true}') value");
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
  const dashboardFiles=(await dashboardList()).files;
  const clip=dashboardFiles.find(f=>f.id===output.id);
  assert.deepEqual(clip.display,{variant:'clip',source_name:'unlabelled.mp4'});
  assert.equal(clip.assignments.find(a=>a.platform==='youtube').title,'Ein kurzer Test');
  assert.equal(dashboardFiles.find(f=>f.id===cover).display.variant,'cover');
  assert((await catalog()).files.every(f=>f.assignments.every(a=>!('title' in a))));
  await db.exec('insert into public.sma_kunden(id,user_id) values(200,gen_random_uuid())');
  for(const change of [
    "update sma_private.publication_previews_v1 set status='failed'",
    "update sma_private.publication_assignments_v1 set asset_revision='stale'",
    "update sma_private.publication_assignments_v1 set preview_revision=preview_revision+1",
    "update sma_private.publication_previews_v1 set user_id=gen_random_uuid()",
    "update sma_private.publication_previews_v1 set customer_id=200"
  ]){
    await db.exec('savepoint check_binding');await db.exec(change);
    assert((await dashboardList()).files.every(f=>f.assignments.every(a=>!('title' in a))));
    await db.exec('rollback to savepoint check_binding');
  }
  await db.query('update sma_private.publication_files_v1 set size_bytes=size_bytes+1 where id=$1',[cover]);
  assert.equal((await catalog('youtube')).files.find(f=>f.id===cover).display.variant,undefined);
  await db.exec('rollback');
  assert.equal(await first("select has_function_privilege('authenticated','sma_private.publication_optimizer_file_label_v1(sma_private.publication_files_v1,text)','execute') value"),false);
  await checkProductComparison({db,first,load,output,profile});
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
  const other=await first('select user_id value from public.sma_kunden where id=2');
  await asUser(other);
  assert.deepEqual((await catalog('youtube')).files,[]);
  assert.equal((await read()).code,'FILE_UNAVAILABLE');
  assert.equal(await first('select sma_private.publication_product_context_v1($1) value',[output.id]),null);
  for(const table of ['publication_product_profiles_v1','publication_product_sources_v1']){
    for(const role of ['anon','authenticated','service_role']) {
      assert.equal(await first("select has_table_privilege($1,$2,'select') value",[role,'sma_private.'+table]),false);
    }
  }
  await checkDashboardCatalogPages({db,first,asUser,dashboardList,owner:output.user_id,other});
  console.log('Product context SQL passed for authenticated reads, export lineage, catalog, OCR, ambiguity and tenant isolation.');
}
