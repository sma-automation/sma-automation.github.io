-- Service-only recovery of missed Shopify webhooks. Checkout activation is separate.
create table if not exists sma_private.order_reconciliation_v1 (
  account_id bigint primary key references public.sma_shopify_konten(id),
  enabled boolean not null default false,
  next_run_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_success_at timestamptz,
  status text not null default 'ready',
  result jsonb not null default '{}'::jsonb
);
alter table sma_private.order_reconciliation_v1 enable row level security;
revoke all on sma_private.order_reconciliation_v1 from public,anon,authenticated;
grant usage on schema sma_private to service_role;
grant select,insert,update on sma_private.order_reconciliation_v1 to service_role;

create or replace function public.sma_order_reconcile_v1(
  p_action text, p_account_id bigint default null, p_lease uuid default null,
  p_result jsonb default null
) returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare
  j sma_private.order_reconciliation_v1%rowtype;
  s public.sma_shopify_konten%rowtype;
  k public.sma_kunden%rowtype;
  b public.sma_bestellungen%rowtype;
  o jsonb; stamp timestamptz; created timestamptz; amount numeric;
  total integer:=0; inserted integer:=0; changed integer:=0;
  unchanged integer:=0; stale integer:=0; conflicts integer:=0;
  conflict_ids jsonb:='[]'::jsonb; outcome jsonb; rows_affected integer;
