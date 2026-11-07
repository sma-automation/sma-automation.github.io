// Continue the closed-dashboard render with its real saved receipt and synthetic AAC/MP4.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import handoff from '../../n8n/publishing/publisher-handoff.cjs';

export async function checkSoundtrackProduct({db,value,sql,uid,jobId}) {
  await db.exec(`alter table public.sma_kunden add column kunde_id text default 'fixture',
    add column shop_slug text default 'fixture',add column shop_oeffentlich boolean default true;
    create table public.sma_produkte(id bigint generated always as identity primary key,user_id uuid,kunde_id text,
      produkt_name text,sku text,sma_produkt_id text,beschreibung text,aktiv boolean);
    grant select on public.sma_produkte to service_role;`);
  for(const name of ['publication-preview','publication-files','publication-caption-history','publication-assignment-history','publication-text-edits']) {
    await db.exec(await sql(name));
  }
  for(const name of ['publication-editor-exports','publication-magic-effect']){
    await db.exec((await sql(name)).split('create or replace function')[0]);
  }
  await db.exec(`alter table sma_private.publication_editor_exports_v1 add column local_probe jsonb;
    create function sma_private.publication_export_technical_v1(sma_private.publication_files_v1) returns jsonb language sql as $$select null::jsonb$$;`);
  for(const name of ['publication-product-context','publication-optimizer-file-labels','publication-draft-product-links','gallery-music-product-context']){
    await db.exec(await sql(name));
  }
  const job=await value('select to_jsonb(j) v from sma_private.gallery_music_v1 j where id=$1',[jobId]);
  const output=await value('select to_jsonb(f) v from sma_private.publication_files_v1 f where id=$1',[job.result_id]);
  await db.query("insert into public.sma_produkte(user_id,kunde_id,produkt_name,sku,sma_produkt_id,aktiv) values($1,'fixture','Testlampe','Demo-SKU','lamp-01',true)",[uid]);
  const roleRead=async(role,query,params)=>{
    await db.exec('set role '+role);
    try{return await value(query,params);}finally{await db.exec('reset role');}
  };
  const rpc=(action,input)=>roleRead('authenticated','select public.sma_publication_files_v1($1,$2) v',[action,input]);
  const selection={asset_id:output.id,asset_revision:output.revision,platform:'youtube'};
  const context=async (changes={})=>(await rpc('product',{...selection,...changes})).product_context;
  const label=async ()=>(await rpc('list',{platform:'youtube'})).files.find(f=>f.id===output.id)?.display;
  const destination='https://sma-automation.com/app/shop.html?shop=fixture';
  const positive=await context();
  assert.equal(positive.product_id,'lamp-01');
  assert.equal(positive.asset_id,output.id);
  assert.equal(positive.asset_revision,output.revision);
  assert.equal(positive.visual,null);
  assert.deepEqual(await label(),{variant:'soundtrack',product:'Testlampe',source_name:'Demo-SKU.mp4'});

  // Opening a new per-portal draft captures the product on the music file itself.
  for(const platform of ['youtube','tiktok']){
    const preview=randomUUID(),body='Eine Lampe im synthetischen Testvideo.';
    const draft={platform,title:'Die Testlampe',body,hashtags:[],review_notes:[],caption:body+'\n\n🛒 Zum Shop: '+destination};
    await db.query(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
      values($1,$2,1,$3,$4,'completed',$5)`,[preview,uid,{language:'de',media_kind:'video',platforms:[platform]},destination,
        {language:'de',shop_url:destination,can_publish:false,drafts:[draft]}]);
    const assigned=await rpc('assign',{...selection,platform,assignment_revision:0,preview_id:preview,preview_revision:1});
    assert.equal(assigned.ok,true,JSON.stringify(assigned));
    const response=await roleRead('service_role','select public.sma_publication_assignment_v1(1,$1,$2,$3) v',[output.drive_file_id,output.revision,platform]);
    const prepared=handoff.makeHandoff(response,{...selection,platform,version:1,customer_id:1,drive_file_id:output.drive_file_id,
      assignment_revision:1,preview_id:preview,preview_revision:1,shop_url:destination,media_kind:'video'});
    assert.equal(prepared.draft.caption,body+'\n\n🛒 Zum Produkt: '+destination+'&produkt=lamp-01');
    assert.equal(prepared.can_publish,false);
    assert.equal(prepared.can_upload,false);
  }

  // A rename changes no bytes. A recovered catalogue receipt can precede the upload acknowledgement.
  await db.query("update sma_private.publication_files_v1 set name='Umbenannt.mp4' where id=$1",[output.id]);
  assert.equal((await label()).variant,'soundtrack');
  await db.exec('begin');
  await db.query("update sma_private.publication_uploads_v1 set status='ready',asset_id=null where id=$1",[jobId]);
  assert.equal((await context()).product_id,'lamp-01');
  await db.exec('rollback');
  for(const [query,id] of [
    ["update sma_private.gallery_music_v1 set state='check_upload' where id=$1",jobId],
    ["update sma_private.gallery_music_v1 set expected_sha=repeat('d',64) where id=$1",jobId],
    ["update sma_private.gallery_music_v1 set expected_size=expected_size+1 where id=$1",jobId],
    ["update sma_private.publication_uploads_v1 set drive_file_id='unrelated-drive-file' where id=$1",jobId],
    ["update sma_private.publication_uploads_v1 set user_id=gen_random_uuid() where id=$1",jobId],
    ["update sma_private.publication_uploads_v1 set asset_id=null where id=$1",jobId],
    ["update sma_private.publication_files_v1 set available=false where id=$1",job.source_id],
    ["update sma_private.publication_files_v1 set revision='version:other' where id=$1",job.source_id],
  ]){
    await db.exec('begin');
    await db.query(query,[id]);
    assert.equal(await context(),null,query);
    assert.equal((await label()).variant,undefined,query);
    await db.exec('rollback');
  }
  await db.exec('begin');
  await db.query("update sma_private.publication_files_v1 set name='lamp-02.mp4' where id=$1",[output.id]);
  await db.query("insert into public.sma_produkte(user_id,kunde_id,produkt_name,sma_produkt_id,aktiv) values($1,'fixture','Zweite Lampe','lamp-02',true)",[uid]);
  const conflict=await context();
  assert.equal(conflict.state,'ambiguous');
  assert.equal(conflict.product_id,undefined);
  await db.exec('rollback');

  // A verified editor export of the music video follows both edges.
  const revision='sha256:'+'f'.repeat(64)+':3';
  const clip=await value(`insert into sma_private.publication_files_v1(customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes)
    values(1,$1,'clip_after_music','Ausschnitt.mp4','video','video/mp4',$2,now(),1200) returning id v`,[uid,revision]);
  await db.query(`insert into sma_private.publication_editor_exports_v1(id,user_id,customer_id,asset_id,asset_revision,draft_revision,settings,outputs,media_asset_id,completed_at)
    values($1,$2,1,$3,$4,1,'{}',$5,$6,now())`,[randomUUID(),uid,output.id,output.revision,{media:{sha256:'f'.repeat(64),size_bytes:1200}},clip]);
  assert.equal((await context({asset_id:clip,asset_revision:revision})).product_id,'lamp-01');
  assert.equal((await label()).variant,'soundtrack');
  assert.equal(await value("select has_function_privilege('authenticated','sma_private.gallery_music_source_file_v1(sma_private.publication_files_v1)','execute') v"),false);
  console.log('Verified gallery music source, product links in both portal drafts, mixed export lineage, isolation, changed bytes and ambiguous products passed.');
}
