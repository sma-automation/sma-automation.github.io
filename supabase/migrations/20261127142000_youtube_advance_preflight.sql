-- Only explicitly enrolled YouTube sources may preflight a signed-off post before the slot.
create table sma_private.youtube_advance_preflight_v1 (
  source_id uuid primary key references sma_private.publication_rotation_sources_v1(id),
  channel_id text not null,
  enrolled_at timestamptz not null default now()
);
alter table sma_private.youtube_advance_preflight_v1 enable row level security;
revoke all on sma_private.youtube_advance_preflight_v1 from public, anon, authenticated, service_role;

create or replace view sma_private.scheduled_drive_files_v1 with (security_invoker=true) as
select d.order_id, d.source_id, d.platform, d.target_id, d.asset_id, d.asset_revision,
       f.drive_file_id, f.size_bytes, f.mime_type, i.digest, c.n8n_kunde_id,
       f.verified_at, o.state, d.due_at
from sma_private.scheduled_drive_sources_v1 enabled
join sma_private.publication_rotation_deliveries_v1 d using (source_id,platform)
join sma_private.publication_orders_v1 o on o.id=d.order_id
join sma_private.publication_files_v1 f on f.id=d.asset_id and f.user_id=o.user_id and f.customer_id=o.customer_id
join public.sma_kunden c on c.id=o.customer_id and c.user_id=o.user_id
join sma_private.publication_rotation_imports_v1 i on i.source_id=d.source_id and i.copy_id=f.drive_file_id
where d.due_at >= now()-interval '5 minutes'
  and (d.due_at <= now()+interval '9 minutes' or (
    d.platform='youtube' and o.state in ('approved','blocked')
    and exists(select 1 from sma_private.youtube_advance_preflight_v1 e
               where e.source_id=d.source_id and e.channel_id=d.target_id)))
  and o.state in ('approved','blocked','checked')
  and (o.state<>'blocked' or (
    o.blockers <@ '["FILE_REFRESH_REQUIRED","CONTENT_REVIEW_PENDING","SEMANTIC_REVIEW_PENDING"]'::jsonb
    and (o.blockers <@ '["FILE_REFRESH_REQUIRED"]'::jsonb or (
      sma_private.publication_human_review_valid_v1(o.supplemental_review)
      and o.supplemental_review->>'source_fingerprint'=sma_private.publication_human_review_scope_v1(o)))))
  and i.verified_at is not null and i.digest=split_part(d.asset_revision,':',2)
  and f.revision=d.asset_revision and f.available
  and sma_private.publication_rotation_current_v1(d)
  and not exists(select from sma_private.publication_provider_attempts_v1 a where a.order_id=d.order_id);

-- Retain the existing ticketed Drive worker. Retry early checks hourly and give
-- the original nine-minute check window priority even after an earlier attempt.
do $migration$
declare
  wake regprocedure := 'sma_private.wake_scheduled_drive_checks_v1()'::regprocedure;
  original text := pg_get_functiondef(wake);
  previous text := 't.issued_at<now()-interval ''3 minutes'')' ;
  replacement text := 't.issued_at < now() - case when f.due_at<=now()+interval ''9 minutes''
                              then interval ''3 minutes'' else interval ''1 hour'' end)';
begin
  if strpos(original,previous)=0 then raise exception 'Unexpected scheduled Drive worker revision'; end if;
  execute replace(original, previous, replacement);
end
$migration$;
