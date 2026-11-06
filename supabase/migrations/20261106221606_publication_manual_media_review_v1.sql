-- Optional customer attestation, bound to one immutable order. No provider grant.
-- Baseline is the installed PR #57 integration; that PR remains separate.
do $$begin
 if (select count(*) from pg_proc where
  (oid='sma_private.publication_order_review_valid_v1(jsonb,text,jsonb)'::regprocedure and md5(prosrc)='43e41da0a36f6afb6679d95477bd2107') or
  (oid='sma_private.publication_order_media_v1(sma_private.publication_orders_v1,jsonb,jsonb)'::regprocedure and md5(prosrc)='9bb3cf579437a4de6ef08ded6edd69d6') or
  (oid='sma_private.publication_order_view_v1(sma_private.publication_orders_v1)'::regprocedure and md5(prosrc)='987636d4d0b9ec75f0b2091ae1c3292b') or
  (oid='sma_private.publication_order_request_v1(text,jsonb)'::regprocedure and md5(prosrc)='d91210e8b866c4f5e6ec9c467653b21e') or
  (oid='public.sma_publication_order_worker_v1(text,uuid,uuid,jsonb)'::regprocedure and md5(prosrc)='6b6c44d9c0d402893bf2317aae5e9113'))<>5
 then raise exception 'MANUAL_REVIEW_BASELINE_CHANGED';end if;
end $$;

create function sma_private.publication_human_review_scope_v1(j sma_private.publication_orders_v1)
returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('id',j.id,'user',j.user_id,'customer',j.customer_id,
  'binding',j.binding,'draft',j.draft,'target',j.target,'choices',j.choices)::text,'UTF8')),'hex');
$$;

create function sma_private.publication_human_review_valid_v1(v jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_typeof(v)='object' and v->>'source_fingerprint' ~ '^[a-f0-9]{64}$'
  and v=jsonb_build_object('policy_version','human-video-2026-11-06.1','source_fingerprint',v->>'source_fingerprint',
   'full_playback',true,'visual_clear',true,'speech_text_checked',true,'claims_match',true),false);
$$;

