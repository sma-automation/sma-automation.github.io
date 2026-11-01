-- Text preparation only. No endpoint in this migration authorizes publication.
create schema if not exists sma_private;

create table if not exists sma_private.publication_previews_v1 (
  id uuid primary key,
  user_id uuid not null,
  customer_id bigint not null references public.sma_kunden(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_id uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default now() + interval '3 minutes',
  input jsonb not null,
  shop_url text not null,
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  preview jsonb,
  revision integer not null default 1,
  error_code text
);
create index if not exists publication_previews_v1_owner_created_idx on sma_private.publication_previews_v1(user_id,created_at desc);
create table if not exists sma_private.publication_rate_v1 (
  user_id uuid primary key,
  last_requested_at timestamptz
);
alter table sma_private.publication_previews_v1 enable row level security;
alter table sma_private.publication_rate_v1 enable row level security;
revoke all on sma_private.publication_previews_v1,sma_private.publication_rate_v1 from public,anon,authenticated;
grant usage on schema sma_private to authenticated,service_role;
grant select,insert,update on sma_private.publication_previews_v1,sma_private.publication_rate_v1 to service_role;

-- Definer is needed only for this own-user lookup/write into the private queue.
-- Every action checks auth.uid(); user-supplied owner IDs are never accepted.
create or replace function sma_private.publication_preview_request_v1(p_action text,p_input jsonb default '{}'::jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  c public.sma_kunden%rowtype;
  j sma_private.publication_previews_v1%rowtype;
  last_requested timestamptz;
  request_id uuid;
  v_input jsonb;
  v_platforms jsonb;
  v_shop text;
  v_source text;
  v_audience text;
  v_goal text;
  d jsonb;
  old_d jsonb;
  new_drafts jsonb := '[]'::jsonb;
  caption text;
  edited_title text;
  edited_body text;
begin
  if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED'); end if;
  if p_action not in ('prepare','get','latest','save') or p_action is null then return jsonb_build_object('ok',false,'code','INVALID_ACTION'); end if;
  if (select count(*) from public.sma_kunden k where k.user_id=uid) <> 1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE'); end if;
  select * into c from public.sma_kunden k where k.user_id=uid;
  if c.aktiv is not true or not (c.zahlung_bestaetigt is true or c.demo_delta_aktiv is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;

  if p_action in ('get','latest') then
    if p_action='latest' then
      select * into j from sma_private.publication_previews_v1 q where q.user_id=uid order by q.created_at desc limit 1;
    else
      select * into j from sma_private.publication_previews_v1 q where q.id=p_id and q.user_id=uid;
    end if;
    if not found then return jsonb_build_object('ok',true,'status','empty'); end if;
    if j.status='processing' and j.lease_until < now() then
      update sma_private.publication_previews_v1 set status='failed',error_code='PREPARATION_TIMEOUT',finished_at=now() where id=j.id and status='processing';
      j.status:='failed'; j.error_code:='PREPARATION_TIMEOUT';
    end if;
    return jsonb_build_object('ok',true,'status',j.status,'id',j.id,'input',j.input,'preview',j.preview,'revision',j.revision,'error_code',j.error_code);
  end if;

  if p_action='save' then
    select * into j from sma_private.publication_previews_v1 q where q.id=p_id and q.user_id=uid for update;
    if not found or j.status<>'completed' then return jsonb_build_object('ok',false,'code','PREVIEW_UNAVAILABLE'); end if;
    if c.shop_oeffentlich is not true or ('https://sma-automation.com/app/shop.html?shop='||c.shop_slug) is distinct from j.shop_url then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED'); end if;
    if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>30000 or jsonb_typeof(p_input->'drafts') is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
    if p_input->'revision' is distinct from to_jsonb(j.revision) then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
    if jsonb_array_length(p_input->'drafts')<>jsonb_array_length(j.preview->'drafts') or (select count(distinct x->>'platform') from jsonb_array_elements(p_input->'drafts') x)<>jsonb_array_length(p_input->'drafts') then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
    for old_d in select x from jsonb_array_elements(j.preview->'drafts') x loop
      select x into d from jsonb_array_elements(p_input->'drafts') x where x->>'platform'=old_d->>'platform';
      if not found or jsonb_typeof(d->'title') is distinct from 'string' or jsonb_typeof(d->'body') is distinct from 'string' then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
      edited_title:=btrim(d->>'title'); edited_body:=btrim(d->>'body');
      if exists(select 1 from regexp_split_to_table(edited_title||edited_body,'') as u(ch) where ascii(u.ch) between 0 and 8 or ascii(u.ch) in (11,12) or ascii(u.ch) between 14 and 31 or ascii(u.ch) between 8234 and 8238 or ascii(u.ch) between 8294 and 8297) then return jsonb_build_object('ok',false,'code','INVALID_EDIT'); end if;
      if char_length(edited_title) not between 1 and 80 or char_length(edited_body) not between 10 and 1200 or (edited_title||edited_body) ~* '(https?:|www\.|@|#|<|>|[[:alnum:]-]+\.(com|de|at|net|org|io|shop|co|eu)\M|link[[:space:]]+(im|in|on|auf)\M)' then return jsonb_build_object('ok',false,'code','INVALID_EDIT'); end if;
      select concat_ws(E'\n\n',edited_body,nullif(string_agg('#'||value,' '),''),(case when j.input->>'language'='de' then '🛒 Zum Shop: ' else '🛒 Visit our shop: ' end)||j.shop_url) into caption from jsonb_array_elements_text(old_d->'hashtags');
      if octet_length(caption)>5000 or (old_d->>'platform'='tiktok' and char_length(caption)+(select count(*) from regexp_split_to_table(caption,'') as u(c) where ascii(u.c)>65535)>2200) then return jsonb_build_object('ok',false,'code','CAPTION_TOO_LONG'); end if;
      new_drafts:=new_drafts||jsonb_build_array(old_d||jsonb_build_object('title',edited_title,'body',edited_body,'caption',caption));
    end loop;
    update sma_private.publication_previews_v1 set preview=jsonb_set(j.preview,'{drafts}',new_drafts),revision=revision+1 where id=j.id returning * into j;
    return jsonb_build_object('ok',true,'status','completed','id',j.id,'preview',j.preview,'revision',j.revision);
  end if;

  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  if exists(select 1 from jsonb_object_keys(p_input) as k(key) where key not in ('request_id','source_text','audience','goal','language','media_kind','platforms')) then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  if jsonb_typeof(p_input->'request_id') is distinct from 'string' or (p_input->>'request_id') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_REQUEST_ID'); end if;
  request_id:=(p_input->>'request_id')::uuid;
  if jsonb_typeof(p_input->'source_text') is distinct from 'string' or jsonb_typeof(p_input->'audience') is distinct from 'string' or jsonb_typeof(p_input->'goal') is distinct from 'string' then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  v_source:=btrim(p_input->>'source_text'); v_audience:=btrim(p_input->>'audience'); v_goal:=btrim(p_input->>'goal');
  if char_length(v_source) not between 30 and 8000 or char_length(v_audience) not between 2 and 200 or char_length(v_goal) not between 2 and 300 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  if coalesce(p_input->>'language','') not in ('de','en') or coalesce(p_input->>'media_kind','') not in ('video','image') then return jsonb_build_object('ok',false,'code','INVALID_FORMAT'); end if;
  if jsonb_typeof(p_input->'platforms') is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_PLATFORMS'); end if;
  if jsonb_array_length(p_input->'platforms') not between 1 and 4 then return jsonb_build_object('ok',false,'code','INVALID_PLATFORMS'); end if;
  if exists(select 1 from jsonb_array_elements(p_input->'platforms') as x(value) where jsonb_typeof(value)<>'string' or value#>>'{}' not in ('youtube','instagram','facebook','tiktok'))
     or (select count(distinct value) from jsonb_array_elements(p_input->'platforms') x(value))<>jsonb_array_length(p_input->'platforms') then return jsonb_build_object('ok',false,'code','INVALID_PLATFORMS'); end if;
  if p_input->>'media_kind'='image' and (p_input->'platforms') ? 'youtube' then return jsonb_build_object('ok',false,'code','YOUTUBE_REQUIRES_VIDEO'); end if;
  if c.shop_oeffentlich is not true or c.shop_slug is null or c.shop_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(c.shop_slug)>80 then return jsonb_build_object('ok',false,'code','PUBLIC_SHOP_REQUIRED'); end if;
  v_shop:='https://sma-automation.com/app/shop.html?shop='||c.shop_slug;
  select jsonb_agg(p order by ord) into v_platforms from unnest(array['youtube','instagram','facebook','tiktok']) with ordinality as a(p,ord) where (p_input->'platforms') ? p;
  v_input:=jsonb_build_object('request_id',request_id,'source_text',v_source,'audience',v_audience,'goal',v_goal,'language',p_input->>'language','media_kind',p_input->>'media_kind','platforms',v_platforms);

  insert into sma_private.publication_rate_v1(user_id) values(uid) on conflict do nothing;
  select r.last_requested_at into last_requested from sma_private.publication_rate_v1 r where r.user_id=uid for update;
  select * into j from sma_private.publication_previews_v1 q where q.id=request_id;
  if found then
    if j.user_id<>uid or j.input<>v_input then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT'); end if;
    return jsonb_build_object('ok',true,'status',j.status,'id',j.id,'start_generation',false,'preview',j.preview,'revision',j.revision,'error_code',j.error_code);
  end if;
  if exists(select 1 from sma_private.publication_previews_v1 q where q.user_id=uid and q.status='processing' and q.lease_until>now()) then return jsonb_build_object('ok',false,'code','PREPARATION_RUNNING'); end if;
  if last_requested > now()-interval '30 seconds' or (select count(*) from sma_private.publication_previews_v1 q where q.user_id=uid and q.created_at>now()-interval '1 hour')>=20 then return jsonb_build_object('ok',false,'code','RATE_LIMITED'); end if;
  insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url) values(request_id,uid,c.id,v_input,v_shop) returning * into j;
  update sma_private.publication_rate_v1 set last_requested_at=now() where user_id=uid;
  return jsonb_build_object('ok',true,'status','processing','start_generation',true,'id',j.id,'lease_id',j.lease_id,'input',j.input,'shop_url',j.shop_url);
end;
$$;
revoke all on function sma_private.publication_preview_request_v1(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function sma_private.publication_preview_request_v1(text,jsonb,uuid) to authenticated;

create or replace function public.sma_publication_preview_v1(p_action text,p_input jsonb default '{}'::jsonb,p_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select sma_private.publication_preview_request_v1(p_action,p_input,p_id);
$$;
revoke all on function public.sma_publication_preview_v1(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sma_publication_preview_v1(text,jsonb,uuid) to authenticated;

create or replace function public.sma_publication_preview_finish_v1(p_id uuid,p_lease uuid,p_preview jsonb default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  j sma_private.publication_previews_v1%rowtype;
  c public.sma_kunden%rowtype;
  failure text;
begin
  select * into j from sma_private.publication_previews_v1 q where q.id=p_id for update;
  if not found or j.lease_id is distinct from p_lease or j.status<>'processing' or j.lease_until<now() then return jsonb_build_object('ok',false,'code','INVALID_LEASE'); end if;
  select * into c from public.sma_kunden k where k.id=j.customer_id and k.user_id=j.user_id;
  if not found or c.aktiv is not true or not(c.zahlung_bestaetigt is true or c.demo_delta_aktiv is true) or c.shop_oeffentlich is not true or ('https://sma-automation.com/app/shop.html?shop='||c.shop_slug) is distinct from j.shop_url then failure:='ACCOUNT_CHANGED';
  elsif p_error is not null then failure:='PREPARATION_FAILED';
  elsif jsonb_typeof(p_preview) is distinct from 'object' or octet_length(p_preview::text)>40000 or p_preview->>'stage' is distinct from 'text_preview' or p_preview->'can_publish' is distinct from 'false'::jsonb or p_preview->>'shop_url' is distinct from j.shop_url or jsonb_typeof(p_preview->'drafts') is distinct from 'array' then failure:='INVALID_PREVIEW';
  elsif jsonb_array_length(p_preview->'drafts')<>jsonb_array_length(j.input->'platforms') then failure:='INVALID_PREVIEW';
  end if;
  if failure is not null then
    update sma_private.publication_previews_v1 set status='failed',error_code=failure,finished_at=now() where id=j.id;
    return jsonb_build_object('ok',false,'status','failed','id',j.id,'code',failure);
  end if;
  update sma_private.publication_previews_v1 set status='completed',preview=p_preview,finished_at=now() where id=j.id;
  return jsonb_build_object('ok',true,'status','completed','id',j.id,'preview',p_preview,'revision',j.revision);
end;
$$;
revoke all on function public.sma_publication_preview_finish_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sma_publication_preview_finish_v1(uuid,uuid,jsonb,text) to service_role;
