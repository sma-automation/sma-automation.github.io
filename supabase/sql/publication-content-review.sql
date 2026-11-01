-- Visual safety screening only. Completion never grants permission to publish.
create table if not exists sma_private.publication_content_reviews_v1 (
 asset_id uuid not null references sma_private.publication_files_v1(id), asset_revision text not null,
 policy_version text not null, user_id uuid not null, customer_id bigint not null references public.sma_kunden(id),
 n8n_kunde_id text not null, kunde_email text not null,
 status text not null check(status in ('processing','completed','failed')), result jsonb, error_code text,
 lease_id uuid, lease_until timestamptz, started_at timestamptz not null default now(), finished_at timestamptz, content_sha256 text,
 primary key(asset_id,asset_revision,policy_version)
);
create table if not exists sma_private.publication_review_rate_v1 (
 user_id uuid primary key, window_started timestamptz not null default now(), attempts integer not null default 0, last_started timestamptz
);
alter table sma_private.publication_content_reviews_v1 enable row level security;
alter table sma_private.publication_review_rate_v1 enable row level security;
revoke all on sma_private.publication_content_reviews_v1,sma_private.publication_review_rate_v1 from public,anon,authenticated;
grant select,insert,update on sma_private.publication_content_reviews_v1,sma_private.publication_review_rate_v1 to service_role;
create index if not exists publication_content_reviews_v1_owner_idx on sma_private.publication_content_reviews_v1(user_id,status,lease_until);

create or replace function sma_private.publication_review_summary_v1(f sma_private.publication_files_v1)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r sma_private.publication_content_reviews_v1%rowtype; c public.sma_kunden%rowtype; s text:='unreviewed';
begin
 select * into c from public.sma_kunden where id=f.customer_id and user_id=f.user_id and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
 if found and f.available then
  select * into r from sma_private.publication_content_reviews_v1 where asset_id=f.id and asset_revision=f.revision and policy_version='visual-2026-11-01.1' and user_id=f.user_id and customer_id=f.customer_id and n8n_kunde_id=c.n8n_kunde_id and kunde_email=c.kunde_email;
  if found then s:=case when r.status='processing' and (r.lease_until is null or r.lease_until<=now()) then 'failed' else r.status end;end if;
 end if;
 return jsonb_build_object('asset_id',f.id,'asset_revision',f.revision,'policy_version','visual-2026-11-01.1','status',s,'can_publish',false,'result',case when s='completed' then r.result end,'finished_at',r.finished_at,'error_code',case when s='failed' then coalesce(r.error_code,'REVIEW_TIMEOUT') end);
