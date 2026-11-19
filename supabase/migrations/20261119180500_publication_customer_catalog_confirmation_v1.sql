-- Explicit customer confirmation of a Shopify listing for an evidence-bound product profile.
-- No n8n workflow, Shopify product, payment, provider upload or publication changes.
-- A missing/invalid binding fails closed instead of falling back to a different product.
alter table sma_private.publication_product_profiles_v1
  add column catalog_product_row_id bigint references public.sma_produkte(id),
  add column catalog_product_confirmed_at timestamptz;

do $patch$
declare
  ctx regprocedure:='sma_private.publication_product_context_v1(uuid)'::regprocedure;
  offer regprocedure:='sma_private.publication_offer_options_private_v1(uuid,text)'::regprocedure;
  files regprocedure:='sma_private.publication_files_request_v1(text,jsonb)'::regprocedure;
  def text;
  marker text;
  ending text;
begin
  def:=pg_get_functiondef(ctx);
  marker:='      select case when count(*)=1 then min(p.sma_produkt_id) end into listing';
  ending:='      if sma_private.publication_product_link_available_v1(customer,listing) then';
  if length(def)-length(replace(def,marker,''))<>length(marker)
     or length(def)-length(replace(def,ending,''))<>length(ending)
    then raise exception 'PRODUCT_PROFILE_CONTEXT_BASELINE_CHANGED'; end if;
  def:=replace(def,marker,$insert$
      -- An explicit profile/listing binding takes precedence over a name match.
      -- If the bound listing becomes invalid, do not silently substitute it.
      if exists (
        select 1 from sma_private.publication_product_profiles_v1 profile
        where profile.id::text=split_part(matches->0->>'match_key',':',2)
          and profile.customer_id=customer.id and profile.user_id=owner_id
          and profile.catalog_product_row_id is not null
      ) then
        select case when count(*)=1 then min(p.sma_produkt_id) end into listing
        from sma_private.publication_product_profiles_v1 profile
        join public.sma_produkte p on p.id=profile.catalog_product_row_id
        where profile.id::text=split_part(matches->0->>'match_key',':',2)
          and profile.customer_id=customer.id and profile.user_id=owner_id
          and p.user_id=owner_id and p.kunde_id=customer.kunde_id and p.aktiv;
      else
$insert$||marker);
  def:=replace(def,ending,'      end if;'||chr(10)||ending);
  execute def;

  def:=pg_get_functiondef(offer);
  marker:='and lower(btrim(p.produkt_name))=lower(btrim(product_context->>''name''))';
  if length(def)-length(replace(def,marker,''))<>length(marker)
    then raise exception 'OFFER_PRODUCT_LOOKUP_BASELINE_CHANGED'; end if;
  def:=replace(def,marker,$new$and
     (case when product_context->>'product_id' is not null
       then p.sma_produkt_id=product_context->>'product_id'
       else lower(btrim(p.produkt_name))=lower(btrim(product_context->>'name'))
      end)$new$);
  execute def;

  def:=pg_get_functiondef(files);
  marker:='if f.media_kind<>''video'' or sma_private.publication_product_context_v1(f.id) is not null then';
  if length(def)-length(replace(def,marker,''))<>length(marker)
    then raise exception 'PUBLICATION_CATALOG_SEARCH_BASELINE_CHANGED'; end if;
  -- Search is allowed for analyzed videos with a confirmed profile but no listing.
  def:=replace(def,marker,$new$if f.media_kind<>'video' or
    (sma_private.publication_product_context_v1(f.id) is not null and
      (sma_private.publication_product_context_v1(f.id)->>'state' is distinct from 'matched'
       or sma_private.publication_product_context_v1(f.id)->>'product_id' is not null)) then$new$);
  execute def;
end $patch$;

create function public.sma_publication_catalog_confirm_v1(
  p_asset uuid,p_asset_revision text,p_catalog_product_id text
) returns jsonb language plpgsql security definer set search_path='' as $rpc$
declare
  actor uuid:=auth.uid();
  c public.sma_kunden%rowtype;
  f sma_private.publication_files_v1%rowtype;
  profile_id uuid;
  profile_count integer;
  item public.sma_produkte%rowtype;
  previous_row_id bigint;
begin
  if actor is null then
    return jsonb_build_object('ok',false,'code','AUTH_REQUIRED','can_publish',false);
  end if;
  if p_asset is null or p_asset_revision is null or p_catalog_product_id is null
      or p_catalog_product_id !~ '^[A-Za-z0-9_-]{1,80}$' then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT','can_publish',false);
  end if;
  if (select count(*) from public.sma_kunden where user_id=actor)<>1 then
    return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE','can_publish',false);
  end if;
  select * into c from public.sma_kunden where user_id=actor
    and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
  if not found then
    return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE','can_publish',false);
  end if;
  select * into f from sma_private.publication_files_v1
    where id=p_asset and customer_id=c.id and user_id=actor
      and available and media_kind='video';
  if not found then
    return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE','can_publish',false);
  end if;
  if f.revision is distinct from p_asset_revision
     or f.revision !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$' then
    return jsonb_build_object('ok',false,'code','FILE_CHANGED','can_publish',false);
  end if;
  if not exists (
    select 1 from sma_private.publication_magic_results_v1 m
    where m.asset_id=f.id and m.customer_id=c.id and m.user_id=actor
      and m.asset_revision=f.revision and m.status='completed'
      and m.content_sha256=split_part(f.revision,':',2)
  ) then
    return jsonb_build_object('ok',false,'code','ANALYSIS_REQUIRED','can_publish',false);
  end if;
  select count(*),(array_agg(s.product_id))[1]
    into profile_count,profile_id
    from sma_private.publication_product_sources_v1 s
    join sma_private.publication_product_profiles_v1 pr on pr.id=s.product_id
      and pr.customer_id=s.customer_id and pr.user_id=s.user_id
    where s.customer_id=c.id and s.user_id=actor
      and s.sha256=split_part(f.revision,':',2);
  if profile_count<>1 then
    return jsonb_build_object('ok',false,'code','PRODUCT_CONTEXT_AMBIGUOUS','can_publish',false);
  end if;
  select * into item from public.sma_produkte p
    where p.sma_produkt_id=p_catalog_product_id and p.user_id=actor
      and p.kunde_id=c.kunde_id and p.aktiv;
  if not found or sma_private.publication_product_link_available_v1(c,p_catalog_product_id) is not true then
    return jsonb_build_object('ok',false,'code','PRODUCT_LINK_UNAVAILABLE','can_publish',false);
  end if;
  select pr.catalog_product_row_id into previous_row_id
    from sma_private.publication_product_profiles_v1 pr
    where pr.id=profile_id and pr.customer_id=c.id and pr.user_id=actor
    for update;
  if not found then
    return jsonb_build_object('ok',false,'code','PRODUCT_CONTEXT_CHANGED','can_publish',false);
  end if;
  if previous_row_id is distinct from item.id then
    update sma_private.publication_product_profiles_v1
       set catalog_product_row_id=item.id,catalog_product_confirmed_at=now()
     where id=profile_id and customer_id=c.id and user_id=actor;
  end if;
  return jsonb_build_object('ok',true,'status','confirmed','can_publish',false,
    'asset_id',f.id,'asset_revision',f.revision,'product_id',item.sma_produkt_id,
    'changed',previous_row_id is distinct from item.id);
end $rpc$;
revoke all on function public.sma_publication_catalog_confirm_v1(uuid,text,text)
  from public,anon,service_role;
grant execute on function public.sma_publication_catalog_confirm_v1(uuid,text,text)
  to authenticated;
