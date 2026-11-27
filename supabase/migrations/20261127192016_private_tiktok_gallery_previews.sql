-- Annotate only the existing, account-filtered TikTok list. Keep original IDs
-- available to saved edits and history. Gallery tiles use the finished asset.
create function sma_private.portal_gallery_previews_v1(cid bigint, uid uuid, assets jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare profile sma_private.portal_media_profiles_v1%rowtype; result jsonb;
begin
  select p.* into profile from sma_private.portal_media_profiles_v1 p
  join sma_private.publication_portal_folders_v1 folder using(source_id,platform,folder_id)
  join sma_private.publication_rotation_sources_v1 s on s.id=p.source_id
  where s.customer_id=cid and s.owner_id=uid and p.platform='tiktok';
  if not found or jsonb_array_length(assets)=0 then return assets; end if;
  with files as materialized (
    select item,ord,split_part(item->>'revision',':',2) as sha
    from jsonb_array_elements(assets) with ordinality as f(item,ord)
  ), jobs as materialized (
    select j.* from sma_private.portal_media_intake_v1 j
    where j.source_id=profile.source_id and j.platform=profile.platform
  ), ready as (
    select j.input_sha,j.output_sha,j.saved_id,j.creator_logo,
      src.item->>'name' as original_name,src.ord as source_order,
      dst.ord as output_order
    from jobs j
    join files src on src.sha=j.input_sha
    join files dst on dst.sha=j.output_sha
    where j.finished_at is not null and j.saved_id is not null
      and (j.folder_id,j.logo_sha,j.music_sha)=(profile.folder_id,profile.logo_sha,profile.music_sha)
  )
  select coalesce(jsonb_agg(f.item||jsonb_build_object('profile_media',
    case
      when shown.saved_id is not null then jsonb_build_object(
        'state',case when shown.creator_logo then 'verified' else 'private_preview_only' end,
        'source_name',shown.original_name,'drive_id',shown.saved_id)
      when exists(select from ready r where r.source_order=f.ord) or
           exists(select from jobs j where j.output_sha=f.sha and j.input_sha<>j.output_sha)
        then jsonb_build_object('state','hidden_in_picker')
      when profile.logo_sha is null or profile.music_sha is null
        then jsonb_build_object('state','references_required')
      when exists(select from jobs j where j.input_sha=f.sha and j.finished_at is null and j.lease_until>now()
        and (j.folder_id,j.logo_sha,j.music_sha)=(profile.folder_id,profile.logo_sha,profile.music_sha))
        then jsonb_build_object('state','processing')
      else jsonb_build_object('state','waiting')
    end) order by f.ord),'[]'::jsonb) into result
  from files f left join lateral (
    select r.* from ready r where r.output_order=f.ord order by r.source_order limit 1
  ) shown on true;
  return result;
end $$;
revoke all on function sma_private.portal_gallery_previews_v1(bigint,uuid,jsonb)
  from public,anon,authenticated,service_role;

do $$
declare d text:=pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
  anchor text:='on sync.user_id=uid and sync.customer_id=c.id;'||chr(10)||'  return items;';
begin
  if array_length(string_to_array(d,anchor),1)<>2 then raise exception 'CATALOG_LIST_CHANGED'; end if;
  execute replace(d,anchor,$new$on sync.user_id=uid and sync.customer_id=c.id;
  if p_input->>'platform'='tiktok' then
    items:=jsonb_set(items,'{files}',sma_private.portal_gallery_previews_v1(c.id,uid,items->'files'));
  end if;
  return items;$new$);
end $$;
