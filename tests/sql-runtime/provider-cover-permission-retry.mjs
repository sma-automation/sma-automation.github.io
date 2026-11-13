// Run against the same completed-video fixture and real dispatcher as the first delivery.
export async function verifyPermissionRetry({db, src, run, proof, id, target, rev, eq}) {
  const history = await src('publication-history.sql');
  const covers = await src('publication-cover-history.sql');
  await db.exec(history.split('create or replace function sma_private.publication_history_read_v1(')[0]);
  await db.exec(covers.split('create or replace function sma_private.publication_history_read_v3(')[0]);
  await db.exec(await src('publication-cover-permission-retry.sql'));

  const retrySql = 'select sma_private.publication_retry_private_cover_v1($1,$2,$3,$4,$5) as outcome';
  const video = 'synthetic_1';
  const retry = async (lease, videoId = video, channelId = target.id, revision = rev) =>
    (await db.query(retrySql, [id(10), lease, videoId, channelId, revision])).rows[0].outcome;
  const snapshot = async table => (await db.query('select to_jsonb(t) as row from sma_private.' + table + ' t where order_id=$1 order by 1', [id(10)])).rows;
  const status = async () => (await db.query("select sma_private.publication_history_cover_v1(j)->>'status' as status from sma_private.publication_orders_v1 j where id=$1", [id(10)])).rows[0].status;

  for (const role of ['anon','authenticated','service_role']) {
    const rights = await db.query("select has_function_privilege($1,'sma_private.publication_retry_private_cover_v1(uuid,uuid,text,text,text)','EXECUTE') as call, has_table_privilege($1,'sma_private.publication_cover_permission_retries_v1','INSERT') as write", [role]);
    eq(rights.rows[0], {call:false,write:false});
  }
  for (const [state,code] of [['uncertain','COVER_RESPONSE_UNCERTAIN'],['failed','COVER_REJECTED'],['complete','COVER_ACCEPTED']]) {
    await db.exec('begin');
    const sending = await run('cover_begin',proof());
    eq(await retry(sending.lease_id),'COVER_RETRY_UNAVAILABLE');
    await run('cover_finish',{state,code},sending.lease_id);
    eq(await retry(sending.lease_id),'COVER_RETRY_UNAVAILABLE');
    await db.exec('rollback');
  }

  await db.exec('begin');
  const first = await run('cover_begin',proof());
  await run('cover_finish',{state:'failed',code:'COVER_PERMISSION_REQUIRED'},first.lease_id);
  const original = await snapshot('publication_provider_covers_v1');
  const videoBefore = await snapshot('publication_provider_attempts_v1');
  const eventsBefore = await snapshot('publication_provider_events_v1');
  eq(await retry(first.lease_id),'FRESH_OPERATOR_APPROVAL_REQUIRED');
  // Model a new operator grant after the response, inside this rollback-only test.
  await db.exec("update sma_private.publication_provider_covers_v1 set created_at=now()-interval '4 minutes',sent_at=now()-interval '3 minutes',finished_at=now()-interval '2 minutes'");
  await db.exec("update sma_private.publication_provider_permissions_v1 set created_at=now()-interval '1 minute'");
  const archived = await snapshot('publication_provider_covers_v1');
  eq(await retry(id(99)),'COVER_RETRY_UNAVAILABLE');
  eq(await retry(first.lease_id,'wrong_video'),'COVER_RETRY_UNAVAILABLE');
  eq(await retry(first.lease_id,video,'another_channel'),'COVER_RETRY_UNAVAILABLE');
  eq(await retry(first.lease_id,video,target.id,rev+':1'),'COVER_RETRY_UNAVAILABLE');
  for (const [mutation,expected] of [
    ["update sma_private.publication_provider_permissions_v1 set expires_at=now()", 'FRESH_OPERATOR_APPROVAL_REQUIRED'],
    ["update public.sma_kunden set aktiv=false", 'ACCESS_INACTIVE'],
    ["update sma_private.publication_files_v1 set available=false", 'COVER_CHANGED'],
    ["delete from sma_private.publication_provider_events_v1 where operation='status'", 'COVER_RETRY_UNAVAILABLE'],
    ["update sma_private.publication_orders_v1 set choices=jsonb_set(choices,'{visibility}','\"public\"')", 'ORDER_UNAVAILABLE']
  ]) {
    await db.exec('savepoint mutation');
    await db.exec(mutation);
    eq(await retry(first.lease_id),expected);
    await db.exec('rollback to mutation');
  }
  eq(await retry(first.lease_id),'COVER_READY');
  eq(await retry(first.lease_id),'COVER_RETRY_UNAVAILABLE');
  eq((await run('context')).cover_ready,true);
  eq((await run('provider_begin',proof())).code,'COVER_OPERATION_REQUIRED');
  eq((await run('cover_begin',{...proof(),account_check:null})).code,'TARGET_PERMISSIONS_REQUIRED');
  const second = await run('cover_begin',proof());
  eq(second.operation,'youtube_thumbnail');
  eq(second.provider_id,video);
  eq(second.lease_id!==first.lease_id,true);
  eq((await run('cover_begin',proof())).ok,false);
  eq((await run('cover_finish',{state:'complete',code:'COVER_ACCEPTED'},first.lease_id)).code,'INVALID_LEASE');
  eq((await run('cover_finish',{state:'complete',code:'COVER_ACCEPTED'},second.lease_id)).cover_state,'complete');
  eq(await status(),'complete');
  eq(await retry(second.lease_id),'COVER_RETRY_UNAVAILABLE');
  const saved = await snapshot('publication_cover_permission_retries_v1');
  eq(saved.length,1);
  eq(saved[0].row.previous_attempt,archived[0].row);
  eq(saved[0].row.previous_attempt.lease_id,original[0].row.lease_id);
  eq(await snapshot('publication_provider_attempts_v1'),videoBefore);
  eq(await snapshot('publication_provider_events_v1'),eventsBefore);
  await db.exec('rollback');
}
