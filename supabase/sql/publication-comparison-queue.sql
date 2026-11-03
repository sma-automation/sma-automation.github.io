-- Durable delivery of the saved-text check. No provider upload permission.
create table if not exists sma_private.publication_comparison_queue_v1 (
 order_id uuid primary key references sma_private.publication_orders_v1(id),
 state text not null default 'queued' check(state in ('queued','running','completed','needs_review','cancelled')),
 deliveries integer not null default 0 check(deliveries between 0 and 3),
 lease_id uuid, lease_until timestamptz, code text, source_fingerprint text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table sma_private.publication_comparison_queue_v1 enable row level security;
revoke all on sma_private.publication_comparison_queue_v1 from public,anon,authenticated;
grant select,insert,update on sma_private.publication_comparison_queue_v1 to service_role;

create or replace function sma_private.publication_comparison_enqueue_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.binding->>'platform' in ('youtube','tiktok') and new.binding->>'media_kind'='video' then
  insert into sma_private.publication_comparison_queue_v1(order_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function sma_private.publication_comparison_enqueue_v1() from public,anon,authenticated,service_role;
create or replace trigger publication_comparison_enqueue_v1 after insert on sma_private.publication_orders_v1
 for each row execute function sma_private.publication_comparison_enqueue_v1();

create or replace function public.sma_publication_comparison_delivery_v1(p_action text,p_id uuid,p_lease uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j sma_private.publication_orders_v1%rowtype;q sma_private.publication_comparison_queue_v1%rowtype;c jsonb;fp text;
begin
 if p_action is null or p_action not in ('claim','finish') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 -- Same lock order on every transition. A cancellation cannot race a claim.
 select * into j from sma_private.publication_orders_v1 where id=p_id for update;
 if not found or j.binding->>'platform' not in ('youtube','tiktok') or j.binding->>'media_kind' is distinct from 'video' then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
 if j.state='cancelled' then
  update sma_private.publication_comparison_queue_v1 set state='cancelled',lease_id=null,lease_until=null,updated_at=now() where order_id=p_id;
  return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');
 end if;
 c:=sma_private.publication_order_current_v1(j);
 if c->'ok' is distinct from 'true'::jsonb then return c;end if;
 -- Also lets a current pre-migration order be delivered on its next get/prepare.
 insert into sma_private.publication_comparison_queue_v1(order_id) values(p_id) on conflict do nothing;
 select * into q from sma_private.publication_comparison_queue_v1 where order_id=p_id for update;
 if p_action='finish' and (p_lease is null or q.state<>'running' or q.lease_id is distinct from p_lease or q.lease_until<=now()) then
  return jsonb_build_object('ok',false,'code','INVALID_LEASE');end if;
 c:=public.sma_publication_comparison_context_v1(j.binding);
 if c->'ok' is distinct from 'true'::jsonb then return c;end if;
 fp:=c->>'source_fingerprint';
 if q.source_fingerprint is distinct from fp then
  if p_action='finish' then
   update sma_private.publication_comparison_queue_v1 set state='needs_review',lease_id=null,lease_until=null,code='COMPARISON_EVIDENCE_CHANGED',updated_at=now() where order_id=p_id;
   return jsonb_build_object('ok',false,'code','COMPARISON_EVIDENCE_CHANGED','can_upload',false,'can_publish',false);
  end if;
  if q.state='running' and q.lease_until>now() then return jsonb_build_object('ok',true,'state','running','can_upload',false,'can_publish',false);end if;
  update sma_private.publication_comparison_queue_v1 set state='queued',deliveries=0,source_fingerprint=fp,lease_id=null,lease_until=null,code=null,updated_at=now() where order_id=p_id returning * into q;
 end if;
 -- Re-read authoritative result. A caller cannot report an invented success.
 c:=public.sma_publication_comparison_v1('get',j.binding);
 if c->'ok' is distinct from 'true'::jsonb then return c;end if;
 if c->>'state'='completed' then
  update sma_private.publication_comparison_queue_v1 set state='completed',lease_id=null,lease_until=null,code=null,updated_at=now() where order_id=p_id;
  return jsonb_build_object('ok',true,'state','completed','can_upload',false,'can_publish',false);
 end if;
 if p_action='finish' or c->>'state'='failed' or q.deliveries>=3 then
  update sma_private.publication_comparison_queue_v1 set state='needs_review',lease_id=null,lease_until=null,code='CONTENT_COMPARISON_UNAVAILABLE',updated_at=now() where order_id=p_id;
  return jsonb_build_object('ok',true,'state','needs_review','can_upload',false,'can_publish',false);
 end if;
 if q.state in ('completed','needs_review','cancelled') then return jsonb_build_object('ok',true,'state',q.state,'can_upload',false,'can_publish',false);end if;
 if q.state='running' and q.lease_until>now() then return jsonb_build_object('ok',true,'state','running','can_upload',false,'can_publish',false);end if;
 -- A model call already in progress is never repeated. A lost launch before
 -- start can be redelivered; comparison.start has its own fingerprint lock.
 if c->>'state'='processing' then return jsonb_build_object('ok',true,'state','running','can_upload',false,'can_publish',false);end if;
 update sma_private.publication_comparison_queue_v1 set state='running',deliveries=deliveries+1,lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() where order_id=p_id returning * into q;
 return jsonb_build_object('ok',true,'state','running','id',p_id,'lease_id',q.lease_id,'binding',j.binding,'can_upload',false,'can_publish',false);
end $$;
revoke all on function public.sma_publication_comparison_delivery_v1(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sma_publication_comparison_delivery_v1(text,uuid,uuid) to service_role;
