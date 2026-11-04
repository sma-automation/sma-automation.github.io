-- Private, immutable website image copies. Browser roles never access this bucket directly.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sma-webseitenbilder','sma-webseitenbilder',false,2000000,array['image/png','image/jpeg']) on conflict(id) do nothing;
do $$begin
 if exists(select 1 from storage.buckets where id='sma-webseitenbilder' and (public or file_size_limit is distinct from 2000000 or allowed_mime_types is distinct from array['image/png','image/jpeg'])) then raise exception 'WEBSITE_IMAGE_BUCKET_CONFLICT';end if;
end $$;
drop policy if exists sma_website_images_no_direct_access on storage.objects;
create policy sma_website_images_no_direct_access on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'sma-webseitenbilder') with check(bucket_id<>'sma-webseitenbilder');

create table if not exists sma_private.website_images_v1(
 id uuid primary key,customer_id bigint not null references public.sma_kunden(id),user_id uuid not null,
 mime text not null check(mime in ('image/png','image/jpeg')),size integer not null check(size between 24 and 2000000),
 width integer not null check(width between 1 and 1600),height integer not null check(height between 1 and 1600),
 sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 state text not null default 'reserved' check(state in ('reserved','ready','deleting','deleted')),
 created_at timestamptz not null default now()
);
create index if not exists website_images_owner_created on sma_private.website_images_v1(customer_id,created_at);
alter table sma_private.website_images_v1 enable row level security;
revoke all on sma_private.website_images_v1 from public,anon,authenticated,service_role;

create or replace function sma_private.website_images_valid_v1(content jsonb,customer bigint,owner uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from (values(content->>'logo_image_id'),(content->>'hero_image_id')) refs(id)
 where coalesce(id,'')<>'' and not exists(select 1 from sma_private.website_images_v1 i where i.id::text=refs.id and i.customer_id=customer and i.user_id=owner and i.state='ready'))
$$;
revoke all on function sma_private.website_images_valid_v1(jsonb,bigint,uuid) from public,anon,authenticated,service_role;