create or replace function sma_private.publication_order_review_valid_v1(v jsonb,p_platform text,ch jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare base jsonb;
begin
 if p_platform is null or p_platform not in ('youtube','tiktok','instagram','facebook') or jsonb_typeof(v) is distinct from 'object' then return false;end if;
 base:=jsonb_build_object('policy_version','media-consent-2026-11-03.1','content_checked',true,'media_rights',true,'music_rights',true,
  'tiktok_music_terms',p_platform='tiktok','tiktok_branded_terms',p_platform='tiktok' and ch->'brand_content_toggle'='true'::jsonb);
 return v=base or (p_platform in ('youtube','tiktok') and v-'human_review'=base
  and sma_private.publication_human_review_valid_v1(v->'human_review'));
end $$;

create function sma_private.publication_human_review_available_v1(j sma_private.publication_orders_v1,m jsonb)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare r jsonb;
begin
 if j.state='cancelled' or coalesce(j.binding->>'platform','') not in ('youtube','tiktok') or j.binding->>'media_kind' is distinct from 'video'
 or m->>'asset_id' is distinct from j.binding->>'asset_id' or m->>'asset_revision' is distinct from j.binding->>'asset_revision'
 or coalesce(j.binding->>'asset_revision','') !~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
 or jsonb_typeof(m->'checks') is distinct from 'array' then return false;end if;
 if not(m->'checks' @> '[{"code":"BINARY_INSPECTION","status":"pass"},{"code":"PORTAL_TEXT_COMPARISON","status":"pass"},{"code":"SEMANTIC_REVIEW_PENDING","status":"pending"}]'::jsonb)
 or m#>>'{facts,mime_type}' is distinct from 'video/mp4'
 or jsonb_typeof(m#>'{facts,size_bytes}') is distinct from 'number' or coalesce(m#>>'{facts,size_bytes}','') !~ '^[1-9][0-9]{0,7}$'
 or jsonb_typeof(m#>'{facts,duration_ms}') is distinct from 'number' or coalesce(m#>>'{facts,duration_ms}','') !~ '^[1-9][0-9]{0,4}$'
 then return false;end if;
 if (m#>>'{facts,size_bytes}')::bigint>24000000 or (m#>>'{facts,duration_ms}')::bigint>60000 then return false;end if;
 -- Only the two explicitly missing checks can use human evidence. All known
 -- failures, unknown statuses, creator limits and comparison findings survive.
 if exists(select 1 from jsonb_array_elements(m->'checks') x where
  x->>'code' is null or x->>'status' is null or
  (x->>'code' in ('CONTENT_REVIEW_PENDING','SEMANTIC_REVIEW_PENDING','PUBLICATION_APPROVAL_PENDING') and x->>'status'<>'pending') or
  (x->>'code' not in ('CONTENT_REVIEW_PENDING','SEMANTIC_REVIEW_PENDING','PUBLICATION_APPROVAL_PENDING') and x->>'status'<>'pass')) then return false;end if;
 r:=m->'content_review';
 if r->>'asset_id' is distinct from j.binding->>'asset_id' or r->>'asset_revision' is distinct from j.binding->>'asset_revision'
 or r->>'policy_version' is distinct from 'visual-2026-11-01.1' then return false;end if;
 return coalesce(
  ((r->>'status'='unreviewed' or (r->>'status'='failed' and r->>'error_code'='VIDEO_PLAN_REQUIRED'))
    and m->'checks' @> '[{"code":"CONTENT_REVIEW_PENDING","status":"pending"}]'::jsonb)
  or (r->>'status'='completed' and r#>>'{result,outcome}'='clear'
    and m->'checks' @> '[{"code":"VISUAL_REVIEW","status":"pass"}]'::jsonb),false);
end $$;

create function sma_private.publication_human_review_media_v1(j sma_private.publication_orders_v1,m jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare checks jsonb;
begin
 if j.approved_at is null or sma_private.publication_order_review_valid_v1(j.approval_review,j.binding->>'platform',j.choices) is not true
 or sma_private.publication_human_review_valid_v1(j.approval_review->'human_review') is not true
 or j.approval_review#>>'{human_review,source_fingerprint}' is distinct from sma_private.publication_human_review_scope_v1(j)
 or sma_private.publication_human_review_available_v1(j,m) is not true then return m;end if;
 select jsonb_agg(case x->>'code'
  when 'CONTENT_REVIEW_PENDING' then jsonb_build_object('code','HUMAN_VISUAL_REVIEW','status','pass','message','Persönlich geprüft: Der Kunde hat die vollständige Datei auf die aufgeführten visuellen Risiken geprüft. Dies ist keine automatische Sicherheitsprüfung.')
  when 'SEMANTIC_REVIEW_PENDING' then jsonb_build_object('code','HUMAN_SEMANTIC_REVIEW','status','pass','message','Persönlich geprüft: Der Kunde hat Ton, Einblendungen, Aussagen und den gespeicherten Beitrag abgeglichen. Dies ist keine automatische Inhaltsanalyse.')
  else x end order by n) into checks from jsonb_array_elements(m->'checks') with ordinality as items(x,n);
 return m||jsonb_build_object('checks',checks,'can_publish',false,'human_review',jsonb_build_object(
  'method','customer_attestation','policy_version','human-video-2026-11-06.1','reviewed_at',j.approved_at));
end $$;

revoke all on function sma_private.publication_human_review_scope_v1(sma_private.publication_orders_v1),
 sma_private.publication_human_review_valid_v1(jsonb),sma_private.publication_human_review_available_v1(sma_private.publication_orders_v1,jsonb),
 sma_private.publication_human_review_media_v1(sma_private.publication_orders_v1,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_human_review_scope_v1(sma_private.publication_orders_v1),
 sma_private.publication_human_review_valid_v1(jsonb),sma_private.publication_human_review_available_v1(sma_private.publication_orders_v1,jsonb),
 sma_private.publication_human_review_media_v1(sma_private.publication_orders_v1,jsonb) to service_role;

-- Retain the reviewed owner/account/comparison code; only add the bound human review.
CREATE OR REPLACE FUNCTION sma_private.publication_order_request_v1(p_action text, p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid();c public.sma_kunden%rowtype;j sma_private.publication_orders_v1%rowtype;
 f sma_private.publication_files_v1%rowtype;a sma_private.publication_assignments_v1%rowtype;r jsonb;b jsonb;ch jsonb;other_id uuid;v_id uuid;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('prepare','get','approve') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>8000
 or coalesce(p_input->>'id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('id','asset_id','asset_revision','platform','assignment_revision','preview_id','preview_revision','choices','approval_token','confirm','review')) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_action<>'approve' and p_input?'review' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid for share;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 v_id:=(p_input->>'id')::uuid;
 -- Serialize a customer's order creation and approvals, including distinct UUIDs.
 perform pg_advisory_xact_lock(741604,(c.id % 2147483647)::integer);
 select * into j from sma_private.publication_orders_v1 where id=v_id for update;
 if found and (j.user_id<>uid or j.customer_id<>c.id) then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
 if p_action='get' then
  if j.id is null then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
  return sma_private.publication_order_view_v1(j);
 end if;
 if p_action='approve' then
  if j.id is null then return jsonb_build_object('ok',false,'code','ORDER_UNAVAILABLE');end if;
  if p_input->'confirm' is distinct from 'true'::jsonb or p_input->>'approval_token' is distinct from j.approval_token::text then return jsonb_build_object('ok',false,'code','FINAL_APPROVAL_REQUIRED');end if;
  if sma_private.publication_order_review_valid_v1(p_input->'review',j.binding->>'platform',j.choices) is not true then return jsonb_build_object('ok',false,'code','FINAL_APPROVAL_REQUIRED');end if;
  if j.approved_at is not null then
   if j.approval_review is distinct from p_input->'review' then return jsonb_build_object('ok',false,'code','FINAL_APPROVAL_REQUIRED');end if;
   return sma_private.publication_order_view_v1(j);
  end if;
  if j.state<>'prepared' or j.target is null or j.created_at<now()-interval '30 minutes' then return jsonb_build_object('ok',false,'code','ORDER_NOT_PREPARED');end if;
  if j.binding->>'platform' in ('youtube','tiktok') and not sma_private.publication_account_valid_v1(j.account_check,j.target,j.choices) then return jsonb_build_object('ok',false,'code','TARGET_OPTIONS_CHANGED');end if;
  r:=sma_private.publication_order_current_v1(j);if r->'ok' is distinct from 'true'::jsonb then return r;end if;
  if p_input->'review'?'human_review' and (
   p_input#>>'{review,human_review,source_fingerprint}' is distinct from sma_private.publication_human_review_scope_v1(j)
   or sma_private.publication_human_review_available_v1(j,sma_private.publication_order_media_v1(j,r->'media_check',j.account_check)) is not true)
  then return jsonb_build_object('ok',false,'code','HUMAN_REVIEW_UNAVAILABLE');end if;
  insert into sma_private.publication_journal_v1(customer_id,asset_id,asset_revision,platform,target_id,order_id)
  values(c.id,(j.binding->>'asset_id')::uuid,j.binding->>'asset_revision',j.binding->>'platform',j.target->>'id',j.id) on conflict do nothing;
  select order_id into other_id from sma_private.publication_journal_v1 where customer_id=c.id and asset_id=(j.binding->>'asset_id')::uuid and asset_revision=j.binding->>'asset_revision' and platform=j.binding->>'platform' and target_id=j.target->>'id';
  if other_id is distinct from j.id then return jsonb_build_object('ok',false,'code','DUPLICATE_PUBLICATION','existing_order_id',other_id);end if;
  update sma_private.publication_orders_v1 set approved_at=now(),approval_review=p_input->'review',state='approved',updated_at=now() where id=j.id returning * into j;
  return sma_private.publication_order_view_v1(j);
 end if;
 if coalesce(p_input->>'asset_id','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or coalesce(p_input->>'platform','') not in ('youtube','instagram','facebook','tiktok') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 ch:=p_input->'choices';
 if jsonb_typeof(ch) is distinct from 'object' or coalesce(ch->>'visibility','') not in ('private','public','unlisted','SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR')
 or exists(select 1 from jsonb_object_keys(ch) k where k not in ('visibility','made_for_kids','contains_synthetic_media','disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle'))
 or exists(select 1 from jsonb_each(ch) e where e.key<>'visibility' and jsonb_typeof(e.value)<>'boolean') then return jsonb_build_object('ok',false,'code','INVALID_CHOICES');end if;
 if (p_input->>'platform'='youtube' and (ch->>'visibility' not in ('private','public','unlisted') or not(ch ?& array['made_for_kids','contains_synthetic_media'])))
 or (p_input->>'platform' in ('instagram','facebook') and ch->>'visibility'<>'public')
 or (p_input->>'platform'='tiktok' and (ch->>'visibility' not in ('SELF_ONLY','PUBLIC_TO_EVERYONE','MUTUAL_FOLLOW_FRIENDS','FOLLOWER_OF_CREATOR') or not(ch ?& array['disable_comment','disable_duet','disable_stitch','brand_content_toggle','brand_organic_toggle']))) then return jsonb_build_object('ok',false,'code','INVALID_CHOICES');end if;
 if j.id is not null then
  if exists(select 1 from jsonb_each(p_input - 'id' - 'choices') e where j.binding->e.key is distinct from e.value) or ch is distinct from j.choices then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');end if;
  return sma_private.publication_order_view_v1(j);
 end if;
 select * into f from sma_private.publication_files_v1 where id=(p_input->>'asset_id')::uuid and user_id=uid and customer_id=c.id for share;
 if not found or not f.available then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 select * into a from sma_private.publication_assignments_v1 where asset_id=f.id and platform=p_input->>'platform' for share;
 if not found then return jsonb_build_object('ok',false,'code','ASSIGNMENT_UNAVAILABLE');end if;
 if p_input->>'asset_revision' is distinct from f.revision or p_input->'assignment_revision' is distinct from to_jsonb(a.revision) or p_input->>'preview_id' is distinct from a.preview_id::text or p_input->'preview_revision' is distinct from to_jsonb(a.preview_revision) then return jsonb_build_object('ok',false,'code','ORDER_CHANGED');end if;
 if (select count(*) from sma_private.publication_orders_v1 where user_id=uid and created_at>now()-interval '1 hour')>=30 then return jsonb_build_object('ok',false,'code','ORDER_RATE_LIMITED');end if;
 r:=public.sma_publication_assignment_v1(c.id,f.drive_file_id,f.revision,a.platform);if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 b:=jsonb_build_object('version',1,'customer_id',c.id,'drive_file_id',f.drive_file_id,'asset_id',f.id,'asset_revision',f.revision,'platform',a.platform,'assignment_revision',a.revision,'preview_id',a.preview_id,'preview_revision',a.preview_revision,'shop_url',r->>'shop_url','media_kind',f.media_kind);
 j.user_id:=uid;j.customer_id:=c.id;j.binding:=b;j.draft:=a.draft;
 r:=sma_private.publication_order_current_v1(j);if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices) values(v_id,uid,c.id,b,a.draft,ch) returning * into j;
 return sma_private.publication_order_view_v1(j);
end $function$
;

CREATE OR REPLACE FUNCTION sma_private.publication_order_media_v1(j sma_private.publication_orders_v1, media jsonb, evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare checks jsonb; check_state text:='pending'; message text:='Erlaubte Videolänge, Sichtbarkeit und Interaktionen müssen am konkreten TikTok-Konto aktuell geprüft werden.'; duration_ms bigint; limit_ms bigint;
begin
 if j.binding->>'platform' is distinct from 'tiktok' or j.binding->>'media_kind' is distinct from 'video'
 or media->>'asset_id' is distinct from j.binding->>'asset_id' or media->>'asset_revision' is distinct from j.binding->>'asset_revision'
 or jsonb_typeof(media->'checks') is distinct from 'array' then return sma_private.publication_human_review_media_v1(j,sma_private.publication_comparison_media_v1(j.binding,j.draft,media));end if;
 if j.target->>'platform'='tiktok' and sma_private.publication_account_valid_v1(evidence,j.target,j.choices) is true then
  if jsonb_typeof(media#>'{facts,duration_ms}')='number' and (media#>>'{facts,duration_ms}')~'^[1-9][0-9]{0,12}$' then
   duration_ms:=(media#>>'{facts,duration_ms}')::bigint;
   limit_ms:=(evidence#>>'{policy,max_duration_sec}')::bigint*1000;
   check_state:=case when duration_ms<=limit_ms then 'pass' else 'fail' end;
   message:=case when check_state='pass' then 'Die gemeldete Videolänge sowie die gewählte Sichtbarkeit und Interaktionen passen zum aktuell geprüften TikTok-Zielkonto.' else 'Das Video überschreitet die für dieses TikTok-Zielkonto erlaubte Dauer.' end;
  else message:='Die Kontooptionen sind geprüft. Für den Vergleich mit der erlaubten Videolänge fehlt eine gültige Dauer.';end if;
 end if;
 select jsonb_agg(case when x->>'code'='TIKTOK_CREATOR_LIMIT' then x||jsonb_build_object('status',check_state,'message',message) else x end order by position)
 into checks from jsonb_array_elements(media->'checks') with ordinality as items(x,position);
 return sma_private.publication_human_review_media_v1(j,sma_private.publication_comparison_media_v1(j.binding,j.draft,media||jsonb_build_object('checks',coalesce(checks,'[]'::jsonb),'can_publish',false,
  'status',case when exists(select 1 from jsonb_array_elements(checks) x where x->>'status'='fail') then 'needs_changes' else 'needs_review' end)));
end $function$
;
CREATE OR REPLACE FUNCTION sma_private.publication_order_view_v1(j sma_private.publication_orders_v1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare current_result jsonb;media jsonb;
begin
 current_result:=sma_private.publication_order_current_v1(j);
 if current_result->'ok'='true'::jsonb then media:=sma_private.publication_order_media_v1(j,current_result->'media_check',j.account_check);end if;
 return jsonb_build_object('ok',true,'id',j.id,'state',j.state,'binding',j.binding - 'customer_id' - 'drive_file_id',
 'draft',j.draft,'choices',j.choices,'target',j.target - 'source_revision','approval_token',case when j.state='prepared' then j.approval_token else null end,
 'human_review_option',case when j.state='prepared' and sma_private.publication_human_review_available_v1(j,media) then jsonb_build_object('policy_version','human-video-2026-11-06.1','source_fingerprint',sma_private.publication_human_review_scope_v1(j)) end,
 'approval_policy','media-consent-2026-11-03.1','approval_review',j.approval_review,'media_check',media,
 'check_error',case when current_result->'ok' is distinct from 'true'::jsonb then current_result->>'code' end,
 'account_check',j.account_check - 'target_revision','approved_at',j.approved_at,'blockers',j.blockers,'can_upload',false,'can_publish',false);
end;
$function$
;
