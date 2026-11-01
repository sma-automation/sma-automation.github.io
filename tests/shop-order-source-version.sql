-- Run inside BEGIN/ROLLBACK. Uses a temporary table, no customer orders.
create temp table guard_orders (like public.sma_bestellungen including defaults);
create unique index on guard_orders(markt, markt_konto_id, externe_bestell_id);
create trigger source_guard before insert or update on guard_orders
for each row execute function sma_private.bestellung_quellstand_pruefen_v1();
create temp table guard_results (test text primary key, passed boolean not null);

do $$
declare
  old_row jsonb;
  result_row jsonb;
  rejected boolean;
begin
  insert into guard_orders(id, user_id, kunde_id, markt, markt_konto_id,
    externe_bestell_id, erstellt_am, zahlungsstatus, lieferstatus,
    gesamtbetrag, waehrung, quelle_aktualisiert_am)
  values(-1, '00000000-0000-0000-0000-000000000001', 'customer-a',
    'shopify', 'account-a', 'gid://shopify/Order/1', '2026-01-01T10:00:00Z',
    'pending', 'UNFULFILLED', 79.80, 'EUR', '2026-01-01T10:01:00Z');
  insert into guard_results values('new order accepted', true);

  update guard_orders set zahlungsstatus='paid', lieferstatus='fulfilled',
    quelle_aktualisiert_am='2026-01-01T10:03:00Z' where id=-1;
  select to_jsonb(t) into old_row from guard_orders t where id=-1;
  assert old_row->>'zahlungsstatus'='paid' and old_row->>'lieferstatus'='fulfilled';
  insert into guard_results values('newer revision accepted', true);

  insert into guard_orders select (jsonb_populate_record(null::guard_orders,
    old_row || '{"zahlungsstatus":"pending","lieferstatus":"UNFULFILLED","gesamtbetrag":1,"quelle_aktualisiert_am":"2026-01-01T10:02:00Z"}')).*
  on conflict(markt, markt_konto_id, externe_bestell_id) do update
    set zahlungsstatus=excluded.zahlungsstatus, lieferstatus=excluded.lieferstatus,
      gesamtbetrag=excluded.gesamtbetrag, quelle_aktualisiert_am=excluded.quelle_aktualisiert_am
  returning to_jsonb(guard_orders) into result_row;
  assert result_row=old_row, 'Stale upsert must return unchanged canonical row';
  insert into guard_results values('older upsert returns canonical row and preserves all fields', true);

  update guard_orders set zahlungsstatus='pending', gesamtbetrag=0,
    quelle_aktualisiert_am='2026-01-01T11:03:00+01:00'
    where id=-1 returning to_jsonb(guard_orders) into result_row;
  assert result_row=old_row;
  insert into guard_results values('equal revision / equivalent timezone cannot overwrite', true);

  update guard_orders set quelle_aktualisiert_am='2026-01-01T10:03:00Z'
    where id=-1 returning to_jsonb(guard_orders) into result_row;
  assert result_row=old_row;
  insert into guard_results values('duplicate preserves mirror timestamp', true);

  update guard_orders set zahlungsstatus='refunded', gesamtbetrag=0,
    quelle_aktualisiert_am='2026-01-01T10:04:00Z'
    where id=-1 returning to_jsonb(guard_orders) into result_row;
  assert result_row->>'zahlungsstatus'='refunded' and (result_row->>'gesamtbetrag')::numeric=0;
  insert into guard_results values('newer refund accepted without status ranking', true);

  rejected:=false;
  begin
    update guard_orders set quelle_aktualisiert_am=null where id=-1;
  exception when check_violation then rejected:=true; end;
  assert rejected;
  insert into guard_results values('missing source timestamp rejected', true);

  rejected:=false;
  begin
    update guard_orders set quelle_aktualisiert_am='infinity' where id=-1;
  exception when check_violation then rejected:=true; end;
  assert rejected;
  insert into guard_results values('infinite source timestamp rejected', true);

  rejected:=false;
  begin
    update guard_orders set quelle_aktualisiert_am=clock_timestamp()+interval '1 day' where id=-1;
  exception when check_violation then rejected:=true; end;
  assert rejected;
  insert into guard_results values('future source timestamp rejected', true);

  rejected:=false;
  begin
    update guard_orders set quelle_aktualisiert_am='2025-12-31T10:00:00Z' where id=-1;
  exception when check_violation then rejected:=true; end;
  assert rejected;
  insert into guard_results values('source timestamp before creation rejected', true);

  rejected:=false;
  begin
    update guard_orders set user_id='00000000-0000-0000-0000-000000000002',
      quelle_aktualisiert_am='2026-01-01T10:05:00Z' where id=-1;
  exception when check_violation then rejected:=true; end;
  assert rejected;
  insert into guard_results values('owner reassignment rejected', true);

  rejected:=false;
  begin
    update guard_orders set markt_konto_id='account-b' where id=-1;
  exception when check_violation then rejected:=true; end;
  assert rejected;
  insert into guard_results values('merchant account reassignment rejected', true);

  insert into guard_orders select (jsonb_populate_record(null::guard_orders,
    result_row || '{"id":-2,"markt_konto_id":"account-b","user_id":"00000000-0000-0000-0000-000000000002","kunde_id":"customer-b","zahlungsstatus":"pending"}')).*;
  assert (select count(*)=2 from guard_orders);
  assert (select zahlungsstatus='refunded' from guard_orders where id=-1);
  insert into guard_results values('same external order ID isolated across merchant accounts', true);

  insert into guard_orders(id, markt, markt_konto_id, externe_bestell_id, zahlungsstatus)
    values(-3, 'other', 'account-c', '1', 'pending');
  update guard_orders set zahlungsstatus='paid' where id=-3;
  assert (select zahlungsstatus='paid' from guard_orders where id=-3);
  insert into guard_results values('non-Shopify source remains compatible', true);
end;
$$;

select test, passed from guard_results order by test;
