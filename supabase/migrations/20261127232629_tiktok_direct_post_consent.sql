-- A TikTok posting click records the platform terms shown for that post.
-- Existing approvals retain their original policy and fingerprint.
alter table sma_private.manual_portal_sends_v1 add column direct_post boolean not null default false;

do $migration$
declare item record; definition text;
begin
 for item in select * from (values
  ('sma_private.publication_single_order_review_valid_v1(jsonb,text,jsonb)',
   ' base:=jsonb_build_object', $v$
 if v->>'policy_version'='sma-tiktok-direct-v1' then
  return p_platform='tiktok' and jsonb_typeof(ch->'brand_content_toggle')='boolean'
   and v=jsonb_build_object('policy_version','sma-tiktok-direct-v1','tiktok_music_terms',true,'tiktok_branded_terms',ch->'brand_content_toggle');
 end if;
 base:=jsonb_build_object$v$),
  ('sma_private.publication_order_view_v1(sma_private.publication_orders_v1)',
   '''approval_policy'',''media-consent-2026-11-03.1''',
   '''direct_post_policy'',case when j.binding->>''platform''=''tiktok'' then ''sma-tiktok-direct-v1'' end,''approval_policy'',''media-consent-2026-11-03.1'''),
  ('sma_private.publication_order_media_v1(sma_private.publication_orders_v1,jsonb,jsonb)',
   ' if j.approved_at is null', $v$
 if j.approved_at is not null and j.binding->>'platform'='tiktok'
    and checked->>'asset_id'=j.binding->>'asset_id' and checked->>'asset_revision'=j.binding->>'asset_revision'
    and jsonb_typeof(checked->'checks')='array'
    and (j.approval_review->>'policy_version'='sma-tiktok-direct-v1' or exists (
      select from sma_private.manual_portal_sends_v1 m where m.order_id=j.id and m.direct_post
      and m.fingerprint=sma_private.publication_provider_fingerprint_v1(j))) then
   select jsonb_agg(c order by n) into optional_checks from jsonb_array_elements(checked->'checks') with ordinality a(c,n)
    where c->>'status'='pending' and c->>'code' in ('SEMANTIC_REVIEW_PENDING','CONTENT_REVIEW_PENDING');
   if optional_checks is null then return checked;end if;
   return checked||jsonb_build_object('optional_personal_checks',optional_checks,'checks',(
    select coalesce(jsonb_agg(c order by n),'[]'::jsonb) from jsonb_array_elements(checked->'checks') with ordinality a(c,n)
    where not(optional_checks @> jsonb_build_array(c))));
 end if;
 if j.approved_at is null$v$),
  ('sma_private.publication_order_request_v1(text,jsonb)',
   $v$and not (p_input->'review' ? 'human_review'))$v$,
   $v$and not (p_input->'review' ? 'human_review') and p_input#>>'{review,policy_version}' is distinct from 'sma-tiktok-direct-v1')$v$),
  ('public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz)',
   'held boolean;', 'held boolean; retry_personal boolean;'),
  ('public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz)',
   $v$ if p_action='read' then return body;end if;$v$, $v$
 retry_personal:=p_platform='tiktok' and o.state='blocked' and o.approved_at is not null
  and o.blockers<>'[]'::jsonb and o.blockers <@ '["CONTENT_REVIEW_PENDING","SEMANTIC_REVIEW_PENDING"]'::jsonb
  and a.order_id is null and coalesce(o.lease_until,'-infinity')<=now()
  and not exists(select from sma_private.publication_provider_events_v1 e where e.order_id=o.id);
 if retry_personal then
  body:=body||jsonb_build_object('state','ready_to_send','can_send',true,'pending',false);
 end if;
 if p_action='read' then return body;end if;$v$),
  ('public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz)',
   ' if m.request_id=p_request then',' if m.request_id=p_request and not (retry_personal and not m.direct_post) then'),
  ('public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz)',
   ' if p_time is null then perform sma_private.wake_custom_portal_schedule_v1();', $v$
 if p_platform='tiktok' then
  update sma_private.manual_portal_sends_v1 set direct_post=true where order_id=o.id and fingerprint=fp;
  if retry_personal then
   update sma_private.publication_orders_v1 set state='approved',blockers='[]'::jsonb,updated_at=now() where id=o.id;
  end if;
 end if;
 if p_time is null then perform sma_private.wake_custom_portal_schedule_v1();$v$)
 ) changes(signature,needle,replacement) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if array_length(string_to_array(definition,item.needle),1)<>2 then raise exception 'Unexpected function definition in %',item.signature;end if;
  execute replace(definition,item.needle,item.replacement);
 end loop;
end $migration$;
