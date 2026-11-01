-- Run as postgres in a transaction; no committed order writes.
begin;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub',(select user_id from public.sma_bestellungen order by id limit 1),
  'role','authenticated')::text, true);
select set_config('sma.test.expected_count', (select count(*)::text
  from public.sma_bestellungen where user_id=(current_setting('request.jwt.claims')::jsonb->>'sub')::uuid), true);
set local role authenticated;
do $$ declare n bigint; blocked boolean:=false; begin
  assert (select count(*)=current_setting('sma.test.expected_count')::bigint from public.sma_bestellungen), 'Owner read';
  update public.sma_bestellungen set zahlungsstatus='pending';
  get diagnostics n = row_count;
  assert n=0, 'Client update must not be allowed';
  begin
    insert into public.sma_bestellungen(id,kunde_id,markt,markt_konto_id,externe_bestell_id,quelle_aktualisiert_am)
    select -100,kunde_id,'shopify','rls-test','rls-test',clock_timestamp()
      from public.sma_bestellungen order by id limit 1;
  exception when insufficient_privilege then blocked:=true; end;
  assert blocked, 'Client insert must not be allowed';
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000099","role":"authenticated"}', true);
set local role authenticated;
do $$ begin assert (select count(*)=0 from public.sma_bestellungen), 'Other customer read'; end $$;
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin assert (select count(*)=0 from public.sma_bestellungen), 'Anonymous read'; end $$;
reset role;
select 5 as passed_rls_checks;
rollback;
