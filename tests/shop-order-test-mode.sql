-- Run after the source-version and reconciliation suites in the SAME rollback.
create temp table test_mode_assertions(name text primary key,passed boolean not null);
do $$
declare before_row jsonb; after_row jsonb; rejected boolean; flag boolean; row_id integer:=-10;
begin
  foreach flag in array array[false,true] loop
    insert into guard_orders(id,user_id,kunde_id,markt,markt_konto_id,externe_bestell_id,
      erstellt_am,quelle_aktualisiert_am,zahlungsstatus,gesamtbetrag,ist_testbestellung)
    values(row_id,'00000000-0000-0000-0000-000000000001','customer-a','shopify','account-a',
      'gid://shopify/Order/'||abs(row_id),'2026-01-01T10:00:00Z','2026-01-01T10:01:00Z','paid',85.79,flag);
    assert (select ist_testbestellung=flag from guard_orders where id=row_id);
    insert into test_mode_assertions values('boolean '||flag||' is preserved on insert',true);
    update guard_orders set ist_testbestellung=null,quelle_aktualisiert_am='2026-01-01T10:02:00Z' where id=row_id;
    assert (select ist_testbestellung=flag from guard_orders where id=row_id);
    insert into test_mode_assertions values('legacy sender cannot clear '||flag,true);
    rejected:=false;
    begin
      update guard_orders set ist_testbestellung=not flag,quelle_aktualisiert_am='2026-01-01T10:03:00Z' where id=row_id;
    exception when check_violation then rejected:=true; end;
    assert rejected;
    insert into test_mode_assertions values('known '||flag||' cannot be flipped',true);
    row_id:=row_id-1;
  end loop;
  insert into guard_orders(id,user_id,kunde_id,markt,markt_konto_id,externe_bestell_id,
    erstellt_am,quelle_aktualisiert_am,zahlungsstatus,gesamtbetrag)
  values(-12,'00000000-0000-0000-0000-000000000001','customer-a','shopify','account-a',
    'gid://shopify/Order/12','2026-01-01T10:00:00Z','2026-01-01T10:02:00Z','paid',85.79);
  assert (select ist_testbestellung is null from guard_orders where id=-12);
  insert into test_mode_assertions values('missing marker stays unknown',true);
  update guard_orders set ist_testbestellung=true,quelle_aktualisiert_am='2026-01-01T10:01:00Z' where id=-12;
  assert (select ist_testbestellung is null from guard_orders where id=-12);
  insert into test_mode_assertions values('stale snapshot cannot classify unknown order',true);
  select to_jsonb(t) into before_row from guard_orders t where id=-12;
  update guard_orders set ist_testbestellung=true,gesamtbetrag=0,zahlungsstatus='refunded' where id=-12;
  select to_jsonb(t) into after_row from guard_orders t where id=-12;
  assert (after_row->>'ist_testbestellung')::boolean is true;
  assert after_row-'ist_testbestellung'-'updated_at'=before_row-'ist_testbestellung'-'updated_at';
  insert into test_mode_assertions values('equal-revision enrichment cannot change business data',true);
  update guard_orders set ist_testbestellung=false,gesamtbetrag=0 where id=-12;
  assert (select to_jsonb(t)=after_row from guard_orders t where id=-12);
  insert into test_mode_assertions values('equal-revision replay preserves known marker and timestamp',true);
end; $$;

-- The recovery fixture was left failed by the existing suite; claim it afresh.
select pg_temp.reclaim();
update fixture set payload=jsonb_set(jsonb_set(payload,'{orders,0,zahlungsstatus}','"refunded"'),'{orders,0,ist_testbestellung}','true');
select pg_temp.ok('recovery enriches equal source timestamp',pg_temp.complete()->>'updated'='1');
select pg_temp.ok('recovery keeps true test flag',(select ist_testbestellung is true from public.sma_bestellungen where externe_bestell_id='gid://shopify/Order/99999999000001'));
select pg_temp.reclaim();
select pg_temp.ok('repeated enrichment is idempotent',pg_temp.complete()->>'unchanged'='1');
select pg_temp.reclaim();
update fixture set payload=jsonb_set(payload,'{orders,0,ist_testbestellung}','false');
select pg_temp.ok('contradictory test flag is a visible conflict',pg_temp.complete()->>'timestamp_conflicts'='1');
select pg_temp.reclaim();
update fixture set payload=jsonb_set(payload,'{orders,0,ist_testbestellung}','"false"');
do $$ begin
  begin
    perform pg_temp.complete(); raise exception 'TEST_EXPECTED_FAILURE';
  exception when others then if SQLERRM='TEST_EXPECTED_FAILURE' then raise; end if; end;
  perform pg_temp.ok('string flag is rejected',true);
end; $$;
