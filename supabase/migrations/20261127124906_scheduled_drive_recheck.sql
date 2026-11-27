-- Recheck the approved Drive copy before a scheduled delivery. A source must opt in.
create table sma_private.scheduled_drive_sources_v1 (
  source_id uuid not null,
  platform text not null,
  primary key (source_id, platform),
  foreign key (source_id, platform) references sma_private.publication_rotation_channels_v1(source_id, platform)
);
create table sma_private.scheduled_drive_tickets_v1 (
  order_id uuid primary key references sma_private.publication_orders_v1(id) on delete cascade,
  ticket uuid unique not null,
  issued_at timestamptz not null,
  claimed_at timestamptz
);
alter table sma_private.scheduled_drive_sources_v1 enable row level security;
alter table sma_private.scheduled_drive_tickets_v1 enable row level security;
revoke all on sma_private.scheduled_drive_sources_v1, sma_private.scheduled_drive_tickets_v1
  from public, anon, authenticated, service_role;

create view sma_private.scheduled_drive_files_v1 with (security_invoker=true) as
select d.order_id, d.source_id, d.platform, d.target_id, d.asset_id, d.asset_revision,
       f.drive_file_id, f.size_bytes, f.mime_type, i.digest, c.n8n_kunde_id,
       f.verified_at, o.state, d.due_at
from sma_private.scheduled_drive_sources_v1 enabled
join sma_private.publication_rotation_deliveries_v1 d using (source_id,platform)
join sma_private.publication_orders_v1 o on o.id=d.order_id
join sma_private.publication_files_v1 f on f.id=d.asset_id and f.user_id=o.user_id and f.customer_id=o.customer_id
join public.sma_kunden c on c.id=o.customer_id and c.user_id=o.user_id
join sma_private.publication_rotation_imports_v1 i on i.source_id=d.source_id and i.copy_id=f.drive_file_id
where d.due_at between now()-interval '5 minutes' and now()+interval '9 minutes'
  and o.state in ('approved','blocked','checked')
  and (o.state<>'blocked' or (
    o.blockers <@ '["FILE_REFRESH_REQUIRED","CONTENT_REVIEW_PENDING","SEMANTIC_REVIEW_PENDING"]'::jsonb
    and (o.blockers <@ '["FILE_REFRESH_REQUIRED"]'::jsonb or (
      sma_private.publication_human_review_valid_v1(o.supplemental_review)
      and o.supplemental_review->>'source_fingerprint' = sma_private.publication_human_review_scope_v1(o)))))
  and i.verified_at is not null and i.digest=split_part(d.asset_revision,':',2)
  and f.revision=d.asset_revision and f.available
  and sma_private.publication_rotation_current_v1(d)
  and not exists(select from sma_private.publication_provider_attempts_v1 a where a.order_id=d.order_id);
revoke all on sma_private.scheduled_drive_files_v1 from public,anon,authenticated,service_role;

create function sma_private.claim_scheduled_drive_check_v1(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare selected sma_private.scheduled_drive_files_v1%rowtype;
begin
  select f.* into selected from sma_private.scheduled_drive_tickets_v1 t
    join sma_private.scheduled_drive_files_v1 f on f.order_id=t.order_id
    where t.ticket=p_ticket and t.issued_at>now()-interval '2 minutes' and t.claimed_at is null
    for update of t;
  if not found then return jsonb_build_object('ok',false); end if;
  update sma_private.scheduled_drive_tickets_v1 set claimed_at=now() where ticket=p_ticket;
  return jsonb_build_object('ok',true)|| (to_jsonb(selected)-'verified_at'-'due_at');
end $$;
revoke all on function sma_private.claim_scheduled_drive_check_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function sma_private.claim_scheduled_drive_check_v1(uuid) to service_role;
create function public.sma_claim_scheduled_drive_check_v1(p_ticket uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select sma_private.claim_scheduled_drive_check_v1(p_ticket)
$$;
revoke all on function public.sma_claim_scheduled_drive_check_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.sma_claim_scheduled_drive_check_v1(uuid) to service_role;

create function sma_private.wake_scheduled_drive_checks_v1() returns integer
language plpgsql security definer set search_path='' as $$
declare selected record; fresh_ticket uuid; dispatched integer:=0;
begin
  for selected in select f.order_id from sma_private.scheduled_drive_files_v1 f
    left join sma_private.scheduled_drive_tickets_v1 t on t.order_id=f.order_id
    where (f.verified_at<now()-interval '7 minutes' or f.state in ('approved','blocked'))
      and (t.order_id is null or t.issued_at<now()-interval '3 minutes')
    order by f.due_at limit 20
  loop
    insert into sma_private.scheduled_drive_tickets_v1 as t(order_id,ticket,issued_at)
      values(selected.order_id,gen_random_uuid(),now())
      on conflict(order_id) do update set ticket=excluded.ticket, issued_at=now(), claimed_at=null
      where t.issued_at<now()-interval '3 minutes'
      returning ticket into fresh_ticket;
    if found then
      perform net.http_post(url:='https://johnmusic.app.n8n.cloud/webhook/sma-drive-versandpruefung-v1',
        body:=jsonb_build_object('ticket',fresh_ticket),timeout_milliseconds:=12000);
      dispatched:=dispatched+1;
    end if;
  end loop;
  return dispatched;
end $$;
revoke all on function sma_private.wake_scheduled_drive_checks_v1() from public,anon,authenticated,service_role;
select cron.schedule('sma-drive-versandpruefung-v1','* * * * *','select sma_private.wake_scheduled_drive_checks_v1()');
notify pgrst,'reload schema';