create or replace function sma_private.website_image_service_v1(p_user_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.sma_kunden%rowtype;w sma_private.customer_websites_v1%rowtype;i sma_private.website_images_v1%rowtype;
 image_id uuid;access_ok boolean;result jsonb;
begin
 if p_action is null or p_action not in ('reserve','complete','read','read_public','reap','discard') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>1200 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_action<>'reap' then
  if jsonb_typeof(p_input->'id') is distinct from 'string' or coalesce(p_input->>'id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  image_id:=(p_input->>'id')::uuid;
 end if;
 if p_action='read_public' then
  if p_user_id is not null or jsonb_typeof(p_input->'site_id') is distinct from 'string' or coalesce(p_input->>'site_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select * into w from sma_private.customer_websites_v1 where site_id=(p_input->>'site_id')::uuid;
  if w.published is null or not(coalesce(w.published->>'logo_image_id','')=image_id::text or (coalesce(w.published->>'hero','')='image' and coalesce(w.published->>'hero_image_id','')=image_id::text)) then return jsonb_build_object('ok',false,'code','IMAGE_UNAVAILABLE');end if;
  select * into c from public.sma_kunden where id=w.customer_id and user_id=w.user_id;
  if c.id is null or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) or (c.demo_delta_aktiv is not true and lower(btrim(coalesce(c.paket,'')))<>'delta') then return jsonb_build_object('ok',false,'code','IMAGE_UNAVAILABLE');end if;
 else
  if p_user_id is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
  -- Serialize all image lifecycle mutations with website saves and publication.
  begin select * into strict c from public.sma_kunden where user_id=p_user_id for update;
  exception when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end;
  select * into w from sma_private.customer_websites_v1 where customer_id=c.id;
  if w.customer_id is null then return jsonb_build_object('ok',false,'code','WEBSITE_REQUIRED');end if;
  if w.user_id is distinct from p_user_id then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED');end if;
  access_ok:=c.aktiv is true and (c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) and (c.demo_delta_aktiv is true or lower(btrim(coalesce(c.paket,'')))='delta');
  if not access_ok and p_action<>'read' then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 end if;
 if p_action='reap' then
  if p_input<>'{}'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  with stale as (
   select id from sma_private.website_images_v1 x where x.customer_id=c.id and x.user_id=p_user_id and x.state<>'deleted' and x.created_at<now()-interval '24 hours'
   and x.id::text not in (coalesce(w.draft->>'logo_image_id',''),coalesce(w.draft->>'hero_image_id',''),coalesce(w.published->>'logo_image_id',''),coalesce(w.published->>'hero_image_id',''))
   order by x.created_at limit 12
  ), marked as(update sma_private.website_images_v1 x set state='deleting' from stale where x.id=stale.id returning x.id,x.mime)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'mime',mime)),'[]') into result from marked;
  return jsonb_build_object('ok',true,'images',result);
 end if;
 select * into i from sma_private.website_images_v1 where id=image_id;
 if i.id is not null and (i.customer_id<>c.id or i.user_id is distinct from c.user_id) then return jsonb_build_object('ok',false,'code','IMAGE_UNAVAILABLE');end if;
 if p_action='reserve' then
  if (select count(*) from jsonb_object_keys(p_input))<>6 or not(p_input ?& array['id','mime','size','width','height','sha256'])
   or jsonb_typeof(p_input->'mime') is distinct from 'string' or coalesce(p_input->>'mime','') not in ('image/png','image/jpeg')
   or jsonb_typeof(p_input->'sha256') is distinct from 'string' or coalesce(p_input->>'sha256','')!~'^[a-f0-9]{64}$'
   or exists(select 1 from unnest(array['size','width','height']) k where jsonb_typeof(p_input->k) is distinct from 'number' or (p_input->>k)!~'^[1-9][0-9]{0,6}$')
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if (p_input->>'size')::integer not between 24 and 2000000 or (p_input->>'width')::integer>1600 or (p_input->>'height')::integer>1600 then return jsonb_build_object('ok',false,'code','IMAGE_SIZE');end if;
  if i.id is not null then
   if i.state not in ('reserved','ready') or i.sha256<>p_input->>'sha256' or i.mime<>p_input->>'mime' or i.size<>(p_input->>'size')::integer or i.width<>(p_input->>'width')::integer or i.height<>(p_input->>'height')::integer then return jsonb_build_object('ok',false,'code','IMAGE_CONFLICT');end if;
  else
   if (select count(*) from sma_private.website_images_v1 where customer_id=c.id and created_at>now()-interval '1 hour')>=12 or (select count(*) from sma_private.website_images_v1 where customer_id=c.id and state<>'deleted')>=24 then return jsonb_build_object('ok',false,'code','IMAGE_LIMIT');end if;
   insert into sma_private.website_images_v1(id,customer_id,user_id,mime,size,width,height,sha256) values(image_id,c.id,p_user_id,p_input->>'mime',(p_input->>'size')::integer,(p_input->>'width')::integer,(p_input->>'height')::integer,p_input->>'sha256') returning * into i;
  end if;
 elsif p_action='complete' then
  if i.id is null or i.state not in ('reserved','ready') or i.sha256 is distinct from p_input->>'sha256' then return jsonb_build_object('ok',false,'code','IMAGE_UNAVAILABLE');end if;
  update sma_private.website_images_v1 set state='ready' where id=i.id returning * into i;
 elsif p_action='discard' then
  if i.id is null or i.state not in ('deleting','deleted') then return jsonb_build_object('ok',false,'code','IMAGE_UNAVAILABLE');end if;
  update sma_private.website_images_v1 set state='deleted' where id=i.id;return jsonb_build_object('ok',true);
 else
  if i.id is null or i.state<>'ready' then return jsonb_build_object('ok',false,'code','IMAGE_UNAVAILABLE');end if;
 end if;
 return jsonb_build_object('ok',true,'id',i.id,'mime',i.mime,'size',i.size,'width',i.width,'height',i.height,'sha256',i.sha256,'state',i.state);
end $$;
revoke all on function sma_private.website_image_service_v1(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant usage on schema sma_private to service_role;
grant execute on function sma_private.website_image_service_v1(uuid,text,jsonb) to service_role;
create or replace function public.sma_website_image_service_v1(p_user_id uuid,p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.website_image_service_v1(p_user_id,p_action,p_input)$$;
revoke all on function public.sma_website_image_service_v1(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_website_image_service_v1(uuid,text,jsonb) to service_role;