end $$;
revoke all on function sma_private.publication_review_summary_v1(sma_private.publication_files_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_review_summary_v1(sma_private.publication_files_v1) to service_role;

create or replace function sma_private.publication_review_request_v1(p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.sma_kunden%rowtype; f sma_private.publication_files_v1%rowtype;
 r sma_private.publication_content_reviews_v1%rowtype; rate sma_private.publication_review_rate_v1%rowtype; summary jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED'); end if;
 if p_action is null or p_action not in ('get','start') or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>2000 or coalesce(p_input->>'asset_id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 if p_action='start' then
  insert into sma_private.publication_review_rate_v1(user_id) values(uid) on conflict do nothing;
  select * into rate from sma_private.publication_review_rate_v1 where user_id=uid for update;
 end if;
 select * into f from sma_private.publication_files_v1 where id=(p_input->>'asset_id')::uuid and user_id=uid and customer_id=c.id for update;
 if not found or not f.available then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 if f.revision is distinct from p_input->>'asset_revision' then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
 summary:=sma_private.publication_review_summary_v1(f);
 if p_action='get' or summary->>'status' in ('completed','processing') then return jsonb_build_object('ok',true,'review',summary);end if;
 if f.verified_at<now()-interval '15 minutes' then return jsonb_build_object('ok',false,'code','FILE_REFRESH_REQUIRED');end if;
 if c.n8n_kunde_id is null or c.kunde_email is null then return jsonb_build_object('ok',false,'code','FOLDER_UNAVAILABLE');end if;
 if f.media_kind='video' then return jsonb_build_object('ok',false,'code','VIDEO_PLAN_REQUIRED');end if;
 if f.revision!~'^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32}):[0-9]+$' then return jsonb_build_object('ok',false,'code','CHECKSUM_REQUIRED');end if;
 if f.size_bytes<=0 or (f.media_kind='image' and (f.mime_type not in ('image/jpeg','image/png','image/webp') or f.size_bytes>12000000)) or (f.media_kind='video' and (f.mime_type not in ('video/mp4','video/quicktime','video/webm') or f.size_bytes>=50000000 or f.duration_ms is null or f.duration_ms<=0 or f.duration_ms>=60000)) then return jsonb_build_object('ok',false,'code','MEDIA_UNSUPPORTED');end if;
 if exists(select 1 from sma_private.publication_content_reviews_v1 where user_id=uid and status='processing' and lease_until>now()) then return jsonb_build_object('ok',false,'code','REVIEW_RUNNING');end if;
 if rate.last_started>now()-interval '30 seconds' or (rate.window_started>now()-interval '1 hour' and rate.attempts>=6) then return jsonb_build_object('ok',false,'code','REVIEW_RATE_LIMITED');end if;
 update sma_private.publication_review_rate_v1 set attempts=case when window_started<=now()-interval '1 hour' then 1 else attempts+1 end,window_started=case when window_started<=now()-interval '1 hour' then now() else window_started end,last_started=now() where user_id=uid;
 insert into sma_private.publication_content_reviews_v1(asset_id,asset_revision,policy_version,user_id,customer_id,n8n_kunde_id,kunde_email,status,lease_id,lease_until)
 values(f.id,f.revision,'visual-2026-11-01.1',uid,c.id,c.n8n_kunde_id,c.kunde_email,'processing',gen_random_uuid(),now()+interval '4 minutes')
 on conflict(asset_id,asset_revision,policy_version) do update set user_id=excluded.user_id,customer_id=excluded.customer_id,n8n_kunde_id=excluded.n8n_kunde_id,kunde_email=excluded.kunde_email,status='processing',result=null,error_code=null,lease_id=excluded.lease_id,lease_until=excluded.lease_until,started_at=now(),finished_at=null,content_sha256=null returning * into r;
 return jsonb_build_object('ok',true,'review',sma_private.publication_review_summary_v1(f),'lease_id',r.lease_id,'user_id',uid,'customer_id',c.id,'n8n_kunde_id',c.n8n_kunde_id,'kunde_email',c.kunde_email,'asset_id',f.id,'asset_revision',f.revision,'drive_file_id',f.drive_file_id,'media_kind',f.media_kind,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'duration_ms',f.duration_ms);
end $$;
revoke all on function sma_private.publication_review_request_v1(text,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_review_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_publication_review_v1(p_action text,p_input jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_review_request_v1(p_action,p_input);$$;
revoke all on function public.sma_publication_review_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_review_v1(text,jsonb) to authenticated;

create or replace function public.sma_publication_review_finish_v1(p_asset_id uuid,p_lease_id uuid,p_result jsonb default null,p_sha256 text default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f sma_private.publication_files_v1%rowtype; r sma_private.publication_content_reviews_v1%rowtype; c public.sma_kunden%rowtype; err text; cats jsonb;
begin
 select * into f from sma_private.publication_files_v1 where id=p_asset_id for update;
 select * into r from sma_private.publication_content_reviews_v1 where asset_id=p_asset_id and lease_id=p_lease_id and policy_version='visual-2026-11-01.1' for update;
 if not found or p_lease_id is null or r.status<>'processing' or r.lease_until is null or r.lease_until<=now() then return jsonb_build_object('ok',false,'code','INVALID_LEASE');end if;
 select * into c from public.sma_kunden where id=r.customer_id and user_id=r.user_id;
 if not found or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) or c.n8n_kunde_id is distinct from r.n8n_kunde_id or c.kunde_email is distinct from r.kunde_email then err:='ACCESS_INACTIVE';
 elsif f.id is null or not f.available or f.revision is distinct from r.asset_revision or f.user_id is distinct from r.user_id or f.customer_id is distinct from r.customer_id then err:='FILE_CHANGED';
 elsif p_error is not null then err:=case when p_error in ('FOLDER_UNAVAILABLE','FILE_CHANGED','CHECKSUM_REQUIRED','MEDIA_UNSUPPORTED','REVIEW_INCOMPLETE','PROVIDER_FAILED') then p_error else 'REVIEW_UNAVAILABLE' end;
 end if;
 if err is not null then
  update sma_private.publication_content_reviews_v1 set status='failed',error_code=err,result=null,lease_id=null,lease_until=null,finished_at=now() where asset_id=r.asset_id and asset_revision=r.asset_revision and policy_version=r.policy_version;
  return jsonb_build_object('ok',false,'code',err);
 end if;
 if coalesce(p_sha256,'')!~'^[a-f0-9]{64}$' or (f.revision like 'sha256:%' and split_part(f.revision,':',2)<>p_sha256) or jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>2000 or p_result->>'policy_version' is distinct from r.policy_version or p_result->'can_publish' is distinct from 'false'::jsonb or coalesce(p_result->>'outcome','') not in ('clear','needs_review') or jsonb_typeof(p_result->'categories') is distinct from 'array' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 cats:=p_result->'categories';
 if jsonb_array_length(cats)>7 or exists(select 1 from jsonb_array_elements_text(cats) v where v not in ('nudity','violence','weapons','gore','hate','drugs','self_harm')) or (select count(distinct v) from jsonb_array_elements_text(cats) v)<>jsonb_array_length(cats) or (p_result->>'outcome'='clear') is distinct from (jsonb_array_length(cats)=0) or coalesce(p_result->>'frames_checked','')!~'^[1-9][0-9]{0,2}$' then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 if (f.media_kind='image' and (p_result->'frames_checked'<>'1'::jsonb or p_result->'sampling_ms' is distinct from '0'::jsonb)) or (f.media_kind='video' and ((p_result->>'frames_checked')::integer>125 or p_result->'sampling_ms' is distinct from '1000'::jsonb)) then return jsonb_build_object('ok',false,'code','INVALID_RESULT');end if;
 update sma_private.publication_content_reviews_v1 set status='completed',result=jsonb_build_object('policy_version',r.policy_version,'outcome',p_result->>'outcome','categories',cats,'frames_checked',(p_result->>'frames_checked')::integer,'sampling_ms',(p_result->>'sampling_ms')::integer,'can_publish',false),content_sha256=p_sha256,error_code=null,lease_id=null,lease_until=null,finished_at=now() where asset_id=r.asset_id and asset_revision=r.asset_revision and policy_version=r.policy_version;
 return jsonb_build_object('ok',true,'review',sma_private.publication_review_summary_v1(f));
end $$;
revoke all on function public.sma_publication_review_finish_v1(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.sma_publication_review_finish_v1(uuid,uuid,jsonb,text,text) to service_role;

create or replace function sma_private.publication_media_precheck_v1(f sma_private.publication_files_v1,p_platform text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare checks jsonb:='[]'; state text; label text; review jsonb; outcome text;
begin
 if p_platform not in ('youtube','instagram','facebook','tiktok') or p_platform is null then return jsonb_build_object('can_publish',false,'status','unavailable'); end if;
 label:=case p_platform when 'youtube' then 'YouTube-Video' when 'tiktok' then 'TikTok-Video' when 'instagram' then case when f.media_kind='video' then 'Instagram-Reel' else 'Instagram-Bild' end else case when f.media_kind='video' then 'Facebook-Video' else 'Facebook-Bild' end end;
 checks:=checks||jsonb_build_array(jsonb_build_object('code','FILE_SIZE','status',case when f.size_bytes>0 then 'pass' else 'fail' end,'message',case when f.size_bytes>0 then 'Die Datei enthält Daten.' else 'Die Datei ist leer. Bitte lade eine vollständige Datei hoch.' end));
 if f.verified_at<now()-interval '15 minutes' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','FILE_REFRESH_REQUIRED','status','pending','message','Bitte aktualisiere die Dateien, um den aktuellen Stand zu prüfen.'));
 end if;
 if f.width_px is null or f.height_px is null then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','DIMENSIONS_MISSING','status','pending','message','Die Auflösung ist noch nicht verfügbar. Bitte aktualisiere die Dateien nach der Verarbeitung erneut.'));
 end if;
 if f.media_kind='video' and f.duration_ms is null then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','DURATION_MISSING','status','pending','message','Die Videolänge ist noch nicht verfügbar.'));
 elsif f.media_kind='video' and f.duration_ms=0 then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','EMPTY_VIDEO','status','fail','message','Für dieses Video wurde keine abspielbare Länge gemeldet.'));
 end if;
 if p_platform in ('youtube','tiktok') and f.media_kind<>'video' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VIDEO_REQUIRED','status','fail','message','Dieser SMA-Veröffentlichungsweg benötigt eine Videodatei.'));
 elsif p_platform='youtube' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','YOUTUBE_SIZE','status',case when f.size_bytes<=256000000000 then 'pass' else 'fail' end,'message',case when f.size_bytes<=256000000000 then 'Die Größe liegt innerhalb der SMA-Vorgrenze für YouTube (256 GB).' else 'Die Datei überschreitet die SMA-Vorgrenze für YouTube (256 GB).' end));
  if f.duration_ms is not null then
   checks:=checks||jsonb_build_array(jsonb_build_object('code','YOUTUBE_DURATION','status',case when f.duration_ms<=43200000 then 'pass' else 'fail' end,'message',case when f.duration_ms<=43200000 then 'Die gemeldete Länge überschreitet 12 Stunden nicht.' else 'Das Video ist länger als 12 Stunden.' end));
   if f.duration_ms>900000 then checks:=checks||jsonb_build_array(jsonb_build_object('code','YOUTUBE_LONG_VIDEO_ACCOUNT','status','pending','message','Für mehr als 15 Minuten muss das Zielkonto für längere Videos freigeschaltet sein.'));end if;
  end if;
 elsif p_platform='tiktok' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','TIKTOK_FORMAT','status',case when f.mime_type in ('video/mp4','video/quicktime','video/webm') then 'pass' else 'fail' end,'message',case when f.mime_type in ('video/mp4','video/quicktime','video/webm') then 'Das gemeldete Dateiformat passt zu MP4, MOV oder WebM.' else 'Für TikTok wird MP4, MOV oder WebM benötigt. Der Dateiname allein reicht als Nachweis nicht aus.' end));
  checks:=checks||jsonb_build_array(jsonb_build_object('code','TIKTOK_SIZE','status',case when f.size_bytes<=4000000000 then 'pass' else 'fail' end,'message',case when f.size_bytes<=4000000000 then 'Die Größe liegt innerhalb der SMA-Vorgrenze für TikTok (4 GB).' else 'Die Datei überschreitet die SMA-Vorgrenze für TikTok (4 GB).' end));
  if f.width_px is not null and f.height_px is not null then
   checks:=checks||jsonb_build_array(jsonb_build_object('code','TIKTOK_DIMENSIONS','status',case when f.width_px between 360 and 4096 and f.height_px between 360 and 4096 then 'pass' else 'fail' end,'message',case when f.width_px between 360 and 4096 and f.height_px between 360 and 4096 then 'Die gemeldete Breite und Höhe liegen zwischen 360 und 4096 Pixeln.' else 'TikTok benötigt eine Breite und Höhe zwischen 360 und 4096 Pixeln.' end));
  end if;
  checks:=checks||jsonb_build_array(jsonb_build_object('code','TIKTOK_CREATOR_LIMIT','status','pending','message','Erlaubte Videolänge, Sichtbarkeit und Interaktionen müssen am konkreten TikTok-Konto geprüft werden.'));
 elsif p_platform='instagram' and f.media_kind='video' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','INSTAGRAM_FORMAT','status',case when f.mime_type in ('video/mp4','video/quicktime') then 'pass' else 'fail' end,'message',case when f.mime_type in ('video/mp4','video/quicktime') then 'Das gemeldete Dateiformat passt zu MP4 oder MOV.' else 'Für Instagram-Reels wird MP4 oder MOV benötigt.' end));
  if f.duration_ms is not null then
   checks:=checks||jsonb_build_array(jsonb_build_object('code','INSTAGRAM_DURATION','status',case when f.duration_ms between 3000 and 900000 then 'pass' else 'fail' end,'message',case when f.duration_ms between 3000 and 900000 then 'Die gemeldete Länge liegt zwischen 3 Sekunden und 15 Minuten.' else 'Die gemeldete Länge liegt außerhalb von 3 Sekunden bis 15 Minuten.' end));
  end if;
  if f.width_px is not null then
   checks:=checks||jsonb_build_array(jsonb_build_object('code','INSTAGRAM_WIDTH','status',case when f.width_px<=1920 then 'pass' else 'fail' end,'message',case when f.width_px<=1920 then 'Die gemeldete Breite überschreitet 1920 Pixel nicht.' else 'Die gemeldete Breite überschreitet 1920 Pixel. Eine passende Medienvariante ist erforderlich.' end));
  end if;
  checks:=checks||jsonb_build_array(jsonb_build_object('code','INSTAGRAM_SIZE_RULE_PENDING','status','pending','message','Die Dateigröße muss noch gegen die Regeln des eingerichteten Instagram-Veröffentlichungswegs geprüft werden.'));
 else
  checks:=checks||jsonb_build_array(jsonb_build_object('code','PORTAL_RULES_PENDING','status','pending','message','Die vollständigen Format- und Größenregeln für diesen Veröffentlichungsweg sind noch nicht geprüft.'));
 end if;
 checks:=checks||jsonb_build_array(jsonb_build_object('code','BINARY_INSPECTION_PENDING','status','pending','message',case when f.media_kind='video' then 'Codec, Bildrate, Ton und die tatsächliche Abspielbarkeit sind noch nicht geprüft.' else 'Die tatsächliche Bilddatei, ihre Ausrichtung und der Farbraum sind noch nicht geprüft.' end));
 review:=sma_private.publication_review_summary_v1(f);outcome:=review->'result'->>'outcome';
 if review->>'status'='completed' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VISUAL_REVIEW','status',case when outcome='clear' then 'pass' else 'pending' end,'message',case when outcome='clear' then 'Die visuelle Sicherheitsprüfung meldet unter den SMA-Prüfgrenzen keine Auffälligkeit. Dies ist keine Veröffentlichungsfreigabe.' else 'Die visuelle Sicherheitsprüfung meldet mögliche Auffälligkeiten. Bitte prüfe den Inhalt vor der Freigabe.' end));
 else
  checks:=checks||jsonb_build_array(jsonb_build_object('code','CONTENT_REVIEW_PENDING','status','pending','message',case when review->>'status'='processing' then 'Die visuelle Sicherheitsprüfung läuft.' when review->>'status'='failed' then 'Die visuelle Sicherheitsprüfung konnte nicht abgeschlossen werden.' else 'Für diesen Dateistand liegt noch keine visuelle Sicherheitsprüfung vor.' end));
 end if;
 checks:=checks||jsonb_build_array(jsonb_build_object('code','SEMANTIC_REVIEW_PENDING','status','pending','message','Gesprochener und eingeblendeter Text, Aussagen und die Übereinstimmung mit dem Portaltext sind noch nicht geprüft.'));
 checks:=checks||jsonb_build_array(jsonb_build_object('code','PUBLICATION_APPROVAL_PENDING','status','pending','message','Zielkonto, Rechte, Kennzeichnungen und endgültige Freigabe sind noch offen.'));
 state:=case when exists(select 1 from jsonb_array_elements(checks) q where q->>'status'='fail') then 'needs_changes' else 'needs_review' end;
 return jsonb_build_object('rules_version','2026-11-01.1','status',state,'can_publish',false,'profile',label,'asset_id',f.id,'asset_revision',f.revision,'verified_at',f.verified_at,'facts',jsonb_build_object('mime_type',f.mime_type,'size_bytes',f.size_bytes,'width_px',f.width_px,'height_px',f.height_px,'duration_ms',f.duration_ms),'checks',checks,'content_review',review);
end $$;
revoke all on function sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text) from public,anon,authenticated;
grant execute on function sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text) to service_role;

