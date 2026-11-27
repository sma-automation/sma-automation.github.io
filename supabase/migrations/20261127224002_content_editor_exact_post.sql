-- Per-assignment working notes. Generated evidence stays attached to its original preview.
alter table sma_private.publication_assignments_v1 add column editor_note jsonb;
do $migration$
declare def text:=pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
 needle text:='''input'',j.input,''link_product''';
begin
 if array_length(string_to_array(def,needle),1)<>2 then raise exception 'EDITOR_READ_CONTRACT_CHANGED';end if;
 execute replace(def,needle,'''input'',case when b.editor_note->>''preview_id''=j.id::text and b.editor_note->>''asset_revision''=f.revision then j.input||jsonb_build_object(''editor_source_text'',b.editor_note->>''source'') else j.input end,''link_product''');
end $migration$;

create function sma_private.content_editor_v1(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); f sma_private.publication_files_v1%rowtype; c public.sma_kunden%rowtype;
 a sma_private.publication_assignments_v1%rowtype; o sma_private.publication_orders_v1%rowtype;
 portal text:=p_input->>'platform'; note text:=p_input->>'source_text'; lang text:=p_input->>'language';
 req uuid:=(p_input->>'request_id')::uuid; draft_id uuid; shop text; skeleton jsonb; seed jsonb;
 r jsonb; bound jsonb; submitted jsonb; edit jsonb; backend_code text;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_action is null or p_action not in ('save','send') or jsonb_typeof(p_input) is distinct from 'object'
 or octet_length(p_input::text)>45000 or req is null or portal is null or portal not in ('youtube','tiktok','facebook','instagram') then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select k.* into strict c from public.sma_kunden k where k.user_id=uid and k.aktiv and (k.demo_delta_aktiv or k.zahlung_bestaetigt);
 if p_action='send' then perform pg_advisory_xact_lock(c.id);end if;
 select v.* into f from sma_private.publication_files_v1 v where v.id=(p_input->>'asset_id')::uuid and v.available and v.user_id=uid and v.customer_id=c.id for update;
 if not found or f.revision is distinct from p_input->>'asset_revision' or not exists(select from sma_private.publication_rotation_sources_v1 s
  join sma_private.publication_portal_content_v1 m on m.source_id=s.id and m.platform=portal and m.digest=split_part(f.revision,':',2)
  where s.owner_id=uid and s.customer_id=c.id) then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 select v.* into a from sma_private.publication_assignments_v1 v where v.asset_id=f.id and v.platform=portal for update;
 bound:=jsonb_build_object('asset_id',f.id,'asset_revision',f.revision,'platform',portal,'assignment_revision',coalesce(a.revision,0));
 if p_action='save' and a.editor_note->>'request_id'=req::text and a.editor_note->'receipt_revision'=to_jsonb(a.revision)
  and a.editor_note->>'preview_id'=a.preview_id::text and a.asset_revision=f.revision then
  if a.editor_note->>'input_hash' is distinct from md5(p_input::text) then return jsonb_build_object('ok',false,'code','REQUEST_CONFLICT');end if;
  return public.sma_publication_files_v1('get',bound);end if;
 if bound->'assignment_revision' is distinct from p_input->'assignment_revision' then return jsonb_build_object('ok',false,'code','ASSIGNMENT_CONFLICT');end if;
 if a.asset_id is not null and (a.asset_revision<>f.revision or to_jsonb(a.preview_id) is distinct from p_input->'preview_id' or to_jsonb(a.preview_revision) is distinct from p_input->'preview_revision') then
  return jsonb_build_object('ok',false,'code','REVISION_CONFLICT');end if;
 if p_action='send' then
  if a.asset_id is null then return jsonb_build_object('ok',false,'code','ASSIGNMENT_UNAVAILABLE');end if;
  r:=public.sma_manual_portal_v1('read',portal,f.id,f.revision);
  if r->'ok' is distinct from 'true'::jsonb or r->>'order' is null then return r;end if;
  select * into o from sma_private.publication_orders_v1 where id=(r->>'order')::uuid and user_id=uid and customer_id=c.id for update;
  if not found or (p_input?'order' and o.id::text is distinct from p_input->>'order')
    or not (o.binding @> (bound||jsonb_build_object('preview_id',a.preview_id,'preview_revision',a.preview_revision)))
    or o.draft->'caption' is distinct from a.draft->'caption' or o.draft->'title' is distinct from a.draft->'title' then
   return jsonb_build_object('ok',true,'state','approval_required');end if;
  return public.sma_manual_portal_v1('send',portal,f.id,f.revision,o.id,req);
 end if;
 if note is null or char_length(note)>8000 or lang is null or lang not in ('de','en') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 edit:=jsonb_build_object('platform',portal,'title',p_input->'title','body',p_input->'body','hashtags',p_input->'hashtags');
 if a.asset_id is null then
  if nullif(btrim(p_input->>'body'),'') is null or length(p_input->>'body') not between 10 and 1200 then return jsonb_build_object('ok',false,'code','INVALID_EDIT');end if;
  if c.shop_oeffentlich is not true or c.shop_slug is null or c.shop_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then return jsonb_build_object('ok',false,'code','PUBLIC_SHOP_REQUIRED');end if;
  shop:='https://sma-automation.com/app/shop.html?shop='||c.shop_slug;draft_id:=gen_random_uuid();
  seed:=jsonb_build_object('request_id',draft_id,'source_text',note,'language',lang,'media_kind',f.media_kind,'platforms',jsonb_build_array(portal));
  skeleton:=jsonb_build_object('version',1,'stage','text_preview','language',lang,'media_kind',f.media_kind,'shop_url',shop,'can_publish',false,
   'checks',jsonb_build_object('facts','needs_review','media','not_checked','disclosures','not_checked','profile_link','not_checked','text_structure','verified','shop_assignment','verified','platform_account','not_checked','affiliate_attribution','not_checked'),
   'drafts',jsonb_build_array(edit||jsonb_build_object('review_notes','[]'::jsonb)));
  insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,finished_at,preview)
   values(draft_id,uid,c.id,seed,shop,'completed',now(),skeleton);
  -- Builds the canonical caption and enforces the same editorial constraints as an edited generated draft.
  r:=sma_private.publication_preview_request_v1('save',jsonb_build_object('revision',1,'drafts',jsonb_build_array(edit)),draft_id);
  if r->'ok'='true'::jsonb then
   r:=public.sma_publication_files_v1('assign',bound||jsonb_build_object('preview_id',draft_id,'preview_revision',r->'revision'));
  end if;
 else
  submitted:=bound||edit;
  if p_input?'link_target' then submitted:=submitted||jsonb_build_object('link_target',p_input->'link_target');end if;
  r:=public.sma_publication_files_v1('save',submitted);
 end if;
 if r->'ok' is distinct from 'true'::jsonb then
  backend_code:=coalesce(r->>'code','INVALID_EDIT');raise exception using errcode='SM340',message=backend_code;
 end if;
 update sma_private.publication_assignments_v1 set editor_note=jsonb_build_object('source',note,'asset_revision',f.revision,
  'preview_id',r->'id','request_id',req,'input_hash',md5(p_input::text),'receipt_revision',r->'assignment_revision')
 where asset_id=f.id and platform=portal;
 return public.sma_publication_files_v1('get',bound);
