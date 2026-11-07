-- Bind the reviewed wording to a decoded export. Existing model comparisons retain their path.
do $$begin
 if (select count(*) from pg_proc where
 (oid='public.sma_publication_comparison_context_v1(jsonb)'::regprocedure and md5(prosrc)='bf5e1caf0088129f96243f63c469c681') or
 (oid='public.sma_publication_comparison_v1(text,jsonb,uuid,jsonb)'::regprocedure and md5(prosrc)='d610667e56b69c8186e9359701a02adf') or
 (oid='sma_private.publication_comparison_media_v1(jsonb,jsonb,jsonb)'::regprocedure and md5(prosrc)='cace30b91d204b8d8133f03a2fefb789'))<>3
 then raise exception 'EXPORT_REFERENCE_BASELINE_CHANGED'; end if;
end $$;

create function sma_private.publication_export_reference_v1(f sma_private.publication_files_v1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare probe jsonb; reference jsonb; observations jsonb; refdraft jsonb;
begin
 if sma_private.publication_export_technical_v1(f) is null then return null; end if;
 select e.local_probe into probe from sma_private.publication_editor_exports_v1 e
 where e.media_asset_id=f.id and e.user_id=f.user_id and e.customer_id=f.customer_id
  and e.local_probe->>'asset_revision'=f.revision and e.completed_at is not null
 order by e.completed_at desc,e.id desc limit 1;
 reference:=probe->'text_reference';
 observations:=probe->'content_observations';
 if jsonb_typeof(reference) is distinct from 'object' or jsonb_typeof(observations) is distinct from 'object'
  or observations->>'source' is distinct from 'assisted_viewing'
  or jsonb_typeof(observations->'visual') is distinct from 'string' or length(trim(observations->>'visual'))<10
  or observations->'frames_viewed' is distinct from probe#>'{technical,decoded_frames}'
  or reference->>'source' is distinct from 'reviewed_export_reference_v1'
  or reference->>'asset_revision' is distinct from f.revision
  or reference->>'evidence_hash' is distinct from encode(sha256(convert_to((probe-'text_reference')::text,'UTF8')),'hex')
  or jsonb_typeof(reference->'draft') is distinct from 'object' then return null; end if;
 refdraft:=reference->'draft';
 if not(refdraft ?& array['title','body','hashtags','caption','review_notes'])
  or (select count(*) from jsonb_object_keys(refdraft))<>5
  or jsonb_typeof(refdraft->'title') is distinct from 'string' or length(trim(refdraft->>'title')) not between 1 and 80
  or jsonb_typeof(refdraft->'body') is distinct from 'string' or length(trim(refdraft->>'body')) not between 10 and 1200
  or jsonb_typeof(refdraft->'caption') is distinct from 'string' or length(trim(refdraft->>'caption')) not between 10 and 5000
  or jsonb_typeof(refdraft->'hashtags') is distinct from 'array'
  or refdraft->'review_notes' is distinct from '[]'::jsonb then return null; end if;
 return reference;
end $$;
revoke all on function sma_private.publication_export_reference_v1(sma_private.publication_files_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_export_reference_v1(sma_private.publication_files_v1) to service_role;

CREATE OR REPLACE FUNCTION public.sma_publication_comparison_context_v1(p_binding jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b jsonb:=p_binding;r jsonb;f sma_private.publication_files_v1%rowtype;a jsonb;c public.sma_kunden%rowtype;k text;fingerprint text;
begin
 if jsonb_typeof(b) is distinct from 'object' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if octet_length(b::text)>3000 or b->'version' is distinct from '1'::jsonb
 or coalesce(b->>'platform','') not in ('youtube','tiktok') or b->>'media_kind' is distinct from 'video'
 or (select array_agg(key order by key) from jsonb_object_keys(b) key) is distinct from array['asset_id','asset_revision','assignment_revision','customer_id','drive_file_id','media_kind','platform','preview_id','preview_revision','shop_url','version']
 or jsonb_typeof(b->'customer_id') is distinct from 'number' or coalesce(b->>'customer_id','')!~'^[1-9][0-9]{0,14}$'
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into c from public.sma_kunden where id=(b->>'customer_id')::bigint and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
 if not found then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 r:=public.sma_publication_assignment_v1(c.id,b->>'drive_file_id',b->>'asset_revision',b->>'platform');
 if r->'ok' is distinct from 'true'::jsonb then return r;end if;
 foreach k in array array['asset_id','asset_revision','platform','assignment_revision','preview_id','preview_revision','shop_url','media_kind'] loop
  if r->k is distinct from b->k then return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED');end if;
 end loop;
 select * into f from sma_private.publication_files_v1 where id=(r->>'asset_id')::uuid and customer_id=c.id and user_id=c.user_id and available;
 if not found or f.verified_at is null or f.verified_at<=now()-interval '15 minutes' or f.verified_at>now()+interval '1 minute' then return jsonb_build_object('ok',false,'code','FILE_REFRESH_REQUIRED');end if;
 a:=sma_private.publication_video_magic_summary_v1(f);
 if a->>'status'='unrecognized' then
  a:=sma_private.publication_export_reference_v1(f);
  if a is not null then
   fingerprint:=encode(sha256(convert_to(jsonb_build_object(
    'method','reviewed_export_reference_v1','owner',c.user_id,'binding',b,
    'draft',r->'text','reference',a)::text,'UTF8')),'hex');
   return jsonb_build_object('ok',true,'policy_version','portal-content-2026-11-03.1',
    'method','reviewed_export_reference_v1','source_fingerprint',fingerprint,
    'binding',b,'draft',r->'text','reference',a,'user_id',c.user_id,'can_upload',false,'can_publish',false);
  end if;
 end if;
 if a->>'status' is distinct from 'completed' or sma_private.publication_video_technical_v1(f) is null then return jsonb_build_object('ok',false,'code','VIDEO_EVIDENCE_REQUIRED');end if;
 a:=a->'result';
 if a#>>'{evidence,source_sha256}' is distinct from split_part(f.revision,':',2) or a#>'{evidence,source_size_bytes}' is distinct from to_jsonb(f.size_bytes) then return jsonb_build_object('ok',false,'code','VIDEO_EVIDENCE_REQUIRED');end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('policy','portal-content-2026-11-03.1','owner',c.user_id,'binding',b,'draft',r->'text','analysis',a)::text,'UTF8')),'hex');
 return jsonb_build_object('ok',true,'policy_version','portal-content-2026-11-03.1','source_fingerprint',fingerprint,'binding',b,'draft',r->'text','analysis',a,'user_id',c.user_id,'can_upload',false,'can_publish',false);
end $function$;

CREATE OR REPLACE FUNCTION public.sma_publication_comparison_v1(p_action text, p_binding jsonb, p_lease uuid DEFAULT NULL::uuid, p_result jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c jsonb;j sma_private.publication_comparisons_v1%rowtype;uid uuid;issue jsonb;
begin
 if p_action is null or p_action not in ('get','start','finish','fail') then return jsonb_build_object('ok',false,'code','INVALID_ACTION');end if;
 c:=public.sma_publication_comparison_context_v1(p_binding);
 if c->'ok' is distinct from 'true'::jsonb then return c;end if;
 uid:=(c->>'user_id')::uuid;
 -- Serialize per-owner reservations, including simultaneous requests for two portals.
 perform pg_advisory_xact_lock(hashtextextended('publication-comparison:'||uid::text,0));
 select * into j from sma_private.publication_comparisons_v1 where source_fingerprint=c->>'source_fingerprint' for update;
 if p_action='get' then
  return jsonb_build_object('ok',true,'state',case when j.state='processing' and j.lease_until<=now() then 'failed' else coalesce(j.state,'unreviewed') end,'result',case when j.state='completed' then j.result end,'can_upload',false,'can_publish',false);
 elsif p_action='start' then
  if j.state='completed' then return jsonb_build_object('ok',true,'state','completed','result',j.result,'can_upload',false,'can_publish',false);end if;
  if j.source_fingerprint is not null then return jsonb_build_object('ok',false,'code','COMPARISON_ALREADY_ATTEMPTED','can_upload',false,'can_publish',false);end if;
  if (select count(*) from sma_private.publication_comparisons_v1 where user_id=uid and started_at>now()-interval '1 hour')>=6 then return jsonb_build_object('ok',false,'code','COMPARISON_RATE_LIMITED');end if;
  if c->>'method'='reviewed_export_reference_v1' then
   -- The independent reference has the same six fields as the saved draft.
   -- Compare every field, including the final caption with its shop link.
   p_result:=jsonb_build_object('policy_version',c->>'policy_version',
    'scope','reviewed_export_reference_v1','source_fingerprint',c->>'source_fingerprint',
    'verdict',case when c->'draft'=((c->'reference'->'draft')||jsonb_build_object('platform',p_binding->>'platform'))
     then 'consistent_with_evidence' else 'insufficient_evidence' end,
    'issues','[]'::jsonb,'can_upload',false,'can_publish',false);
   insert into sma_private.publication_comparisons_v1
    (source_fingerprint,user_id,customer_id,binding,policy_version,state,result,finished_at)
   values(c->>'source_fingerprint',uid,(p_binding->>'customer_id')::bigint,p_binding,
    c->>'policy_version','completed',p_result,now());
   return jsonb_build_object('ok',true,'state','completed','result',p_result,'can_upload',false,'can_publish',false);
  end if;
  insert into sma_private.publication_comparisons_v1(source_fingerprint,user_id,customer_id,binding,policy_version,state,lease_id,lease_until)
  values(c->>'source_fingerprint',uid,(p_binding->>'customer_id')::bigint,p_binding,c->>'policy_version','processing',gen_random_uuid(),now()+interval '4 minutes') returning * into j;
  return c||jsonb_build_object('state','processing','lease_id',j.lease_id);
 end if;
 if j.state is distinct from 'processing' or p_lease is null or j.lease_id is distinct from p_lease or j.lease_until<=now() then return jsonb_build_object('ok',false,'code','INVALID_LEASE');end if;
 if p_action='fail' then
  update sma_private.publication_comparisons_v1 set state='failed',lease_id=null,lease_until=null,finished_at=now() where source_fingerprint=j.source_fingerprint;
  return jsonb_build_object('ok',false,'code','CONTENT_COMPARISON_UNAVAILABLE','can_upload',false,'can_publish',false);
 end if;
 if jsonb_typeof(p_result) is distinct from 'object' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 if octet_length(p_result::text)>16000
 or (select array_agg(key order by key) from jsonb_object_keys(p_result) key) is distinct from array['can_publish','can_upload','issues','policy_version','scope','source_fingerprint','verdict']
 or p_result->>'policy_version' is distinct from j.policy_version or p_result->>'source_fingerprint' is distinct from j.source_fingerprint
 or p_result->>'scope' is distinct from 'stored_video_observations_ocr_transcript'
 or p_result->'can_upload' is distinct from 'false'::jsonb or p_result->'can_publish' is distinct from 'false'::jsonb
 or coalesce(p_result->>'verdict','') not in ('consistent_with_evidence','needs_review','insufficient_evidence')
 or jsonb_typeof(p_result->'issues') is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 if jsonb_array_length(p_result->'issues')>8 or (p_result->>'verdict'='consistent_with_evidence' and jsonb_array_length(p_result->'issues')<>0) or (p_result->>'verdict'='needs_review' and jsonb_array_length(p_result->'issues')=0) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 for issue in select value from jsonb_array_elements(p_result->'issues') loop
  if jsonb_typeof(issue) is distinct from 'object' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  if (select array_agg(key order by key) from jsonb_object_keys(issue) key) is distinct from array['field','quote','reason']
  or coalesce(issue->>'field','') not in ('title','caption') or jsonb_typeof(issue->'quote') is distinct from 'string' or jsonb_typeof(issue->'reason') is distinct from 'string'
  or char_length(issue->>'quote') not between 1 and 400 or char_length(issue->>'reason') not between 1 and 400
  or position(issue->>'quote' in (c->'draft'->>(issue->>'field')))=0 then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_result->'issues') i, lateral regexp_split_to_table((i->>'quote')||(i->>'reason'),'') u(ch) where ascii(u.ch) between 0 and 8 or ascii(u.ch) in (11,12,127) or ascii(u.ch) between 14 and 31 or ascii(u.ch) between 8234 and 8238 or ascii(u.ch) between 8294 and 8297) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 update sma_private.publication_comparisons_v1 set state='completed',result=p_result,lease_id=null,lease_until=null,finished_at=now() where source_fingerprint=j.source_fingerprint;
 return jsonb_build_object('ok',true,'state','completed','result',p_result,'can_upload',false,'can_publish',false);
end $function$;

CREATE OR REPLACE FUNCTION sma_private.publication_comparison_media_v1(b jsonb, draft jsonb, media jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare c jsonb;r jsonb;message text;details text;
begin
 if b->>'platform' not in ('youtube','tiktok') or b->>'media_kind' is distinct from 'video'
 or media->>'asset_id' is distinct from b->>'asset_id' or media->>'asset_revision' is distinct from b->>'asset_revision'
 or jsonb_typeof(media->'checks') is distinct from 'array' then return media;end if;
 c:=public.sma_publication_comparison_context_v1(b);
 if c->'ok' is distinct from 'true'::jsonb or c->'draft' is distinct from draft then return media;end if;
 select result into r from sma_private.publication_comparisons_v1
 where source_fingerprint=c->>'source_fingerprint' and user_id=(c->>'user_id')::uuid and state='completed';
 if r is null then return media;end if;
 message:=case r->>'verdict'
  when 'consistent_with_evidence' then 'Der gespeicherte Beitrag passt zu den gespeicherten Video-Beobachtungen, Bildtexten und gegebenenfalls dem Transkript.'
  when 'needs_review' then 'Der gespeicherte Beitrag enthält Angaben, die anhand der gespeicherten Video-Beobachtungen noch bestätigt werden müssen.'
  else 'Die gespeicherten Video-Beobachtungen reichen für einen verlässlichen Abgleich des Beitrags nicht aus.' end;
 if r->>'scope'='reviewed_export_reference_v1' then
  message:=case when r->>'verdict'='consistent_with_evidence'
   then 'Titel und vollständiger Beitrag entsprechen dem am Export geprüften Referenztext.'
   else 'Der gespeicherte Beitrag weicht vom geprüften Referenztext ab. Bitte den geänderten Inhalt erneut prüfen.' end;
 end if;
 select string_agg((i->>'quote')||': '||(i->>'reason'),' ' order by n) into details
 from jsonb_array_elements(r->'issues') with ordinality as items(i,n);
 message:=message||' '||coalesce(details||' ','')||'Dies ist keine vollständige Video-, Sicherheits- oder Rechteprüfung.';
 return media||jsonb_build_object('checks',(select coalesce(jsonb_agg(x order by n),'[]'::jsonb)
   from jsonb_array_elements(media->'checks') with ordinality as items(x,n) where x->>'code' is distinct from 'PORTAL_TEXT_COMPARISON')
  ||jsonb_build_array(jsonb_build_object('code','PORTAL_TEXT_COMPARISON','status',case when r->>'verdict'='consistent_with_evidence' then 'pass' else 'pending' end,'message',message)),
  'can_publish',false);
end $function$;
