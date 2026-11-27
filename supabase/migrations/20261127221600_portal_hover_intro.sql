-- Small muted starts correspond to the same verified full rendition.
create table sma_private.portal_hover_intro_v1 (
 rendition_sha text primary key check(rendition_sha ~ '^[a-f0-9]{64}$'),
 payload bytea not null check(octet_length(payload) between 1 and 131072)
);
alter table sma_private.portal_hover_intro_v1 enable row level security;
revoke all on sma_private.portal_hover_intro_v1 from public,anon,authenticated;
create function public.sma_portal_hover_intro_v1(p_asset uuid,p_revision text,p_portal text)
returns text language sql stable security definer set search_path='' as $$
 select replace(encode(i.payload,'base64'),chr(10),'')
 from sma_private.portal_hover_intro_v1 i
 where i.rendition_sha=(public.sma_portal_playback_v1(p_asset,p_revision,p_portal,null)->>'sha')
$$;
revoke all on function public.sma_portal_hover_intro_v1(uuid,text,text) from public,anon;
grant execute on function public.sma_portal_hover_intro_v1(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