exception when sqlstate 'SM340' then return jsonb_build_object('ok',false,'code',sqlerrm);
 when check_violation then return jsonb_build_object('ok',false,'code',case when sqlerrm='CAPTION_TOO_SIMILAR' then sqlerrm else 'INVALID_EDIT' end);
 when invalid_text_representation then return jsonb_build_object('ok',false,'code','INVALID_INPUT');
 when no_data_found or too_many_rows then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');
end $$;
create function public.sma_content_editor_v1(p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$select sma_private.content_editor_v1(p_action,p_input)$$;
revoke all on function public.sma_content_editor_v1(text,jsonb),sma_private.content_editor_v1(text,jsonb) from public,anon;
grant execute on function public.sma_content_editor_v1(text,jsonb),sma_private.content_editor_v1(text,jsonb) to authenticated;
notify pgrst,'reload schema';
-- The existing portal upload ledger also serves image-capable portals.
do $migration$
declare def text:=pg_get_functiondef('sma_private.publication_upload_portal_v1(uuid,text)'::regprocedure);
 needle text:='and u.mime_type like ''video/%''';
begin
 if array_length(string_to_array(def,needle),1)<>2 then raise exception 'UPLOAD_BINDING_CONTRACT_CHANGED';end if;
 execute replace(def,needle,'and (u.mime_type like ''video/%'' or (p_platform in (''instagram'',''facebook'') and u.mime_type like ''image/%''))');
end $migration$;

create or replace function public.sma_portal_gallery_v1(p_platform text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.sma_publication_files_v1('list',jsonb_build_object('platform',p_platform))
 || jsonb_build_object('folder_version',(f->>'folder')||'/'||(f->>'verified_at'),'folder',f->>'folder','drive_account',f->>'drive_account')
 from (select public.sma_manual_portal_v1('folder',p_platform) f) state
 where p_platform in ('youtube','tiktok','instagram','facebook')
$$;
