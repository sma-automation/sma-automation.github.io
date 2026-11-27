-- Detached customer pilot. Only this copy, its receipt and its test outbox are writable.
create table sma_private.day_release_test_copies_v1 (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 customer_id bigint not null,
 plan_day date not null,
 items jsonb not null check (jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 6),
 created_at timestamptz not null default now()
);
create table sma_private.day_release_test_receipts_v1 (
 id uuid primary key default gen_random_uuid(),
 copy_id uuid not null references sma_private.day_release_test_copies_v1,
 actor text not null check(actor in ('customer','rehearsal')),
 choices jsonb not null,
 created_at timestamptz not null default now(),
 unique(copy_id,actor)
);
create table sma_private.day_release_test_outbox_v1 (
 receipt_id uuid not null references sma_private.day_release_test_receipts_v1,
 item_key text not null,
 due_at timestamptz not null,
 state text not null,
 reasons text[] not null,
 payload jsonb not null,
 primary key(receipt_id,item_key)
);
alter table sma_private.day_release_test_copies_v1 enable row level security;
alter table sma_private.day_release_test_receipts_v1 enable row level security;
alter table sma_private.day_release_test_outbox_v1 enable row level security;
revoke all on sma_private.day_release_test_copies_v1,sma_private.day_release_test_receipts_v1,sma_private.day_release_test_outbox_v1 from public,anon,authenticated,service_role;

-- A local receiver gives an observable result for each due slot; it has no network access.
create table sma_private.day_release_test_events_v1 (
 receipt_id uuid not null, item_key text not null, simulated_at timestamptz not null, operation text not null,
 foreign key(receipt_id,item_key) references sma_private.day_release_test_outbox_v1,
 primary key(receipt_id,item_key)
);
alter table sma_private.day_release_test_events_v1 enable row level security;
revoke all on sma_private.day_release_test_events_v1 from public,anon,authenticated,service_role;
create function sma_private.day_release_test_tick_v1(p_receipt uuid,p_clock timestamptz)
returns void language sql set search_path='' as $$
 insert into sma_private.day_release_test_events_v1(receipt_id,item_key,simulated_at,operation)
 select e.receipt_id,e.item_key,p_clock,case
  when e.state='held' then 'held'
  when e.payload#>'{item,machine_ready}'='true'::jsonb and e.payload#>'{item,provider_permitted}'='true'::jsonb then 'simulated_transfer'
  else 'technical_check' end
 from sma_private.day_release_test_outbox_v1 e
 where e.receipt_id=p_receipt and e.due_at<=p_clock and e.due_at>p_clock-interval '30 minutes'
 on conflict(receipt_id,item_key) do nothing
$$;
revoke all on function sma_private.day_release_test_tick_v1(uuid,timestamptz) from public,anon,authenticated,service_role;

