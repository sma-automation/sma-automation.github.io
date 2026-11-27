// Called inside the isolated manual-review fixture after the original TikTok consent.
import assert from 'node:assert/strict';
import {verifyTikTokSlotRevision} from './tiktok-slot-revision.mjs';
import {readFile} from 'node:fs/promises';

export async function verifyBlockedTextRevision({db,src,id,uid,rev,target,choices,evidence,review,human,request,other}) {
  await db.exec('savepoint text_revision_fixture');
  await db.exec(`create schema cron;
    create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    create table sma_private.publication_editor_exports_v1(customer_id bigint,user_id uuid,asset_id uuid,media_asset_id uuid);
    create table sma_private.gallery_music_v1(customer_id bigint,user_id uuid,source_id uuid,result_id uuid)`);
  for (const name of ['publication-joint-plan','publication-daily-schedule','publication-gallery-rotation','publication-rotation-dispatch']) {
    await db.exec(await src(name));
  }
  const migration=await src('publication-blocked-text-revision');
  assert.equal(migration,await readFile(new URL('../../supabase/migrations/20261126232349_publication_blocked_text_revision_v1.sql',import.meta.url),'utf8'));
  await db.exec(migration);
  const original=id(10), candidate=id(71), asset=id(1), preview=id(2), source=id(73);
  await db.exec("update public.sma_kunden set shop_oeffentlich=true,shop_slug='fixture' where id=91");
  await db.query(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,revision)
    values($1,$2,91,'{}','https://sma-automation.com/app/shop.html?shop=fixture','completed',2)`,[preview,uid]);
  await db.query(`insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,revision,draft)
    values($1,'tiktok',$2,2,$3,2,'{"platform":"tiktok","title":"Corrected","caption":"Corrected caption"}')`,[asset,preview,rev]);
  await db.query(`update sma_private.publication_orders_v1 set blockers=blockers||'["PORTAL_TEXT_COMPARISON"]'::jsonb where id=$1`,[original]);
  await db.query(`insert into sma_private.publication_rotation_sources_v1(id,customer_id,owner_id,source_folder,processing_folder)
    values($1,91,$2,'source','processing')`,[source,uid]);
  await db.query(`insert into sma_private.publication_rotation_channels_v1 values($1,'tiktok',$2,now()-interval '1 day')`,[source,target.id]);
  await db.query(`insert into sma_private.publication_joint_plans_v1
    (customer_id,asset_id,owner_id,asset_revision,desired_at,version,daily_slot,plan_day,portal_times)
    values(91,$1,$2,$3,now()+interval '1 day',3,1,current_date+1,jsonb_build_object('tiktok',now()+interval '1 day'))`,[asset,uid,rev]);
  await db.query(`insert into sma_private.publication_rotation_deliveries_v1
    select o.id,$2,'tiktok',o.target->>'id',$3,o.binding->>'asset_revision',sma_private.publication_provider_fingerprint_v1(o),
    3,now()+interval '1 day',now()+interval '1 day' from sma_private.publication_orders_v1 o where o.id=$1`,[original,source,asset]);
  const input={id:candidate,asset_id:asset,platform:'tiktok',asset_revision:rev,preview_id:preview,preview_revision:2,
    assignment_revision:2,expected_target_id:target.id,choices:{...choices,brand_organic_toggle:true}};
  const queryRow=async(q,args=[])=>(await db.query(q,args)).rows[0];
  const slot=()=>queryRow('select order_id,due_at,plan_version,fingerprint from sma_private.publication_rotation_deliveries_v1');
  const oldSlot=await slot();
  for(const block of [
    "update sma_private.publication_orders_v1 set blockers=blockers||'[\"OTHER\"]'::jsonb",
    "update sma_private.publication_rotation_deliveries_v1 set due_at=now()-interval '1 second'",
    "insert into sma_private.publication_provider_permissions_v1(order_id,fingerprint,expires_at) select order_id,fingerprint,now()+interval '1 day' from sma_private.publication_rotation_deliveries_v1",
    "insert into sma_private.publication_provider_attempts_v1(order_id,fingerprint,platform,target_id,visibility,size_bytes) select order_id,fingerprint,platform,target_id,'SELF_ONLY',100 from sma_private.publication_rotation_deliveries_v1"
  ]) {
    await db.exec('savepoint ineligible');await db.exec(block);
    assert.equal((await request('prepare',input)).code,'DUPLICATE_PUBLICATION');
    await db.exec('rollback to ineligible');
  }
  assert.equal((await request('prepare',input,other)).code,'FILE_UNAVAILABLE');
  const first=await request('prepare',input);
  assert.equal(first.state,'preparing',JSON.stringify(first));assert.equal(first.approved_at,null);
  assert.equal((await request('prepare',input)).id,candidate);
  const rival=id(72);
  assert.equal((await request('prepare',{...input,id:rival})).state,'preparing');
  assert.deepEqual(await slot(),oldSlot);
  await db.query("update sma_private.publication_orders_v1 set target=$1,account_check=$2,state='prepared' where id in ($3,$4)",[target,evidence,candidate,rival]);
  const prepared=await request('get',{id:candidate});
  const approval={id:candidate,approval_token:prepared.approval_token,confirm:true,review};
  assert.equal((await request('approve',approval)).code,'HUMAN_REVIEW_UNAVAILABLE');
  const full={...approval,review:{...review,human_review:{...human,...prepared.human_review_option}}};
  assert.equal((await request('approve',{...full,confirm:false})).code,'FINAL_APPROVAL_REQUIRED');
  await db.exec('savepoint pending_text');
  await db.exec(`update sma_private.manual_fixture set m=jsonb_set(m,'{checks}',(
    select jsonb_agg(case when item->>'code'='PORTAL_TEXT_COMPARISON'
      then item||'{"status":"pending"}'::jsonb else item end) from jsonb_array_elements(m->'checks') item
  ))`);
  assert.equal((await request('approve',full)).code,'HUMAN_REVIEW_UNAVAILABLE');
  await db.exec('rollback to pending_text');
  await db.exec('savepoint failed_transfer');
  await db.query('insert into sma_private.publication_rotation_exclusions_v1 values($1,$2)',[source,asset]);
  await db.exec('set local role authenticated');
  await assert.rejects(db.query("select public.sma_publication_order_v1('approve',$1)",[full]),/SCHEDULE_NOT_CURRENT/);
  await db.exec('rollback to failed_transfer');
  assert.deepEqual(await slot(),oldSlot);
  const accepted=await request('approve',full);
  assert.equal(accepted.state,'approved',JSON.stringify(accepted));assert.equal(accepted.choices.brand_organic_toggle,true);
  assert.equal((await request('approve',full)).approved_at,accepted.approved_at);
  const newSlot=await slot();
  assert.equal(newSlot.order_id,candidate);assert.deepEqual(newSlot.due_at,oldSlot.due_at);
  assert.equal(newSlot.plan_version,oldSlot.plan_version);assert.notEqual(newSlot.fingerprint,oldSlot.fingerprint);
  const rivalView=await request('get',{id:rival});
  assert.equal((await request('approve',{id:rival,approval_token:rivalView.approval_token,confirm:true,
    review:{...review,human_review:{...human,...rivalView.human_review_option}}})).code,'ORDER_CHANGED');
  assert.deepEqual((await db.query('select order_id from sma_private.publication_journal_v1')).rows,[{order_id:candidate}]);
  assert.equal((await request('get',{id:original})).state,'blocked');
  for(const table of ['publication_provider_permissions_v1','publication_provider_attempts_v1']) {
    assert.equal((await queryRow('select count(*)::int as n from sma_private.'+table)).n,0);
  }
  await verifyTikTokSlotRevision({db,src,id,input,prior:candidate,request,target,evidence,review,human,slot});
  await db.exec('rollback to text_revision_fixture');
}
