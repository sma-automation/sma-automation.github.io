-- Read the existing catalogue start gate before invoking its n8n webhook.
-- This status does not reserve a scan, renew a lease or return catalogue data.
-- Preserve the installed request function, its owner, ACL and public wrapper.
do $migration$
declare
  definition text := pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
  list_anchor text := E'\n if p_action=''list'' then\n';
  access_anchor text := $old$begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED'); end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>30000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 if (select count(*) from public.sma_kunden k where k.user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE'); end if;
 select * into c from public.sma_kunden k where k.user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 if p_action='list' then
$old$;
  start_gate text := $old$  if s.lease_until>now() then return jsonb_build_object('ok',false,'code','FILE_SYNC_RUNNING'); end if;
  if s.started_at>now()-interval '15 seconds' then return jsonb_build_object('ok',false,'code','FILE_SYNC_RATE_LIMITED'); end if;$old$;
begin
  if length(definition)-length(replace(definition,list_anchor,'')) <> length(list_anchor)
     or length(definition)-length(replace(definition,access_anchor,'')) <> length(access_anchor)
     or length(definition)-length(replace(definition,start_gate,'')) <> length(start_gate) then
    raise exception 'PUBLICATION_FILE_SYNC_PREFLIGHT_BASELINE_CHANGED';
  end if;
  execute replace(definition,list_anchor,$new$
 if p_action='sync_status' then
  if p_input is distinct from '{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  -- The existing start gate is keyed by user, including a previous customer mapping.
  select * into s from sma_private.publication_file_sync_v1 where user_id=uid;
  return jsonb_build_object('ok',true,'version',1,'can_publish',false,
   'sync_state',case
    when s.lease_until>now() then 'running'
    when s.customer_id is distinct from c.id then 'idle'
    when s.lease_id is not null or (s.started_at is not null and
      (s.finished_at is null or s.started_at>s.finished_at)) then 'interrupted'
    when s.finished_at is not null then 'complete'
    else 'idle' end,
   'retry_after_ms',case
    when s.lease_until>now() then
     least(120000,ceil(extract(epoch from (s.lease_until-now()))*1000))::integer
    when s.started_at>now()-interval '15 seconds' then
     least(120000,ceil(extract(epoch from (s.started_at+interval '15 seconds'-now()))*1000))::integer
    else 0 end,
   'synced_at',case when s.customer_id=c.id and isfinite(s.finished_at) then s.finished_at else null end);
 elsif p_action='list' then
$new$);
end $migration$;
