-- A corrected draft goes through the same account, text and consent path as a
-- first preparation. The old approval and the new preparation remain auditable.
alter table sma_private.publication_orders_v1 add column replaces_blocked_order_id uuid
 references sma_private.publication_orders_v1(id);
create index publication_replaced_order_v1 on sma_private.publication_orders_v1(replaces_blocked_order_id)
 where replaces_blocked_order_id is not null;

create function sma_private.publication_text_revision_eligible_v1(
 previous_id uuid, owner_id uuid, customer bigint, selection jsonb, target_id text
) returns boolean language sql stable security invoker set search_path='' as $$
 select exists (
  select from sma_private.publication_orders_v1 old_order
  join sma_private.publication_journal_v1 journal on journal.order_id=old_order.id
  join sma_private.publication_rotation_deliveries_v1 delivery on delivery.order_id=old_order.id
   and delivery.asset_id=journal.asset_id and delivery.asset_revision=journal.asset_revision
   and delivery.platform=journal.platform and delivery.target_id=journal.target_id
  join sma_private.publication_joint_plans_v1 plan on plan.owner_id=old_order.user_id
   and plan.customer_id=old_order.customer_id and plan.asset_id=delivery.asset_id
   and plan.asset_revision=delivery.asset_revision and plan.version=delivery.plan_version
   and (plan.portal_times->>delivery.platform)::timestamptz=delivery.due_at
  join sma_private.publication_assignments_v1 a on a.asset_id=delivery.asset_id
   and a.asset_revision=delivery.asset_revision and a.platform=delivery.platform
  where old_order.id=$1 and old_order.user_id=$2 and old_order.customer_id=$3
   and journal.customer_id=$3 and journal.target_id=$5 and old_order.target->>'id'=$5
   and journal.platform='tiktok' and selection->>'platform'='tiktok'
   and old_order.target->>'platform'=journal.platform and old_order.binding->>'platform'=journal.platform
   and old_order.binding->>'asset_id'=journal.asset_id::text and selection->>'asset_id'=journal.asset_id::text
   and old_order.binding->>'asset_revision'=journal.asset_revision and selection->>'asset_revision'=journal.asset_revision
   and old_order.binding->>'preview_id'=a.preview_id::text and selection->>'preview_id'=a.preview_id::text
   and selection->'preview_revision'=to_jsonb(a.preview_revision) and selection->'assignment_revision'=to_jsonb(a.revision)
   and a.preview_revision>(old_order.binding->>'preview_revision')::bigint
   and a.revision>(old_order.binding->>'assignment_revision')::bigint and a.draft<>old_order.draft
   and old_order.state='blocked' and old_order.approved_at is not null
   and old_order.lease_id is null and old_order.lease_until is null
   and old_order.blockers ? 'PORTAL_TEXT_COMPARISON'
   and old_order.blockers <@ '["PORTAL_TEXT_COMPARISON","CONTENT_REVIEW_PENDING","SEMANTIC_REVIEW_PENDING"]'::jsonb
   and delivery.fingerprint=sma_private.publication_provider_fingerprint_v1(old_order)
   and plan.daily_slot is not null and delivery.due_at>statement_timestamp()
   and not exists(select from sma_private.publication_provider_attempts_v1 p where p.order_id=old_order.id)
   and not exists(select from sma_private.publication_provider_permissions_v1 p where p.order_id=old_order.id)
 );
$$;
revoke all on function sma_private.publication_text_revision_eligible_v1(uuid,uuid,bigint,jsonb,text)
 from public,anon,authenticated,service_role;

do $migration$
declare
 definition text:=pg_get_functiondef('sma_private.publication_order_request_v1(text,jsonb)'::regprocedure);
 old_lookup constant text:='  if found then
   if exists(select 1 from sma_private.publication_orders_v1 original';
 old_insert constant text:='insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices) values(v_id,uid,c.id,b,a.draft,ch)';
 reservation constant text:='  insert into sma_private.publication_journal_v1(customer_id,asset_id,asset_revision,platform,target_id,order_id)';
 approved constant text:='update sma_private.publication_orders_v1 set approved_at=now(),approval_review=p_input->''review'',state=''approved'',updated_at=now() where id=j.id returning * into j;';
 transfer constant text:=$transfer$
  if j.replaces_blocked_order_id is not null then
   -- The request already holds the customer and candidate locks. Lock the old
   -- order before rechecking eligibility against worker/permission activity.
   perform 1 from sma_private.publication_orders_v1 where id=j.replaces_blocked_order_id for update;
   select * into delivery from sma_private.publication_rotation_deliveries_v1
    where order_id=j.replaces_blocked_order_id for update;
   if not found or not sma_private.publication_text_revision_eligible_v1(j.replaces_blocked_order_id,uid,c.id,j.binding,j.target->>'id')
   then return jsonb_build_object('ok',false,'code','ORDER_CHANGED'); end if;
   media:=sma_private.publication_order_media_v1(j,r->'media_check',j.account_check);
   if (media->'checks' @> '[{"code":"PORTAL_TEXT_COMPARISON","status":"pass"}]'::jsonb) is not true
    or (exists (select from jsonb_array_elements(media->'checks') item
      where item->>'code' in ('CONTENT_REVIEW_PENDING','SEMANTIC_REVIEW_PENDING') and item->>'status'='pending')
      and not (p_input->'review' ? 'human_review')) then
    return jsonb_build_object('ok',false,'code','HUMAN_REVIEW_UNAVAILABLE');
   end if;
   update sma_private.publication_journal_v1 set order_id=j.id,created_at=now()
    where order_id=j.replaces_blocked_order_id and customer_id=c.id and target_id=j.target->>'id';
   if not found then raise exception 'PUBLICATION_RESERVATION_CHANGED'; end if;
  end if;
$transfer$;
 finish constant text:=$finish$
  if j.replaces_blocked_order_id is not null then
   -- The original delivery holds the unique slot throughout fresh approval.
   -- Keep its exact plan and time; the new consent gets a new fingerprint.
   update sma_private.publication_rotation_deliveries_v1
    set order_id=j.id,fingerprint=sma_private.publication_provider_fingerprint_v1(j),next_check=due_at
    where order_id=j.replaces_blocked_order_id returning * into delivery;
   if not found or not sma_private.publication_rotation_current_v1(delivery) then
    raise exception 'SCHEDULE_NOT_CURRENT';
   end if;
  end if;
$finish$;
 anchor text;
begin
 foreach anchor in array array['v_id uuid;',old_lookup,old_insert,reservation,approved] loop
  if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'PUBLICATION_TEXT_REVISION_BASELINE_CHANGED'; end if;
 end loop;
 definition:=replace(definition,'v_id uuid;','v_id uuid; replacement_id uuid; delivery sma_private.publication_rotation_deliveries_v1%rowtype; media jsonb;');
 definition:=replace(definition,old_lookup,$lookup$  if found and sma_private.publication_text_revision_eligible_v1(other_id,uid,c.id,p_input,expected_target) then
   replacement_id:=other_id;
  elsif found then
   if exists(select 1 from sma_private.publication_orders_v1 original$lookup$);
 definition:=replace(definition,old_insert,'insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices,replaces_blocked_order_id) values(v_id,uid,c.id,b,a.draft,ch,replacement_id)');
 definition:=replace(definition,reservation,transfer||reservation);
 execute replace(definition,approved,approved||finish);
end $migration$;
