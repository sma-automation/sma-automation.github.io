-- Customer-confirmed product facts used only as input for drafting portal text.
create table sma_private.publication_product_profiles_v1 (
  id uuid primary key default gen_random_uuid(),
  customer_id bigint not null references public.sma_kunden(id),
  user_id uuid not null,
  name text not null check (length(trim(name)) between 2 and 160),
  topic text not null check (length(trim(topic)) between 2 and 100),
  purpose text not null check (length(trim(purpose)) between 10 and 1200),
  unique (customer_id, user_id, id)
);
create table sma_private.publication_product_sources_v1 (
  customer_id bigint not null,
  user_id uuid not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  product_id uuid not null,
  primary key (customer_id, user_id, sha256, product_id),
  foreign key (customer_id, user_id, product_id)
    references sma_private.publication_product_profiles_v1(customer_id, user_id, id)
);
alter table sma_private.publication_product_profiles_v1 enable row level security;
alter table sma_private.publication_product_sources_v1 enable row level security;
revoke all on sma_private.publication_product_profiles_v1, sma_private.publication_product_sources_v1
  from public, anon, authenticated, service_role;

create function sma_private.publication_product_context_v1(asset uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  owner_id uuid := auth.uid();
  customer public.sma_kunden%rowtype;
  selected sma_private.publication_files_v1%rowtype;
  matches jsonb;
  observation text;
  resolved jsonb;
begin
  if owner_id is null then return null; end if;
  if (select count(*) from public.sma_kunden where user_id=owner_id) <> 1 then return null; end if;
  select * into customer from public.sma_kunden where user_id=owner_id and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
  if not found then return null; end if;
  select * into selected from sma_private.publication_files_v1
    where id=asset and user_id=owner_id and customer_id=customer.id and available;
  if not found then return null; end if;

  -- UNION deduplicates file revisions and terminates cycles. Each export edge
  -- is checked against the finished output and the current tenant's source.
  with recursive lineage(id,revision,size_bytes) as (
    select selected.id,selected.revision,selected.size_bytes
    union
    select parent.id,parent.revision,parent.size_bytes
    from lineage child
    join sma_private.publication_editor_exports_v1 e on e.media_asset_id=child.id
      and e.customer_id=customer.id and e.user_id=owner_id and e.completed_at is not null
      and child.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
      and e.outputs#>>'{media,sha256}'=split_part(child.revision,':',2)
      and e.outputs#>'{media,size_bytes}'=to_jsonb(child.size_bytes)
    join sma_private.publication_files_v1 parent on parent.id=e.asset_id and parent.revision=e.asset_revision
      and parent.user_id=owner_id and parent.customer_id=customer.id and parent.available
  ), labels(value) as (
    select lower(btrim(regexp_replace(f.name,'\.[^.]+$','')))
    from lineage l join sma_private.publication_files_v1 f on f.id=l.id
    union
    select lower(btrim(label))
    from lineage l join sma_private.publication_files_v1 f on f.id=l.id
    join sma_private.publication_magic_results_v1 m on m.asset_id=l.id and m.asset_revision=l.revision
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(m.result->'visible_text')='array'
      then m.result->'visible_text' else '[]'::jsonb end) as items(label)
    where m.status='completed' and (l.revision not like 'sha256:%' or m.content_sha256=split_part(l.revision,':',2))
      and m.user_id=owner_id and m.customer_id=customer.id
      and m.n8n_kunde_id=customer.n8n_kunde_id and m.kunde_email=customer.kunde_email
      and m.policy_version=case f.media_kind when 'video' then 'magic-video-2026-11-03.1' else 'magic-photo-2026-11-02.1' end
  ), products as (
    select distinct 1 priority,'media' method,('profile:'||p.id) key,p.name,p.topic,p.purpose
    from lineage l join sma_private.publication_product_sources_v1 s
      on s.customer_id=customer.id and s.user_id=owner_id and l.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
      and s.sha256=split_part(l.revision,':',2)
    join sma_private.publication_product_profiles_v1 p on p.id=s.product_id and p.customer_id=s.customer_id and p.user_id=s.user_id
    union all
    select 2,'label','profile:'||p.id,p.name,p.topic,p.purpose
    from sma_private.publication_product_profiles_v1 p
    where p.user_id=owner_id and p.customer_id=customer.id
      and length(trim(p.name))>=4 and lower(trim(p.name)) in (select value from labels)
    union all
    select 2,'catalog','shop:'||p.id,left(trim(p.produkt_name),160),null::text,
      left(trim(coalesce(p.beschreibung,'')),1200)
    from public.sma_produkte p where p.user_id=owner_id and p.kunde_id=customer.kunde_id and p.aktiv
      and nullif(trim(p.produkt_name),'') is not null
      and exists(select 1 from labels l where length(l.value)>=4 and
        l.value in (lower(trim(p.produkt_name)),lower(trim(p.sku)),lower(trim(p.sma_produkt_id))))
  )
  select jsonb_agg(jsonb_build_object('name',name,'topic',topic,'purpose',purpose,'method',method))
    into matches from products where priority=(select min(priority) from products);

  if matches is null then return null; end if;
  if jsonb_array_length(matches)>1 then
    return jsonb_build_object('state','ambiguous','asset_id',asset,'asset_revision',selected.revision);
  end if;
  resolved:=matches->0;
  if sma_private.publication_export_technical_v1(selected) is not null then
    select e.local_probe#>>'{content_observations,visual}' into observation
    from sma_private.publication_editor_exports_v1 e where e.media_asset_id=selected.id and e.user_id=owner_id
      and e.customer_id=customer.id and e.completed_at is not null and e.local_probe->>'asset_revision'=selected.revision
      and e.local_probe->>'sha256'=split_part(selected.revision,':',2)
      and e.local_probe->'size_bytes'=to_jsonb(selected.size_bytes)
      and e.outputs#>'{media,sha256}'=e.local_probe->'sha256'
      and e.outputs#>'{media,size_bytes}'=e.local_probe->'size_bytes'
      and e.local_probe#>>'{content_observations,source}'='assisted_viewing'
      and e.local_probe#>'{content_observations,frames_viewed}'=e.local_probe#>'{technical,decoded_frames}'
    order by e.completed_at desc,e.id desc limit 1;
  end if;
  return resolved||jsonb_build_object('state','matched','asset_id',asset,'asset_revision',selected.revision,
    'visual',left(observation,1000));
