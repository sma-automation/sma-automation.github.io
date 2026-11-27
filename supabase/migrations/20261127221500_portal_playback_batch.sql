-- Combine the manifest and up to four ordered parts in one authorized read.
create function public.sma_portal_playback_batch_v1(p_asset uuid,p_revision text,p_portal text,p_first integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with manifest as materialized (
  select public.sma_portal_playback_v1(p_asset,p_revision,p_portal,null) as m
  where p_first between 0 and 127
 )
 select m || jsonb_build_object('first',p_first,'chunks',(
   select jsonb_agg(public.sma_portal_playback_v1(p_asset,p_revision,p_portal,i) order by i)
   from generate_series(p_first,least(p_first+3,(m->>'parts')::integer-1)) i
 ))
 from manifest where m is not null and p_first<(m->>'parts')::integer
$$;
revoke all on function public.sma_portal_playback_batch_v1(uuid,text,text,integer) from public,anon;
grant execute on function public.sma_portal_playback_batch_v1(uuid,text,text,integer) to authenticated;
notify pgrst,'reload schema';

-- Read the file list and its Drive watermark in the same database snapshot.
create function public.sma_portal_gallery_v1(p_platform text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.sma_publication_files_v1('list',jsonb_build_object('platform',p_platform))
 || jsonb_build_object('folder_version',(f->>'folder')||'/'||(f->>'verified_at'))
 from (select public.sma_manual_portal_v1('folder',p_platform) f) state
 where p_platform in ('youtube','tiktok','instagram','facebook')
$$;
revoke all on function public.sma_portal_gallery_v1(text) from public,anon;
grant execute on function public.sma_portal_gallery_v1(text) to authenticated;
