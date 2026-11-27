-- A choice belongs to one exact draft, account and scheduled appearance.
create table sma_private.day_post_visibility_v1 (
  owner_id uuid not null,
  plan_day date not null,
  draft_key text not null,
  visibility text not null check (visibility in ('PUBLIC_TO_EVERYONE','SELF_ONLY','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR')),
  primary key (owner_id,plan_day,draft_key)
);
alter table sma_private.day_post_visibility_v1 enable row level security;
revoke all on sma_private.day_post_visibility_v1 from public, anon, authenticated, service_role;

create function sma_private.day_visibility_key_v1(day_in date,item jsonb) returns text
language sql stable set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_array(day_in,item->'source_id',item->'folder_id',item->'platform',
    item->'target_id',item->'asset_id',item->'asset_revision',item->'assignment_revision',item->'preview_id',
    item->'preview_revision',item->'plan_version',extract(epoch from (item->>'due_at')::timestamptz))::text,'UTF8')),'hex')
$$;
revoke all on function sma_private.day_visibility_key_v1(date,jsonb) from public,anon,authenticated,service_role;

alter function sma_private.day_publish_plan_v1(date) rename to day_publish_plan_items_v1;
create function sma_private.day_publish_plan_v1(day_in date) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(case when d.item->>'platform'='tiktok'
    then d.item||jsonb_build_object('visibility_key',k.draft_key,'saved_visibility',v.visibility)
    else d.item end order by d.pos),'[]'::jsonb)
  from jsonb_array_elements(sma_private.day_publish_plan_items_v1(day_in)) with ordinality as d(item,pos)
  cross join lateral (select sma_private.day_visibility_key_v1(day_in,d.item) draft_key) k
  left join sma_private.day_post_visibility_v1 v on (v.owner_id,v.plan_day,v.draft_key)=(auth.uid(),day_in,k.draft_key)
$$;
revoke all on function sma_private.day_publish_plan_v1(date) from public,anon,authenticated,service_role;

create function public.sma_save_day_visibility_v1(p_day date,p_key text,p_visibility text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); today date:=(now() at time zone 'Europe/Vienna')::date;
begin
  if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
  if p_day is null or p_day not between today and today+2 or p_key is null or p_key !~ '^[0-9a-f]{64}$'
    or (p_visibility is not null and p_visibility not in ('PUBLIC_TO_EVERYONE','SELF_ONLY','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR'))
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  if not exists (
    select from jsonb_array_elements(sma_private.day_publish_plan_items_v1(p_day)) as d(item)
    where item->>'platform'='tiktok' and item->>'preview_id' is not null and item->>'existing_order' is null
      and item->'slot_conflict'='false'::jsonb and item->'current_file'='true'::jsonb
      and sma_private.day_visibility_key_v1(p_day,item)=p_key
  ) then return jsonb_build_object('ok',false,'code','PLAN_CHANGED');end if;
  delete from sma_private.day_post_visibility_v1 where owner_id=uid and plan_day<today;
  if p_visibility is null then
    delete from sma_private.day_post_visibility_v1 where (owner_id,plan_day,draft_key)=(uid,p_day,p_key);
  else
    insert into sma_private.day_post_visibility_v1 values(uid,p_day,p_key,p_visibility)
    on conflict(owner_id,plan_day,draft_key) do update set visibility=excluded.visibility;
  end if;
  return jsonb_build_object('ok',true,'visibility',p_visibility);
end $$;
revoke all on function public.sma_save_day_visibility_v1(date,text,text) from public,anon,authenticated,service_role;
grant execute on function public.sma_save_day_visibility_v1(date,text,text) to authenticated;
notify pgrst,'reload schema';