end $$;
revoke all on function sma_private.publication_product_context_v1(uuid) from public,anon,service_role;
grant execute on function sma_private.publication_product_context_v1(uuid) to authenticated;

-- Enrich the existing authenticated file lookup. Other actions retain their API.
do $$begin
  if trim((select prosrc from pg_proc where oid='public.sma_publication_files_v1(text,jsonb)'::regprocedure))
    <> 'select sma_private.publication_files_request_v1(p_action,p_input);'
  then raise exception 'PUBLICATION_FILES_WRAPPER_CHANGED'; end if;
end $$;
create or replace function public.sma_publication_files_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;
begin
  if p_action='product' then
    -- Reuse the catalog's authenticated revision check without loading saved drafts.
    response:=sma_private.publication_files_request_v1('check',p_input);
    if response->'ok' is distinct from 'true'::jsonb then return response; end if;
    return jsonb_build_object('ok',true,'product_context',
      sma_private.publication_product_context_v1((p_input->>'asset_id')::uuid));
  end if;
  response:=sma_private.publication_files_request_v1(p_action,p_input);
  if p_action='get' and response->'ok'='true'::jsonb then
    return response||jsonb_build_object('product_context',sma_private.publication_product_context_v1((p_input->>'asset_id')::uuid));
  end if;
  return response;
end $$;
