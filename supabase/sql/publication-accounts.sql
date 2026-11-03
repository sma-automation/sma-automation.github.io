-- Provider account checks. Only short-lived, non-secret evidence reaches orders.
-- Apply before the current publication-orders.sql on an existing installation.
create table if not exists sma_private.publication_account_locks_v1 (
 customer_id bigint not null references public.sma_kunden(id), platform text not null check(platform in ('youtube','tiktok')),
 lease_id uuid, lease_until timestamptz, state text not null default 'idle' check(state in ('idle','checking','refreshing')),
 fingerprint text, window_started timestamptz not null default now(), attempts integer not null default 0,
 primary key(customer_id,platform)
);
alter table sma_private.publication_account_locks_v1 enable row level security;
revoke all on sma_private.publication_account_locks_v1 from public,anon,authenticated;
grant select,insert,update on sma_private.publication_account_locks_v1 to service_role;

create or replace function sma_private.publication_account_context_v1(p_platform text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sma_kunden%rowtype;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_platform is null or p_platform not in ('youtube','tiktok') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=auth.uid())<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=auth.uid();
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 return jsonb_build_object('ok',true,'binding',jsonb_build_object('customer_id',c.id,'platform',p_platform),'n8n_kunde_id',c.n8n_kunde_id,'kunde_email',c.kunde_email);
end $$;
revoke all on function sma_private.publication_account_context_v1(text) from public,anon;
grant execute on function sma_private.publication_account_context_v1(text) to authenticated;
create or replace function public.sma_publication_account_context_v1(p_platform text)
returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_account_context_v1(p_platform);$$;
revoke all on function public.sma_publication_account_context_v1(text) from public,anon;
grant execute on function public.sma_publication_account_context_v1(text) to authenticated;

