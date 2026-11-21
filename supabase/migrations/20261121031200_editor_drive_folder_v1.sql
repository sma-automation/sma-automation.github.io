-- Older dashboard customers may predate the onboarding row receipt. Store
-- only the operator-verified row binding; read the current Drive folder
-- from that row when its owner opens the folder.
create table sma_private.editor_drive_legacy_rows_v1 (
  customer_id bigint primary key references public.sma_kunden(id),
  user_id uuid not null unique,
  customer_ref text not null unique,
  customer_email text not null,
  row_id bigint not null unique check (row_id between 1 and 9007199254740991)
);
create table sma_private.editor_drive_reads_v1 (
  user_id uuid primary key,
  requested_at timestamptz not null
);
alter table sma_private.editor_drive_legacy_rows_v1 enable row level security;
alter table sma_private.editor_drive_reads_v1 enable row level security;
revoke all on sma_private.editor_drive_legacy_rows_v1, sma_private.editor_drive_reads_v1 from public, anon, authenticated, service_role;

create function public.sma_editor_drive_binding_v1(p_owner uuid, p_reserve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  customer public.sma_kunden%rowtype;
  confirmed_email text;
  resolved_row bigint;
  started timestamptz;
begin
  if p_owner is null or p_reserve is null then return null; end if;
  select u.email into confirmed_email from auth.users u
   where u.id=p_owner and u.email_confirmed_at is not null;
  if nullif(btrim(confirmed_email),'') is null then return null; end if;
  if (select count(*) from public.sma_kunden k where k.user_id=p_owner) <> 1 then return null; end if;
  select * into customer from public.sma_kunden k where k.user_id=p_owner;
  if customer.aktiv is not true or not (customer.demo_delta_aktiv is true or customer.zahlung_bestaetigt is true)
     or nullif(btrim(customer.n8n_kunde_id),'') is null or lower(btrim(customer.kunde_email)) is distinct from lower(btrim(confirmed_email))
     or exists (select 1 from public.sma_kunden k where k.id<>customer.id and k.n8n_kunde_id=customer.n8n_kunde_id)
  then return null; end if;
  select min(bound.row_id) into resolved_row from (
    select o.n8n_row_id row_id from sma_private.onboarding_plan_choices_v1 o
     where (o.customer_id,o.user_id,o.n8n_ref,o.n8n_link_email)=(customer.id,p_owner,customer.n8n_kunde_id,customer.kunde_email)
    union
    select l.row_id from sma_private.editor_drive_legacy_rows_v1 l
     where (l.customer_id,l.user_id,l.customer_ref,l.customer_email)=(customer.id,p_owner,customer.n8n_kunde_id,customer.kunde_email)
  ) bound where bound.row_id between 1 and 9007199254740991 having count(*)=1;
  if resolved_row is null then return null; end if;
  if p_reserve then
    insert into sma_private.editor_drive_reads_v1 as r values(p_owner,clock_timestamp())
    on conflict (user_id) do update set requested_at=excluded.requested_at
      where r.requested_at<=excluded.requested_at-interval '15 seconds'
    returning requested_at into started;
    if started is null then return jsonb_build_object('code','RATE_LIMITED'); end if;
  end if;
  return jsonb_build_object('row',resolved_row,'ref',customer.n8n_kunde_id,'email',customer.kunde_email);
end;
$$;
revoke all on function public.sma_editor_drive_binding_v1(uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function public.sma_editor_drive_binding_v1(uuid,boolean) to service_role;
