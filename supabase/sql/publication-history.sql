-- Read-only history over the already installed order/provider journals (PR #57).
-- No dispatcher, order view, approval, lease, or provider request is called here.
create or replace function sma_private.publication_history_entry_v1(j sma_private.publication_orders_v1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a sma_private.publication_provider_attempts_v1%rowtype; r jsonb; stage text; verified boolean:=false; ids jsonb;
begin
 stage:=case j.state when 'preparing' then 'preparing' when 'prepared' then 'prepared'
  when 'approved' then 'approved' when 'checking' then 'checking' when 'blocked' then 'blocked'
  when 'checked' then 'checked' when 'cancelled' then 'cancelled' else 'unknown' end;
 select * into a from sma_private.publication_provider_attempts_v1 where order_id=j.id;
 if found then
  if a.fingerprint is distinct from sma_private.publication_provider_fingerprint_v1(j)
   or a.platform is distinct from j.binding->>'platform' or a.target_id is distinct from j.target->>'id'
   or a.visibility is distinct from j.choices->>'visibility' then stage:='needs_review';
  else
   stage:=case a.state when 'reserved' then 'pending' when 'session_ready' then 'pending'
    when 'uploading' then 'uploading' when 'processing' then 'processing' when 'failed' then 'failed'
    when 'uncertain' then 'uncertain' when 'needs_review' then 'needs_review' else 'unknown' end;
   if a.state='complete' then
    stage:='complete_unknown';r:=a.result;
    verified:=jsonb_typeof(r)='object' and r->>'state'='complete'
     and r->>'platform'=a.platform and r->>'target_id'=a.target_id and r->>'provider_id'=a.provider_id
     and r->>'expected_visibility'=a.visibility and r->'can_upload'='false'::jsonb
     and r->'can_publish'='false'::jsonb and r->'upload_retry_allowed'='false'::jsonb;
    if verified and a.platform='youtube' and r->>'route'='youtube_video'
     and a.provider_id ~ '^[A-Za-z0-9_-]{11}$' and r->>'visibility'=a.visibility
     and r->>'url'='https://www.youtube.com/watch?v='||a.provider_id then
     if a.visibility='public' and r->'publicly_available'='true'::jsonb then stage:='public_confirmed';
     elsif a.visibility='private' and r->'publicly_available'='false'::jsonb then stage:='private_complete';
     elsif a.visibility='unlisted' and r->'publicly_available'='false'::jsonb then stage:='unlisted_complete';end if;
    elsif verified and a.platform='tiktok' and r->>'route'='direct_post' then
     ids:=r->'public_post_ids';
     if jsonb_typeof(ids)='array' then
      if jsonb_array_length(ids) between 1 and 20 and not exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[1-9][0-9]{0,19}$')
       and a.visibility='PUBLIC_TO_EVERYONE' and r->'publicly_available'='true'::jsonb then stage:='public_confirmed';
      elsif jsonb_array_length(ids)=0 and r->'publicly_available'='false'::jsonb then
       if a.visibility='SELF_ONLY' then stage:='private_complete';
       elsif a.visibility in ('MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR') then stage:='limited_complete';end if;
      end if;
     end if;
    end if;
   end if;
  end if;
 end if;
 return jsonb_build_object('id',j.id,'platform',case when j.binding->>'platform' in ('youtube','tiktok','instagram','facebook') then j.binding->>'platform' else 'unknown' end,
  'title',left(coalesce(nullif(j.draft->>'title',''),nullif(j.draft->>'caption',''),'Beitrag'),200),
  'target_name',left(coalesce(nullif(j.account_check->>'display_name',''),nullif(j.target->>'name',''),''),160),
  'status',stage,'created_at',j.created_at,'updated_at',greatest(j.updated_at,a.updated_at));
end $$;
revoke all on function sma_private.publication_history_entry_v1(sma_private.publication_orders_v1) from public,anon,authenticated,service_role;

create or replace function sma_private.publication_history_read_v1(p_input jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.sma_kunden%rowtype; before_time timestamptz; before_id uuid; rows jsonb; last_row jsonb; more boolean;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1000
  or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('before_at','before_id'))
  or (p_input?'before_at') is distinct from (p_input?'before_id') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_input?'before_at' then
  if jsonb_typeof(p_input->'before_at') is distinct from 'string' or coalesce(p_input->>'before_at','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})$'
   or jsonb_typeof(p_input->'before_id') is distinct from 'string' or coalesce(p_input->>'before_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  begin before_time:=(p_input->>'before_at')::timestamptz;before_id:=(p_input->>'before_id')::uuid;
  exception when invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end;
 end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select coalesce(jsonb_agg(sma_private.publication_history_entry_v1(q) order by q.created_at desc,q.id desc),'[]'::jsonb)
 into rows from (select j.* from sma_private.publication_orders_v1 j
  where j.user_id=uid and j.customer_id=c.id and (before_time is null or (j.created_at,j.id)<(before_time,before_id))
  order by j.created_at desc,j.id desc limit 21) q;
 more:=jsonb_array_length(rows)>20;if more then rows:=rows-20;end if;
 last_row:=rows->(jsonb_array_length(rows)-1);
 return jsonb_build_object('ok',true,'version',1,'entries',rows,'has_more',more,
  'next',case when more then jsonb_build_object('before_at',last_row->>'created_at','before_id',last_row->>'id') else null end);
end $$;
revoke all on function sma_private.publication_history_read_v1(jsonb) from public,anon,service_role;
grant execute on function sma_private.publication_history_read_v1(jsonb) to authenticated;

create or replace function public.sma_publication_history_v1(p_input jsonb default '{}')
returns jsonb language sql stable security invoker set search_path='' as $$
 select sma_private.publication_history_read_v1(p_input);
$$;
revoke all on function public.sma_publication_history_v1(jsonb) from public,anon,service_role;
grant execute on function public.sma_publication_history_v1(jsonb) to authenticated;