begin
  if p_action='claim' then
    select q.* into j from sma_private.order_reconciliation_v1 q
    join public.sma_shopify_konten a on a.id=q.account_id
    join public.sma_kunden c on c.id=a.sma_kunden_id
    where q.enabled and q.next_run_at<=clock_timestamp()
      and (q.lease_until is null or q.lease_until<=clock_timestamp())
      and c.aktiv is true and (c.zahlung_bestaetigt is true or c.demo_delta_aktiv is true)
    order by q.next_run_at,q.account_id for update of q skip locked limit 1;
    if not found then return jsonb_build_object('claimed',false); end if;
    select * into strict s from public.sma_shopify_konten where id=j.account_id;
    select * into strict k from public.sma_kunden where id=s.sma_kunden_id;
    if s.markt_konto_id is null or k.n8n_kunde_id is null or k.user_id is null
       or s.shopify_domain !~ '^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$'
       or s.shopify_domain is null then raise exception 'Invalid account mapping'; end if;
    update sma_private.order_reconciliation_v1 set
      lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 minutes',
      started_at=clock_timestamp(),finished_at=null,status='running',result='{}',
      next_run_at=clock_timestamp()+interval '14 minutes'
      where account_id=j.account_id returning * into j;
    return jsonb_build_object('claimed',true,'account_id',j.account_id,
      'lease_id',j.lease_id,'kunde_id',k.n8n_kunde_id,'sma_kunde_id',k.kunde_id,
      'markt_konto_id',s.markt_konto_id,'shop_domain',s.shopify_domain,
      'cutoff',j.started_at-interval '2 minutes');
  end if;
  if p_action not in ('complete','fail') or p_action is null then
    raise exception 'Invalid reconciliation action';
  end if;
  select * into strict j from sma_private.order_reconciliation_v1
    where account_id=p_account_id for update;
  if not j.enabled or j.status<>'running' or p_lease is null
     or j.lease_id is distinct from p_lease or j.lease_until<=clock_timestamp() then
    raise exception 'Reconciliation lease invalid';
  end if;
  if p_action='fail' then
    update sma_private.order_reconciliation_v1 set status='failed',finished_at=clock_timestamp(),
      lease_until=null,result=jsonb_build_object('code','RECONCILIATION_FAILED'),
      next_run_at=clock_timestamp()+interval '5 minutes' where account_id=j.account_id;
    return jsonb_build_object('ok',false,'status','failed','account_id',j.account_id);
  end if;
  select * into strict s from public.sma_shopify_konten where id=j.account_id;
  select * into strict k from public.sma_kunden where id=s.sma_kunden_id;
  if k.aktiv is not true or not (k.zahlung_bestaetigt is true or k.demo_delta_aktiv is true)
     or p_result->>'shop_domain' is distinct from s.shopify_domain
     or p_result->>'markt_konto_id' is distinct from s.markt_konto_id
     or p_result->>'kunde_id' is distinct from k.n8n_kunde_id then
    raise exception 'Reconciliation account mismatch';
  end if;
  if p_result->'complete' is distinct from 'true'::jsonb
     or jsonb_typeof(p_result->'orders') is distinct from 'array'
     or jsonb_array_length(p_result->'orders')>10000
     or coalesce((p_result->>'pages')::integer,0) not between 1 and 200 then
    raise exception 'Incomplete reconciliation';
  end if;
  if (select count(*)<>count(distinct v->>'externe_bestell_id') from jsonb_array_elements(p_result->'orders') v) then
    raise exception 'Duplicate orders';
  end if;
  for o in select value from jsonb_array_elements(p_result->'orders') order by value->>'externe_bestell_id' loop
    stamp:=(o->>'quelle_aktualisiert_am')::timestamptz;
    created:=(o->>'erstellt_am')::timestamptz;
    amount:=(o->>'gesamtbetrag')::numeric;
    if coalesce(o->>'externe_bestell_id','') !~ '^gid://shopify/Order/[0-9]+$'
      or coalesce(length(o->>'bestellnummer'),0) not between 1 and 255
      or stamp is null or created is null or not isfinite(stamp) or not isfinite(created)
      or stamp<created or stamp>clock_timestamp()+interval '5 minutes'
      or amount is null or amount<0 or amount>1000000000000
      or coalesce(o->>'waehrung','') !~ '^[A-Z]{3}$'
      or coalesce(o->>'zahlungsstatus','') not in ('unknown','authorized','expired','paid','partially_paid','partially_refunded','pending','refunded','voided')
      or coalesce(o->>'lieferstatus','') not in ('fulfilled','fulfillment_not_required','in_progress','on_hold','open','partially_fulfilled','pending_fulfillment','request_declined','restocked','scheduled','unfulfilled') then
      raise exception 'Invalid order payload';
    end if;
    total:=total+1;
    select * into b from public.sma_bestellungen where markt='shopify'
      and markt_konto_id=s.markt_konto_id and externe_bestell_id=o->>'externe_bestell_id' for update;
    if not found then
      insert into public.sma_bestellungen(kunde_id,markt,markt_konto_id,externe_bestell_id,
        bestellnummer,erstellt_am,zahlungsstatus,lieferstatus,gesamtbetrag,waehrung,quelle_aktualisiert_am)
      values(k.kunde_id,'shopify',s.markt_konto_id,o->>'externe_bestell_id',o->>'bestellnummer',
        created,o->>'zahlungsstatus',o->>'lieferstatus',amount,o->>'waehrung',stamp)
      on conflict(markt,markt_konto_id,externe_bestell_id) do nothing;
      get diagnostics rows_affected=row_count;
      if rows_affected=1 then inserted:=inserted+1; continue; end if;
      -- A webhook inserted while the API snapshot was in flight: re-lock its row.
      select * into strict b from public.sma_bestellungen where markt='shopify'
        and markt_konto_id=s.markt_konto_id and externe_bestell_id=o->>'externe_bestell_id' for update;
    end if;
    if b.kunde_id is distinct from k.kunde_id or b.user_id is distinct from k.user_id then
      raise exception 'Existing order owner mismatch';
    end if;
    if b.quelle_aktualisiert_am is null or stamp>b.quelle_aktualisiert_am then
      update public.sma_bestellungen set bestellnummer=o->>'bestellnummer',erstellt_am=created,
        zahlungsstatus=o->>'zahlungsstatus',lieferstatus=o->>'lieferstatus',
        gesamtbetrag=amount,waehrung=o->>'waehrung',quelle_aktualisiert_am=stamp where id=b.id;
      changed:=changed+1;
    elsif stamp<b.quelle_aktualisiert_am then stale:=stale+1;
    elsif (b.bestellnummer,b.erstellt_am,lower(coalesce(b.zahlungsstatus,'unknown')),
      case lower(b.lieferstatus) when 'partial' then 'partially_fulfilled' else lower(b.lieferstatus) end,
      b.gesamtbetrag,b.waehrung)
      is not distinct from (o->>'bestellnummer',created,o->>'zahlungsstatus',o->>'lieferstatus',amount,o->>'waehrung') then
      unchanged:=unchanged+1;
    else
      conflicts:=conflicts+1;
      if conflicts<=100 then conflict_ids:=conflict_ids||jsonb_build_array(o->>'externe_bestell_id'); end if;
    end if;
  end loop;
  outcome:=jsonb_build_object('checked',total,'inserted',inserted,'updated',changed,
    'unchanged',unchanged,'newer_in_sma',stale,'timestamp_conflicts',conflicts,
    'conflict_ids',conflict_ids,'pages',(p_result->>'pages')::integer,'coverage','Shopify accessible orders (normally 60 days)');
  update sma_private.order_reconciliation_v1 set
    status=case when conflicts>0 then 'review_required' else 'succeeded' end,
    result=outcome,finished_at=clock_timestamp(),last_success_at=case when conflicts=0 then clock_timestamp() else last_success_at end,
    lease_until=null,next_run_at=j.started_at+interval '14 minutes' where account_id=j.account_id;
  return outcome||jsonb_build_object('ok',conflicts=0,'status',case when conflicts>0 then 'review_required' else 'succeeded' end,'account_id',j.account_id);
end; $fn$;
revoke all on function public.sma_order_reconcile_v1(text,bigint,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sma_order_reconcile_v1(text,bigint,uuid,jsonb) to service_role;