create function sma_private.day_release_test_v1(p_copy uuid,p_action text,p_stamp text,p_choices jsonb,p_operator boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c sma_private.day_release_test_copies_v1%rowtype;
 receipt sma_private.day_release_test_receipts_v1%rowtype;
 actor_name text:=case when p_operator then 'rehearsal' else 'customer' end;
 stamp text; item jsonb; key text; reasons text[]; stage text; decision jsonb; result jsonb; test_time timestamptz;
begin
 if p_operator and coalesce(auth.role(),'')<>'service_role' then return jsonb_build_object('ok',false,'code','ACCESS'); end if;
 if not p_operator and auth.uid() is null then return jsonb_build_object('ok',false,'code','ACCESS'); end if;
 select * into c from sma_private.day_release_test_copies_v1 d where d.id=p_copy
 and (p_operator or d.owner_id=auth.uid()) and exists(select from public.sma_kunden k where (k.id,k.user_id)=(d.customer_id,d.owner_id)
 and k.aktiv and (k.demo_delta_aktiv or k.zahlung_bestaetigt)) for update;
 if not found then return jsonb_build_object('ok',false,'code','COPY_UNAVAILABLE'); end if;
 stamp:=encode(sha256(convert_to(jsonb_build_array(c.id,c.owner_id,c.customer_id,c.plan_day,c.items)::text,'UTF8')),'hex');
 select * into receipt from sma_private.day_release_test_receipts_v1 where copy_id=c.id and actor=actor_name;
 if p_action='confirm' then
  if p_stamp is distinct from stamp then return jsonb_build_object('ok',false,'code','PLAN_CHANGED'); end if;
  if jsonb_typeof(p_choices) is distinct from 'object' or octet_length(p_choices::text)>3000
     or exists(select from jsonb_each(p_choices) e where not exists(select from jsonb_array_elements(c.items) a
       where a->>'key'=e.key and a->>'platform'='tiktok' and (a->'privacy_options') ? (e.value#>>'{}') and jsonb_typeof(e.value)='string')
       and not (e.key='tiktok_ai' and jsonb_typeof(e.value)='boolean')) then
    return jsonb_build_object('ok',false,'code','INVALID_CHOICES');
  end if;
  if receipt.id is not null and receipt.choices<>p_choices then return jsonb_build_object('ok',false,'code','ALREADY_CONFIRMED'); end if;
  if receipt.id is null then
   insert into sma_private.day_release_test_receipts_v1(copy_id,actor,choices) values(c.id,actor_name,p_choices) returning * into receipt;
   for item in select value from jsonb_array_elements(c.items) loop
    key:=item->>'key'; reasons:='{}'; decision:=coalesce(nullif(item->'defaults','null'::jsonb),'{}'::jsonb);
    if item->>'platform'='tiktok' then
     decision:=jsonb_strip_nulls(jsonb_build_object('visibility',p_choices->key,'is_aigc',p_choices->'tiktok_ai'));
    end if;
    if item->'current_file' is distinct from 'true'::jsonb or item->'folder_matches' is distinct from 'true'::jsonb then reasons:=array_append(reasons,'FILE_BINDING'); end if;
    if nullif(item->>'target_id','') is null then reasons:=array_append(reasons,'TARGET'); end if;
    if item->'current_preview' is distinct from 'true'::jsonb or nullif(trim(item->>'caption'),'') is null or nullif(trim(item->>'title'),'') is null then reasons:=array_append(reasons,'TEXT'); end if;
    if item->>'platform'='tiktok' then
     if decision->>'visibility' is null then reasons:=array_append(reasons,'VISIBILITY'); end if;
     if decision->>'is_aigc' is null then reasons:=array_append(reasons,'AI'); end if;
    elsif jsonb_typeof(decision->'made_for_kids') is distinct from 'boolean' or jsonb_typeof(decision->'contains_synthetic_media') is distinct from 'boolean' then
     reasons:=array_append(reasons,'DEFAULTS');
    end if;
    if cardinality(reasons)>0 then stage:='held';
    elsif item->'existing_approved'='true'::jsonb then stage:='existing';
    else stage:='background_check'; end if;
    insert into sma_private.day_release_test_outbox_v1(receipt_id,item_key,due_at,state,reasons,payload)
    values(receipt.id,key,(item->>'due_at')::timestamptz,stage,reasons,
     jsonb_build_object('item',item,'declarations',decision,'consent','test_day_plan','mode','simulation'));
   end loop;
   for test_time in select distinct due_at from sma_private.day_release_test_outbox_v1 where receipt_id=receipt.id order by due_at loop
    perform sma_private.day_release_test_tick_v1(receipt.id,test_time);
   end loop;
  end if;
 elsif p_action is distinct from 'get' then return jsonb_build_object('ok',false,'code','INVALID_ACTION'); end if;
 select coalesce(jsonb_agg(jsonb_build_object('key',e.item_key,'state',e.state,'reasons',e.reasons,'due_at',e.due_at,'operation',ev.operation,'simulated_at',ev.simulated_at) order by e.due_at,e.item_key),'[]') into result from sma_private.day_release_test_outbox_v1 e left join sma_private.day_release_test_events_v1 ev using(receipt_id,item_key) where e.receipt_id=receipt.id;
 return jsonb_build_object('ok',true,'mode','simulation','day',c.plan_day,'items',c.items,'stamp',stamp,'receipt',receipt.id,'confirmed_at',receipt.created_at,'choices',receipt.choices,'results',result);
end $$;
revoke all on function sma_private.day_release_test_v1(uuid,text,text,jsonb,boolean) from public,anon,authenticated,service_role;

create function public.sma_day_release_test_v1(p_copy uuid,p_action text default 'get',p_stamp text default null,p_choices jsonb default '{}')
returns jsonb language sql security definer set search_path='' as $$
 select sma_private.day_release_test_v1(p_copy,p_action,p_stamp,p_choices,false)
$$;
create function public.sma_day_release_rehearse_v1(p_copy uuid,p_action text default 'get',p_stamp text default null,p_choices jsonb default '{}')
returns jsonb language sql security definer set search_path='' as $$
 select sma_private.day_release_test_v1(p_copy,p_action,p_stamp,p_choices,true)
$$;
revoke all on function public.sma_day_release_test_v1(uuid,text,text,jsonb),public.sma_day_release_rehearse_v1(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.sma_day_release_test_v1(uuid,text,text,jsonb) to authenticated;
grant execute on function public.sma_day_release_rehearse_v1(uuid,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
