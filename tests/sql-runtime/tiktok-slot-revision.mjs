import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function verifyTikTokSlotRevision({db,src,id,input,prior,request,target,evidence,review,human,slot}) {
  const migration=await src('publication-tiktok-slot-revision');
  assert.equal(migration,await readFile(new URL('../../supabase/migrations/20261127002850_publication_tiktok_slot_revision_v1.sql',import.meta.url),'utf8'));
  await db.exec(migration);
  const nextRevision=input.asset_revision.replace(/:[0-9]+$/,':12');
  const replacement=id(79);
  const preparedInput={...input,id:replacement,asset_revision:nextRevision,assignment_revision:3};
  await db.query("update sma_private.publication_orders_v1 set state='blocked',blockers='[\"FILE_CHANGED\"]' where id=$1",[prior]);
  const oldSlot=await slot();
  await db.query('update sma_private.publication_files_v1 set revision=$1 where id=$2',[nextRevision,input.asset_id]);
  await db.query("update sma_private.publication_assignments_v1 set asset_revision=$1,revision=3,draft=draft||'{\"title\":\"New approved text\"}' where asset_id=$2 and platform='tiktok'",[nextRevision,input.asset_id]);
  await db.query("update sma_private.manual_fixture set m=jsonb_set(jsonb_set(m,'{asset_revision}',to_jsonb($1::text)),'{content_review,asset_revision}',to_jsonb($1::text))",[nextRevision]);
  assert.equal((await request('prepare',preparedInput)).state,'preparing');
  await db.query("update sma_private.publication_orders_v1 set target=$1,account_check=$2,state='prepared' where id=$3",[target,evidence,replacement]);
  const prepared=await request('get',{id:replacement});
  const consent={id:replacement,approval_token:prepared.approval_token,confirm:true,review:{...review,human_review:{...human,...prepared.human_review_option}}};

  await db.exec('savepoint undesignated');
  const withoutTransfer=await request('approve',consent);
  assert.equal(withoutTransfer.state,'approved',JSON.stringify(withoutTransfer));
  assert.deepEqual(await slot(),oldSlot);
  await db.exec('rollback to undesignated');
  await db.query('insert into sma_private.publication_tiktok_slot_revisions_v1(original_order_id,original_fingerprint,plan_version,due_at,new_revision) values($1,$2,$3,$4,$5)',
    [prior,oldSlot.fingerprint,oldSlot.plan_version,oldSlot.due_at,nextRevision]);
  assert.equal((await request('approve',{...consent,confirm:false})).code,'FINAL_APPROVAL_REQUIRED');
  const priorReceipt=(await request('get',{id:prior})).approval_review;
  assert.equal((await request('approve',{...consent,review:priorReceipt})).code,'HUMAN_REVIEW_UNAVAILABLE');
  assert.deepEqual(await slot(),oldSlot);

  for(const conflict of [
    "update sma_private.publication_tiktok_slot_revisions_v1 set plan_version=plan_version+1",
    "update sma_private.publication_tiktok_slot_revisions_v1 set due_at=due_at+interval '1 minute'",
    "insert into sma_private.publication_provider_permissions_v1(order_id,fingerprint,expires_at) select order_id,fingerprint,now()+interval '1 day' from sma_private.publication_rotation_deliveries_v1",
    "insert into sma_private.publication_provider_attempts_v1(order_id,fingerprint,platform,target_id,visibility,size_bytes) select order_id,fingerprint,platform,target_id,'SELF_ONLY',100 from sma_private.publication_rotation_deliveries_v1",
    "insert into sma_private.publication_rotation_exclusions_v1 select source_id,asset_id from sma_private.publication_rotation_deliveries_v1"
  ]){
    await db.exec('savepoint conflict');
    await db.exec(conflict);
    await db.exec('set local role authenticated');
    await assert.rejects(db.query("select public.sma_publication_order_v1('approve',$1)",[consent]),/SCHEDULE_NOT_CURRENT/);
    await db.exec('rollback to conflict');
    assert.deepEqual(await slot(),oldSlot);
    assert.equal((await request('get',{id:replacement})).approved_at,null);
  }
  // A fresh, valid consent for genuinely different bytes may never inherit this slot.
  await db.exec('savepoint changed_content');
  const changed='sha256:'+'b'.repeat(64)+':12';
  await db.query('update sma_private.publication_files_v1 set revision=$1 where id=$2',[changed,input.asset_id]);
  await db.query('update sma_private.publication_assignments_v1 set asset_revision=$1 where asset_id=$2',[changed,input.asset_id]);
  await db.query('update sma_private.publication_tiktok_slot_revisions_v1 set new_revision=$1',[changed]);
  await db.query("update sma_private.manual_fixture set m=jsonb_set(jsonb_set(m,'{asset_revision}',to_jsonb($1::text)),'{content_review,asset_revision}',to_jsonb($1::text))",[changed]);
  const different=id(80);
  assert.equal((await request('prepare',{...preparedInput,id:different,asset_revision:changed})).state,'preparing');
  await db.query("update sma_private.publication_orders_v1 set target=$1,account_check=$2,state='prepared' where id=$3",[target,evidence,different]);
  const changedView=await request('get',{id:different});
  const changedConsent={id:different,approval_token:changedView.approval_token,confirm:true,
    review:{...review,human_review:{...human,...changedView.human_review_option}}};
  await db.exec('set local role authenticated');
  await assert.rejects(db.query("select public.sma_publication_order_v1('approve',$1)",[changedConsent]),/SCHEDULE_NOT_CURRENT/);
  await db.exec('rollback to changed_content');
  assert.deepEqual(await slot(),oldSlot);

  const accepted=await request('approve',consent);
  assert.equal(accepted.state,'approved',JSON.stringify(accepted));
  assert.equal((await request('approve',consent)).approved_at,accepted.approved_at);
  const rebound=await slot();
  assert.equal(rebound.order_id,replacement);
  assert.deepEqual(rebound.due_at,oldSlot.due_at);
  assert.notEqual(rebound.fingerprint,oldSlot.fingerprint);
  const {rows:[facts]}=await db.query(`select d.asset_revision as revision,p.version=d.plan_version as plan_matches,
    sma_private.publication_rotation_current_v1(d) as is_current,r.replacement_order_id
    from sma_private.publication_rotation_deliveries_v1 d join sma_private.publication_joint_plans_v1 p
      on p.asset_id=d.asset_id and p.asset_revision=d.asset_revision
    join sma_private.publication_tiktok_slot_revisions_v1 r on r.replacement_order_id=d.order_id`);
  assert.deepEqual(facts,{revision:nextRevision,plan_matches:true,is_current:true,replacement_order_id:replacement});
  assert.equal((await request('get',{id:prior})).state,'blocked');
  for(const table of ['publication_provider_permissions_v1','publication_provider_attempts_v1'])
    assert.equal((await db.query('select count(*)::int as n from sma_private.'+table)).rows[0].n,0);
}