-- A refresh with an unknown outcome is never blindly retried. A changed stored
-- token fingerprint (successful persistence or reconnection) permits recovery
-- after the old execution's lease expires. No raw token is stored here.
create or replace function public.sma_publication_account_worker_v1(p_action text,p_customer_id bigint,p_platform text,p_lease uuid default null,p_fingerprint text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l sma_private.publication_account_locks_v1%rowtype;
begin
 if p_platform is null or p_platform not in ('youtube','tiktok') or not exists(select 1 from public.sma_kunden where id=p_customer_id and aktiv and (demo_delta_aktiv or zahlung_bestaetigt)) then
  return jsonb_build_object('ok',false,'code','TARGET_ACCOUNT_REQUIRED');end if;
 insert into sma_private.publication_account_locks_v1(customer_id,platform) values(p_customer_id,p_platform) on conflict do nothing;
 select * into l from sma_private.publication_account_locks_v1 where customer_id=p_customer_id and platform=p_platform for update;
 if p_action='claim' then
  if coalesce(p_fingerprint,'')!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if l.state<>'idle' and l.lease_until>now() then return jsonb_build_object('ok',false,'code','TARGET_CHECK_RUNNING');end if;
  if l.state='refreshing' and l.fingerprint=p_fingerprint then return jsonb_build_object('ok',false,'code','TARGET_REFRESH_UNCERTAIN');end if;
  if l.window_started>now()-interval '5 minutes' and l.attempts>=12 then return jsonb_build_object('ok',false,'code','TARGET_RATE_LIMITED');end if;
  update sma_private.publication_account_locks_v1 set state='checking',lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',fingerprint=p_fingerprint,
   attempts=case when window_started<=now()-interval '5 minutes' then 1 else attempts+1 end,
   window_started=case when window_started<=now()-interval '5 minutes' then now() else window_started end
   where customer_id=p_customer_id and platform=p_platform returning * into l;
 elsif p_action='refresh' then
  if p_lease is null or l.lease_id is distinct from p_lease or l.state<>'checking' or l.lease_until<=now() then return jsonb_build_object('ok',false,'code','TARGET_CHECK_RUNNING');end if;
  update sma_private.publication_account_locks_v1 set state='refreshing' where customer_id=p_customer_id and platform=p_platform;
 elsif p_action='saved' then
  if p_lease is null or l.lease_id is distinct from p_lease or l.state<>'refreshing' or l.lease_until<=now() then return jsonb_build_object('ok',false,'code','TARGET_REFRESH_UNCERTAIN');end if;
  update sma_private.publication_account_locks_v1 set state='checking' where customer_id=p_customer_id and platform=p_platform;
 elsif p_action='release' then
  if p_lease is null or l.lease_id is distinct from p_lease or l.state<>'checking' then return jsonb_build_object('ok',false,'code','TARGET_CHECK_RUNNING');end if;
  update sma_private.publication_account_locks_v1 set state='idle',lease_id=null,lease_until=null,fingerprint=null where customer_id=p_customer_id and platform=p_platform;
 else return jsonb_build_object('ok',false,'code','INVALID_ACTION');
 end if;
 return jsonb_build_object('ok',true,'lease_id',l.lease_id);
end $$;
revoke all on function public.sma_publication_account_worker_v1(text,bigint,text,uuid,text) from public,anon,authenticated;
grant execute on function public.sma_publication_account_worker_v1(text,bigint,text,uuid,text) to service_role;

-- Fail closed for missing, stale, malformed or mismatched provider evidence.
-- JSON allowlists keep provider payloads, tokens and customer fields out of views.
create or replace function sma_private.publication_account_valid_v1(e jsonb,t jsonb,ch jsonb default null)
returns boolean language plpgsql stable set search_path='' as $$
declare p text:=t->>'platform';pol jsonb:=e->'policy';k text;stamp timestamptz;expires timestamptz;
begin
 if p is null or p not in ('youtube','tiktok') or jsonb_typeof(e) is distinct from 'object' or octet_length(e::text)>4000 then return false;end if;
 if e->'version' is distinct from '1'::jsonb or e->>'platform' is distinct from p or e->>'target_id' is distinct from t->>'id' or e->>'target_revision' is distinct from t->>'source_revision'
 or char_length(coalesce(e->>'display_name','')) not between 1 and 200 or (e->>'display_name')~'[[:cntrl:]]'
 or exists(select 1 from jsonb_object_keys(e) as fields(key) where fields.key not in ('version','platform','target_id','target_revision','display_name','permissions','policy','checked_at','expires_at')) then return false;end if;
 stamp:=(e->>'checked_at')::timestamptz;expires:=(e->>'expires_at')::timestamptz;
 if stamp is null or expires is null or stamp<now()-interval '5 minutes' or stamp>now()+interval '10 seconds' or expires<=now() or expires>stamp+interval '5 minutes' then return false;end if;
 if p='youtube' then return coalesce(e->'permissions'='["youtube.upload"]'::jsonb and pol='{}'::jsonb,false);end if;
 if e->'permissions' is distinct from '["video.publish","user.info.basic"]'::jsonb or jsonb_typeof(pol) is distinct from 'object'
 or not(pol ?& array['privacy_levels','comment_disabled','duet_disabled','stitch_disabled','max_duration_sec'])
 or exists(select 1 from jsonb_object_keys(pol) as fields(key) where fields.key not in ('privacy_levels','comment_disabled','duet_disabled','stitch_disabled','max_duration_sec'))
 or jsonb_typeof(pol->'privacy_levels') is distinct from 'array' or jsonb_array_length(pol->'privacy_levels') not between 1 and 4
 or exists(select 1 from jsonb_array_elements(pol->'privacy_levels') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR'))
 or coalesce(pol->>'max_duration_sec','')!~'^[1-9][0-9]{0,4}$' or (pol->>'max_duration_sec')::integer>86400 then return false;end if;
 foreach k in array array['comment_disabled','duet_disabled','stitch_disabled'] loop if jsonb_typeof(pol->k) is distinct from 'boolean' then return false;end if;end loop;
 if ch is not null and (not(pol->'privacy_levels' ? (ch->>'visibility'))
 or pol->'comment_disabled'='true'::jsonb and ch->'disable_comment' is distinct from 'true'::jsonb
 or pol->'duet_disabled'='true'::jsonb and ch->'disable_duet' is distinct from 'true'::jsonb
 or pol->'stitch_disabled'='true'::jsonb and ch->'disable_stitch' is distinct from 'true'::jsonb
 or ch->'brand_content_toggle'='true'::jsonb and ch->>'visibility'='SELF_ONLY') then return false;end if;
 return true;
exception when others then return false;
end $$;
revoke all on function sma_private.publication_account_valid_v1(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_account_valid_v1(jsonb,jsonb,jsonb) to service_role;
