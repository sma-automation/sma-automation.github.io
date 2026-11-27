-- A declaration follows the owner, the exact Drive folder and the verified YouTube channel.
create table sma_private.youtube_folder_defaults_v1 (
  source_id uuid primary key references sma_private.publication_rotation_sources_v1(id) on delete cascade,
  owner_id uuid not null,
  folder_id text not null,
  channel_id text not null,
  made_for_kids boolean not null,
  contains_synthetic_media boolean not null,
  confirmed_at timestamptz not null default now()
);
alter table sma_private.youtube_folder_defaults_v1 enable row level security;
revoke all on sma_private.youtube_folder_defaults_v1 from public,anon,authenticated,service_role;

create function public.sma_youtube_file_defaults_v1(p_asset_id uuid,p_asset_revision text,p_channel_id text)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((
    select jsonb_build_object('made_for_kids',d.made_for_kids,'contains_synthetic_media',d.contains_synthetic_media)
    from sma_private.youtube_folder_defaults_v1 d
    join sma_private.publication_rotation_sources_v1 s on s.id=d.source_id and s.owner_id=d.owner_id
    join public.sma_kunden k on (k.id,k.user_id)=(s.customer_id,s.owner_id)
    join sma_private.publication_portal_folders_v1 pf on pf.source_id=s.id and pf.platform='youtube' and pf.folder_id=d.folder_id
    join sma_private.publication_rotation_channels_v1 ch on (ch.source_id,ch.platform)=(s.id,pf.platform) and ch.target_id=d.channel_id
    join sma_private.publication_files_v1 f on (f.customer_id,f.user_id)=(k.id,k.user_id)
    where d.owner_id=auth.uid() and k.aktiv and (k.zahlung_bestaetigt or k.demo_delta_aktiv)
      and d.channel_id=p_channel_id and f.id=p_asset_id and f.revision=p_asset_revision and f.available
      and f.media_kind='video' and sma_private.publication_portal_allowed_v1(s.id,'youtube',f.revision)
      and (exists(select from sma_private.publication_rotation_imports_v1 i
          where i.source_id=s.id and i.copy_id=f.drive_file_id and i.digest=split_part(f.revision,':',2) and i.verified_at is not null)
        or exists(select from sma_private.publication_portal_uploads_v1 pu
          join sma_private.publication_uploads_v1 u on u.id=pu.upload_id and u.status='completed'
          where pu.source_id=s.id and pu.platform='youtube' and (u.asset_id,u.user_id,u.customer_id)=(f.id,f.user_id,f.customer_id)))
  ),'{}'::jsonb)
$$;
revoke all on function public.sma_youtube_file_defaults_v1(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sma_youtube_file_defaults_v1(uuid,text,text) to authenticated;

-- Preserve native preparation and idempotency checks. Explicit per-video choices take precedence.
alter table sma_private.publication_orders_v1 add column youtube_expected_channel_id text;
do $migration$
declare
  body text:=pg_get_functiondef('sma_private.publication_order_request_v1(text,jsonb)'::regprocedure);
  choices_anchor constant text:=' ch:=p_input->''choices'';';
  insert_anchor constant text:='(id,user_id,customer_id,binding,draft,choices,replaces_blocked_order_id) values(v_id,uid,c.id,b,a.draft,ch,replacement_id)';
  worker text:=pg_get_functiondef('public.sma_publication_order_worker_v1(text,uuid,uuid,jsonb)'::regprocedure);
  bind_anchor constant text:='  v_target:=p_data->''target'';';
begin
  if strpos(body,choices_anchor)=0 or strpos(body,insert_anchor)=0 or strpos(worker,bind_anchor)=0 then
    raise exception 'Unexpected publication preparation definition';
  end if;
  body:=replace(body,choices_anchor,choices_anchor||$addition$
 if p_input->>'platform'='youtube' and expected_target is not null and jsonb_typeof(ch)='object' then
   if j.id is not null then
     if j.youtube_expected_channel_id is not null and j.youtube_expected_channel_id<>expected_target then
       return jsonb_build_object('ok',false,'code','TARGET_OPTIONS_CHANGED');
     end if;
     ch:=jsonb_build_object('made_for_kids',j.choices->'made_for_kids','contains_synthetic_media',j.choices->'contains_synthetic_media')||ch;
   elsif not (ch ?& array['made_for_kids','contains_synthetic_media']) then
     ch:=public.sma_youtube_file_defaults_v1((p_input->>'asset_id')::uuid,p_input->>'asset_revision',expected_target)||ch;
   end if;
 end if;
$addition$);
  execute replace(body,insert_anchor,'(id,user_id,customer_id,binding,draft,choices,replaces_blocked_order_id,youtube_expected_channel_id) values(v_id,uid,c.id,b,a.draft,ch,replacement_id,case when a.platform=''youtube'' then expected_target end)');
  execute replace(worker,bind_anchor,bind_anchor||$addition$
  if j.youtube_expected_channel_id is not null and v_target->>'id' is distinct from j.youtube_expected_channel_id then
    return jsonb_build_object('ok',false,'code','TARGET_OPTIONS_CHANGED');
  end if;
$addition$);
end $migration$;
notify pgrst,'reload schema';
