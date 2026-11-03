-- Additive video Magic Effect. Photo behavior and existing customer data are unchanged.
-- Uses the existing private cache/rate tables; no new table grants or public media.
create or replace function sma_private.publication_video_magic_summary_v1(f sma_private.publication_files_v1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r sma_private.publication_magic_results_v1%rowtype; c public.sma_kunden%rowtype; s text:='unrecognized';
begin
 select * into c from public.sma_kunden where id=f.customer_id and user_id=f.user_id and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
 if found and f.available then
  select * into r from sma_private.publication_magic_results_v1 where asset_id=f.id and asset_revision=f.revision and policy_version='magic-video-2026-11-03.1' and user_id=f.user_id and customer_id=f.customer_id and n8n_kunde_id=c.n8n_kunde_id and kunde_email=c.kunde_email;
  if found then s:=case when r.status='processing' and (r.lease_until is null or r.lease_until<=now()) then 'failed' else r.status end;end if;
 end if;
 return jsonb_build_object('asset_id',f.id,'asset_revision',f.revision,'policy_version','magic-video-2026-11-03.1','status',s,'can_publish',false,'result',case when s='completed' then r.result end,'finished_at',r.finished_at,'error_code',case when s='failed' then coalesce(r.error_code,'MAGIC_TIMEOUT') end);
end $$;
revoke all on function sma_private.publication_video_magic_summary_v1(sma_private.publication_files_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_video_magic_summary_v1(sma_private.publication_files_v1) to service_role;

create or replace function sma_private.publication_video_magic_request_v1(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.sma_kunden%rowtype; f sma_private.publication_files_v1%rowtype;
 r sma_private.publication_magic_results_v1%rowtype; rate sma_private.publication_magic_rate_v1%rowtype; summary jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED'); end if;
 if p_action is null or p_action not in ('get','start') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>2000 or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('asset_id','asset_revision')) or coalesce(p_input->>'asset_id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if p_action='start' then
  insert into sma_private.publication_magic_rate_v1(user_id) values(uid) on conflict do nothing;
  select * into rate from sma_private.publication_magic_rate_v1 where user_id=uid for update;
 end if;
 select * into f from sma_private.publication_files_v1 where id=(p_input->>'asset_id')::uuid and user_id=uid and customer_id=c.id for update;
 if not found or not f.available then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 if f.revision is distinct from p_input->>'asset_revision' then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
 summary:=sma_private.publication_video_magic_summary_v1(f);
 if p_action='get' or summary->>'status' in ('completed','processing') then return jsonb_build_object('ok',true,'analysis',summary);end if;
 if f.verified_at is null or f.verified_at<now()-interval '15 minutes' then return jsonb_build_object('ok',false,'code','FILE_REFRESH_REQUIRED');end if;
 if c.n8n_kunde_id is null or c.kunde_email is null then return jsonb_build_object('ok',false,'code','FOLDER_UNAVAILABLE');end if;
 if f.media_kind is distinct from 'video' then return jsonb_build_object('ok',false,'code','VIDEO_UNSUPPORTED');end if;
 if f.revision!~'^sha256:[a-f0-9]{64}:[0-9]+$' then return jsonb_build_object('ok',false,'code','CHECKSUM_REQUIRED');end if;
 if f.size_bytes is null or f.size_bytes<=0 or f.size_bytes>24000000 or f.mime_type is distinct from 'video/mp4' or f.duration_ms is null or f.duration_ms<=0 or f.duration_ms>60000 then return jsonb_build_object('ok',false,'code','VIDEO_UNSUPPORTED');end if;
 if exists(select 1 from sma_private.publication_magic_results_v1 where user_id=uid and status='processing' and lease_until>now()) then return jsonb_build_object('ok',false,'code','MAGIC_RUNNING');end if;
 if rate.last_started>now()-interval '30 seconds' or (rate.window_started>now()-interval '1 hour' and rate.attempts>=6) then return jsonb_build_object('ok',false,'code','MAGIC_RATE_LIMITED');end if;
 update sma_private.publication_magic_rate_v1 set attempts=case when window_started<=now()-interval '1 hour' then 1 else attempts+1 end,window_started=case when window_started<=now()-interval '1 hour' then now() else window_started end,last_started=now() where user_id=uid;
 insert into sma_private.publication_magic_results_v1(asset_id,asset_revision,policy_version,user_id,customer_id,n8n_kunde_id,kunde_email,status,lease_id,lease_until)
 values(f.id,f.revision,'magic-video-2026-11-03.1',uid,c.id,c.n8n_kunde_id,c.kunde_email,'processing',gen_random_uuid(),now()+interval '12 minutes')
 on conflict(asset_id,asset_revision,policy_version) do update set user_id=excluded.user_id,customer_id=excluded.customer_id,n8n_kunde_id=excluded.n8n_kunde_id,kunde_email=excluded.kunde_email,status='processing',result=null,error_code=null,lease_id=excluded.lease_id,lease_until=excluded.lease_until,started_at=now(),finished_at=null,content_sha256=null returning * into r;
 return jsonb_build_object('ok',true,'analysis',sma_private.publication_video_magic_summary_v1(f),'lease_id',r.lease_id,'user_id',uid,'customer_id',c.id,'n8n_kunde_id',c.n8n_kunde_id,'kunde_email',c.kunde_email,'asset_id',f.id,'asset_revision',f.revision,'drive_file_id',f.drive_file_id,'media_kind',f.media_kind,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'duration_ms',f.duration_ms);
end $$;
revoke all on function sma_private.publication_video_magic_request_v1(text,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_video_magic_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_publication_video_magic_v1(p_action text,p_input jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_video_magic_request_v1(p_action,p_input);$$;
revoke all on function public.sma_publication_video_magic_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_video_magic_v1(text,jsonb) to authenticated;

create or replace function public.sma_publication_video_magic_finish_v1(p_asset_id uuid,p_lease_id uuid,p_result jsonb default null,p_sha256 text default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f sma_private.publication_files_v1%rowtype; r sma_private.publication_magic_results_v1%rowtype; c public.sma_kunden%rowtype;
 err text; field text; val jsonb; source_text text; count_limit integer; text_limit integer; e jsonb; position_ms bigint; previous_ms bigint:=-1;
begin
 select * into f from sma_private.publication_files_v1 where id=p_asset_id for update;
 select * into r from sma_private.publication_magic_results_v1 where asset_id=p_asset_id and lease_id=p_lease_id and policy_version='magic-video-2026-11-03.1' for update;
 if not found or p_lease_id is null or r.status<>'processing' or r.lease_until is null or r.lease_until<=now() then return jsonb_build_object('ok',false,'code','INVALID_LEASE');end if;
 select * into c from public.sma_kunden where id=r.customer_id and user_id=r.user_id;
 if not found or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) or c.n8n_kunde_id is distinct from r.n8n_kunde_id or c.kunde_email is distinct from r.kunde_email then err:='ACCESS_INACTIVE';
 elsif f.id is null or not f.available or f.revision is distinct from r.asset_revision or f.user_id is distinct from r.user_id or f.customer_id is distinct from r.customer_id or f.media_kind is distinct from 'video' then err:='FILE_CHANGED';
 elsif p_error is not null then err:=case when p_error in ('FOLDER_UNAVAILABLE','FILE_CHANGED','CHECKSUM_REQUIRED','VIDEO_UNSUPPORTED','TRANSCRIPT_INVALID','VIDEO_RECOGNITION_INVALID','VIDEO_RECOGNITION_FAILED','VIDEO_EVIDENCE_INVALID','VIDEO_EXTRACTION_UNVERIFIED','VIDEO_CLEANUP_UNVERIFIED') then p_error else 'MAGIC_UNAVAILABLE' end;
 end if;
 if err is not null then
  update sma_private.publication_magic_results_v1 set status='failed',error_code=err,result=null,lease_id=null,lease_until=null,finished_at=now() where asset_id=r.asset_id and asset_revision=r.asset_revision and policy_version=r.policy_version;
  return jsonb_build_object('ok',false,'code',err);
 end if;
 if coalesce(p_sha256,'')!~'^[a-f0-9]{64}$' or split_part(f.revision,':',2)<>p_sha256
 or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>160000
 or p_result->>'policy_version' is distinct from r.policy_version or p_result->'can_publish' is distinct from 'false'::jsonb
 or p_result->'requires_confirmation' is distinct from 'true'::jsonb
 or p_result->>'content_comparison' is distinct from 'model_checked_sampled_evidence'
 or coalesce(p_result->>'subject_type','') not in ('product','food','place','service_scene','document','other','unclear')
 or jsonb_typeof(p_result->'description') is distinct from 'string' or char_length(btrim(p_result->>'description')) not between 20 and 1000
 or jsonb_typeof(p_result->'spoken_summary') is distinct from 'string' or char_length(p_result->>'spoken_summary')>1200
 or jsonb_typeof(p_result->'transcript') is distinct from 'string' or char_length(p_result->>'transcript')>20000
 or coalesce(p_result->>'audio_status','') not in ('transcribed','no_audio_stream','no_speech_recognized')
 or exists(select 1 from jsonb_object_keys(p_result) k where k not in ('policy_version','subject_type','description','observations','visible_text','uncertainties','spoken_summary','transcript','audio_status','evidence','content_comparison','requires_confirmation','can_publish'))
 then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 if (p_result->>'audio_status'='transcribed' and (btrim(p_result->>'transcript')='' or btrim(p_result->>'spoken_summary')=''))
 or (p_result->>'audio_status'<>'transcribed' and (p_result->>'transcript'<>'' or p_result->>'spoken_summary'<>'')) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 foreach field in array array['observations','visible_text','uncertainties'] loop
  count_limit:=case field when 'observations' then 8 when 'visible_text' then 12 else 5 end;
  text_limit:=case field when 'visible_text' then 160 else 180 end;
  if jsonb_typeof(p_result->field) is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  if jsonb_array_length(p_result->field)>count_limit then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  for val in select value from jsonb_array_elements(p_result->field) loop
   if jsonb_typeof(val) is distinct from 'string' or char_length(btrim(val#>>'{}')) not between 1 and text_limit then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  end loop;
 end loop;
 if p_result->>'subject_type'='unclear' and jsonb_array_length(p_result->'uncertainties')=0 then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 e:=p_result->'evidence';
 if jsonb_typeof(e) is distinct from 'object' or e->>'source_sha256' is distinct from p_sha256
 or e->'source_size_bytes' is distinct from to_jsonb(f.size_bytes) or e->>'sampling' is distinct from 'representative_frames_not_full_moderation'
 or jsonb_typeof(e->'duration_ms') is distinct from 'number' or coalesce(e->>'duration_ms','')!~'^[0-9]{1,5}$'
 or jsonb_typeof(e->'positions_ms') is distinct from 'array' or jsonb_typeof(e->'frame_sha256') is distinct from 'array'
 or exists(select 1 from jsonb_object_keys(e) k where k not in ('source_sha256','source_size_bytes','duration_ms','positions_ms','frame_sha256','sampling','technical'))
 or not sma_private.publication_video_technical_valid_v1(e->'technical',p_result->>'audio_status')
 then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 if (e->>'duration_ms')::bigint not between 1 and 60000 or abs((e->>'duration_ms')::bigint-f.duration_ms)>1000
 or jsonb_array_length(e->'positions_ms') not between 2 and 21 or jsonb_array_length(e->'positions_ms')<>jsonb_array_length(e->'frame_sha256')
 or e->'positions_ms'->0 is distinct from '0'::jsonb then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 for val in select value from jsonb_array_elements(e->'positions_ms') loop
  if jsonb_typeof(val) is distinct from 'number' or val::text!~'^[0-9]{1,5}$' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  position_ms:=val::text::bigint;
  if position_ms<=previous_ms or position_ms>=(e->>'duration_ms')::bigint then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
  previous_ms:=position_ms;
 end loop;
 if (e->>'duration_ms')::bigint-previous_ms>200 then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 for val in select value from jsonb_array_elements(e->'frame_sha256') loop
  if jsonb_typeof(val) is distinct from 'string' or (val#>>'{}')!~'^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 end loop;
 source_text:=concat_ws(E'\n\n','Automatische Videoerkennung – anhand ausgewählter Einzelbilder und verfügbarer Tonspur:',p_result->>'description',
  (select 'Sichtbarer Ablauf: '||string_agg(v,E'; ' order by n) from jsonb_array_elements_text(p_result->'observations') with ordinality a(v,n)),
  (select 'Lesbare Aufschriften (unbestätigte Angaben aus dem Video): '||string_agg(v,E'; ' order by n) from jsonb_array_elements_text(p_result->'visible_text') with ordinality a(v,n)),
  case when p_result->>'audio_status'='transcribed' then 'Gesprochene Aussagen (unbestätigte Sprecherangaben): '||(p_result->>'spoken_summary') when p_result->>'audio_status'='no_audio_stream' then 'Das Video enthält keine Tonspur.' else 'In der Tonspur wurde keine Sprache erkannt.' end,
  (select 'Unsicher, nicht als Tatsache verwenden: '||string_agg(v,E'; ' order by n) from jsonb_array_elements_text(p_result->'uncertainties') with ordinality a(v,n)));
 if char_length(source_text)+(select count(*) from regexp_split_to_table(source_text,'') u(ch) where ascii(u.ch)>65535)>8000
 or exists(select 1 from regexp_split_to_table(source_text||(p_result->>'transcript'),'') u(ch) where ascii(u.ch) between 0 and 8 or ascii(u.ch) in (11,12) or ascii(u.ch) between 14 and 31 or ascii(u.ch) between 8234 and 8238 or ascii(u.ch) between 8294 and 8297) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 update sma_private.publication_magic_results_v1 set status='completed',result=p_result||jsonb_build_object('source_text',source_text),content_sha256=p_sha256,error_code=null,lease_id=null,lease_until=null,finished_at=now()
 where asset_id=r.asset_id and asset_revision=r.asset_revision and policy_version=r.policy_version;
 return jsonb_build_object('ok',true,'analysis',sma_private.publication_video_magic_summary_v1(f));
end $$;
revoke all on function public.sma_publication_video_magic_finish_v1(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.sma_publication_video_magic_finish_v1(uuid,uuid,jsonb,text,text) to service_role;

