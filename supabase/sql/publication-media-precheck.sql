alter table sma_private.publication_files_v1 add column if not exists width_px integer check(width_px between 1 and 1000000);
alter table sma_private.publication_files_v1 add column if not exists height_px integer check(height_px between 1 and 1000000);
alter table sma_private.publication_files_v1 add column if not exists duration_ms bigint check(duration_ms between 0 and 9999999999999);

-- Metadata precheck only: no binary decoding, content analysis or upload approval.
-- Rules checked 2026-11-01; see n8n/publishing/MEDIA_PRECHECK.md.
create or replace function sma_private.publication_media_precheck_v1(f sma_private.publication_files_v1,p_platform text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare checks jsonb:='[]'; state text; label text;
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
 checks:=checks||jsonb_build_array(jsonb_build_object('code','CONTENT_REVIEW_PENDING','status','pending','message','Die Inhalts- und Sicherheitsprüfung ist diesem Dateistand noch nicht zugeordnet.'));
 checks:=checks||jsonb_build_array(jsonb_build_object('code','PUBLICATION_APPROVAL_PENDING','status','pending','message','Zielkonto, Rechte, Kennzeichnungen und endgültige Freigabe sind noch offen.'));
 state:=case when exists(select 1 from jsonb_array_elements(checks) q where q->>'status'='fail') then 'needs_changes' else 'needs_review' end;
 return jsonb_build_object('rules_version','2026-11-01.1','status',state,'can_publish',false,'profile',label,'asset_id',f.id,'asset_revision',f.revision,'verified_at',f.verified_at,'facts',jsonb_build_object('mime_type',f.mime_type,'size_bytes',f.size_bytes,'width_px',f.width_px,'height_px',f.height_px,'duration_ms',f.duration_ms),'checks',checks);
end $$;
revoke all on function sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text) from public,anon,authenticated;
grant execute on function sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text) to service_role;

create or replace function sma_private.publication_files_request_v1(p_action text,p_input jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); c public.sma_kunden%rowtype; s sma_private.publication_file_sync_v1%rowtype;
 f sma_private.publication_files_v1%rowtype; b sma_private.publication_assignments_v1%rowtype; j sma_private.publication_previews_v1%rowtype;
 items jsonb; d jsonb; saved jsonb; drafts jsonb; portal text; expected integer;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED'); end if;
 if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>30000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 if (select count(*) from public.sma_kunden k where k.user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE'); end if;
 select * into c from public.sma_kunden k where k.user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 if p_action='list' then
  select coalesce(jsonb_agg(x.item order by x.modified_at desc,x.id),'[]') into items from (
   select catalog_f.id,catalog_f.modified_at,jsonb_build_object('id',catalog_f.id,'name',catalog_f.name,'media_kind',catalog_f.media_kind,'revision',catalog_f.revision,'modified_at',catalog_f.modified_at,'size_bytes',catalog_f.size_bytes,'verified_at',catalog_f.verified_at,'mime_type',catalog_f.mime_type,'width_px',catalog_f.width_px,'height_px',catalog_f.height_px,'duration_ms',catalog_f.duration_ms,
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('platform',a.platform,'revision',a.revision,'status',case when a.asset_revision=catalog_f.revision and p.revision=a.preview_revision then 'assigned' else 'changed' end) order by a.platform) from sma_private.publication_assignments_v1 a join sma_private.publication_previews_v1 p on p.id=a.preview_id where a.asset_id=catalog_f.id),'[]')) item
   from sma_private.publication_files_v1 catalog_f where catalog_f.user_id=uid and catalog_f.customer_id=c.id and catalog_f.available order by catalog_f.modified_at desc,catalog_f.id limit 1000
  ) x;
  select * into s from sma_private.publication_file_sync_v1 where user_id=uid;
  return jsonb_build_object('ok',true,'files',items,'synced_at',s.finished_at);
 elsif p_action='sync_start' then
  if c.n8n_kunde_id is null or c.kunde_email is null then return jsonb_build_object('ok',false,'code','FOLDER_UNAVAILABLE'); end if;
  insert into sma_private.publication_file_sync_v1(user_id,customer_id) values(uid,c.id) on conflict do nothing;
  select * into s from sma_private.publication_file_sync_v1 where user_id=uid for update;
  if s.lease_until>now() then return jsonb_build_object('ok',false,'code','FILE_SYNC_RUNNING'); end if;
  if s.started_at>now()-interval '15 seconds' then return jsonb_build_object('ok',false,'code','FILE_SYNC_RATE_LIMITED'); end if;
  update sma_private.publication_file_sync_v1 set lease_id=gen_random_uuid(),lease_until=now()+interval '2 minutes',started_at=now(),customer_id=c.id,n8n_kunde_id=c.n8n_kunde_id,kunde_email=c.kunde_email where user_id=uid returning * into s;
  return jsonb_build_object('ok',true,'lease_id',s.lease_id,'user_id',uid,'customer_id',c.id,'n8n_kunde_id',c.n8n_kunde_id,'kunde_email',c.kunde_email);
 end if;
 if p_action not in ('get','assign','save','check') or p_action is null then return jsonb_build_object('ok',false,'code','INVALID_ACTION'); end if;
 if coalesce(p_input->>'asset_id','')!~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or coalesce(p_input->>'platform','') not in ('youtube','instagram','facebook','tiktok') then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 portal:=p_input->>'platform';
 select * into f from sma_private.publication_files_v1 where id=(p_input->>'asset_id')::uuid and user_id=uid and customer_id=c.id for update;
 if not found or not f.available then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE'); end if;
 if p_action='check' then
  if p_input->>'asset_revision' is distinct from f.revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED'); end if;
  return jsonb_build_object('ok',true,'media_check',sma_private.publication_media_precheck_v1(f,portal));
 end if;
 select * into b from sma_private.publication_assignments_v1 where asset_id=f.id and platform=portal for update;
 if p_action='get' then
  if not found then return jsonb_build_object('ok',true,'status','empty'); end if;
  if b.asset_revision<>f.revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED'); end if;
  select * into j from sma_private.publication_previews_v1 where id=b.preview_id and user_id=uid and customer_id=c.id;
  if not found or j.revision<>b.preview_revision then return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED'); end if;
  if c.shop_oeffentlich is not true or ('https://sma-automation.com/app/shop.html?shop='||c.shop_slug) is distinct from j.shop_url then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED'); end if;
  return jsonb_build_object('ok',true,'status','completed','id',j.id,'input',j.input,'preview',jsonb_set(j.preview,'{drafts}',jsonb_build_array(b.draft)),'revision',j.revision,'assignment_revision',b.revision);
 end if;
 if f.verified_at<now()-interval '15 minutes' then return jsonb_build_object('ok',false,'code','FILE_REFRESH_REQUIRED'); end if;
 if p_input->>'asset_revision' is distinct from f.revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED'); end if;
 if f.media_kind='image' and portal in ('youtube','tiktok') then return jsonb_build_object('ok',false,'code','PORTAL_REQUIRES_VIDEO'); end if;
 if p_input->'assignment_revision' is distinct from to_jsonb(coalesce(b.revision,0)) then return jsonb_build_object('ok',false,'code','ASSIGNMENT_CONFLICT'); end if;
 if p_action='assign' then
  if coalesce(p_input->>'preview_id','')!~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
  select * into j from sma_private.publication_previews_v1 where id=(p_input->>'preview_id')::uuid and user_id=uid and customer_id=c.id for update;
  if not found or j.status<>'completed' or j.preview->'can_publish' is distinct from 'false'::jsonb then return jsonb_build_object('ok',false,'code','PREVIEW_UNAVAILABLE'); end if;
  if p_input->'preview_revision' is distinct from to_jsonb(j.revision) then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
  if j.input->>'media_kind' is distinct from f.media_kind then return jsonb_build_object('ok',false,'code','FILE_FORMAT_MISMATCH'); end if;
  if exists(select 1 from sma_private.publication_assignments_v1 where preview_id=j.id and platform=portal and asset_id<>f.id) then return jsonb_build_object('ok',false,'code','TEXT_ALREADY_ASSIGNED'); end if;
 else
  if b.asset_id is null then return jsonb_build_object('ok',false,'code','ASSIGNMENT_UNAVAILABLE'); end if;
  select * into j from sma_private.publication_previews_v1 where id=b.preview_id and user_id=uid and customer_id=c.id for update;
  if not found or j.revision<>b.preview_revision then return jsonb_build_object('ok',false,'code','REVISION_CONFLICT'); end if;
  select jsonb_agg(jsonb_build_object('platform',x->>'platform','title',case when x->>'platform'=portal then p_input->>'title' else x->>'title' end,'body',case when x->>'platform'=portal then p_input->>'body' else x->>'body' end)) into drafts from jsonb_array_elements(j.preview->'drafts') x;
  saved:=sma_private.publication_preview_request_v1('save',jsonb_build_object('revision',j.revision,'drafts',drafts),j.id);
  if saved->'ok' is distinct from 'true'::jsonb then return saved; end if;
  select * into j from sma_private.publication_previews_v1 where id=j.id;
 end if;
 if c.shop_oeffentlich is not true or ('https://sma-automation.com/app/shop.html?shop='||c.shop_slug) is distinct from j.shop_url then return jsonb_build_object('ok',false,'code','ACCOUNT_CHANGED'); end if;
 select x into d from jsonb_array_elements(j.preview->'drafts') x where x->>'platform'=portal;
 if not found then return jsonb_build_object('ok',false,'code','PREVIEW_UNAVAILABLE'); end if;
 insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft) values(f.id,portal,j.id,j.revision,f.revision,d)
 on conflict(asset_id,platform) do update set preview_id=excluded.preview_id,preview_revision=excluded.preview_revision,asset_revision=excluded.asset_revision,draft=excluded.draft,revision=sma_private.publication_assignments_v1.revision+1,updated_at=now() returning * into b;
 return jsonb_build_object('ok',true,'status','completed','id',j.id,'input',j.input,'preview',jsonb_set(j.preview,'{drafts}',jsonb_build_array(d)),'revision',j.revision,'assignment_revision',b.revision);
end $$;
revoke all on function sma_private.publication_files_request_v1(text,jsonb) from public,anon,authenticated;
grant execute on function sma_private.publication_files_request_v1(text,jsonb) to authenticated;
create or replace function public.sma_publication_files_v1(p_action text,p_input jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select sma_private.publication_files_request_v1(p_action,p_input);$$;
revoke all on function public.sma_publication_files_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.sma_publication_files_v1(text,jsonb) to authenticated;

create or replace function public.sma_publication_files_finish_v1(p_user_id uuid,p_lease_id uuid,p_files jsonb default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s sma_private.publication_file_sync_v1%rowtype; c public.sma_kunden%rowtype; x jsonb;
begin
 select * into s from sma_private.publication_file_sync_v1 where user_id=p_user_id for update;
 if not found or p_lease_id is null or s.lease_until is null or s.lease_id is distinct from p_lease_id or s.lease_until<now() then return jsonb_build_object('ok',false,'code','INVALID_LEASE'); end if;
 select * into c from public.sma_kunden where id=s.customer_id and user_id=s.user_id;
 if not found or c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) or c.n8n_kunde_id is distinct from s.n8n_kunde_id or c.kunde_email is distinct from s.kunde_email then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 if p_error is not null then
  update sma_private.publication_file_sync_v1 set lease_until=null,lease_id=null where user_id=s.user_id;
  return jsonb_build_object('ok',false,'code',case when p_error in ('FOLDER_UNAVAILABLE','FILE_CATALOG_TOO_LARGE','FILE_METADATA_INVALID') then p_error else 'FILE_SYNC_UNAVAILABLE' end);
 end if;
 if jsonb_typeof(p_files) is distinct from 'array' or octet_length(p_files::text)>2000000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 if jsonb_array_length(p_files)>1000 or (select count(distinct v->>'drive_file_id') from jsonb_array_elements(p_files) v)<>jsonb_array_length(p_files) then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
 for x in select value from jsonb_array_elements(p_files) loop
  if jsonb_typeof(x) is distinct from 'object' or coalesce(x->>'drive_file_id','')!~'^[A-Za-z0-9_-]{10,200}$' or char_length(coalesce(x->>'name','')) not between 1 and 500 or coalesce(x->>'media_kind','') not in ('image','video') or char_length(coalesce(x->>'revision','')) not between 1 and 250 or coalesce(x->>'mime_type','')!~'^(image|video)/[a-zA-Z0-9.+-]+$' or coalesce(x->>'size_bytes','')!~'^[0-9]{1,18}$' or coalesce(x->>'modified_at','')!~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then return jsonb_build_object('ok',false,'code','FILE_METADATA_INVALID'); end if;
  if (x->'width_px' is not null and x->'width_px'<>'null'::jsonb and (jsonb_typeof(x->'width_px')<>'number' or (x->>'width_px')!~'^[1-9][0-9]{0,6}$'))
   or (x->'height_px' is not null and x->'height_px'<>'null'::jsonb and (jsonb_typeof(x->'height_px')<>'number' or (x->>'height_px')!~'^[1-9][0-9]{0,6}$'))
   or (x->'duration_ms' is not null and x->'duration_ms'<>'null'::jsonb and (jsonb_typeof(x->'duration_ms')<>'number' or (x->>'duration_ms')!~'^[0-9]{1,13}$')) then return jsonb_build_object('ok',false,'code','FILE_METADATA_INVALID'); end if;
  if (x->>'width_px')::integer>1000000 or (x->>'height_px')::integer>1000000 or (x->>'duration_ms')::bigint>9999999999999 then return jsonb_build_object('ok',false,'code','FILE_METADATA_INVALID'); end if;
 end loop;
 update sma_private.publication_files_v1 set available=false where customer_id=c.id and user_id=c.user_id;
 for x in select value from jsonb_array_elements(p_files) loop
  insert into sma_private.publication_files_v1 as catalog(customer_id,user_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,available,verified_at,width_px,height_px,duration_ms)
  values(c.id,c.user_id,x->>'drive_file_id',x->>'name',x->>'media_kind',x->>'mime_type',x->>'revision',(x->>'modified_at')::timestamptz,(x->>'size_bytes')::bigint,true,now(),(x->>'width_px')::integer,(x->>'height_px')::integer,(x->>'duration_ms')::bigint)
  on conflict(customer_id,drive_file_id) do update set name=excluded.name,media_kind=excluded.media_kind,mime_type=excluded.mime_type,revision=excluded.revision,modified_at=excluded.modified_at,size_bytes=excluded.size_bytes,available=true,verified_at=now(),(width_px,height_px,duration_ms) = (
    select coalesce(excluded.width_px, case when same_source then catalog.width_px end),
           coalesce(excluded.height_px, case when same_source then catalog.height_px end),
           coalesce(excluded.duration_ms, case when same_source then catalog.duration_ms end)
    from (select catalog.user_id = excluded.user_id
      and catalog.revision ~ '^sha256:[0-9a-f]{64}:[0-9]{1,30}$'
      and excluded.revision ~ '^sha256:[0-9a-f]{64}:[0-9]{1,30}$'
      and split_part(catalog.revision, ':', 2) = split_part(excluded.revision, ':', 2)
      and catalog.size_bytes = excluded.size_bytes
      and catalog.mime_type = excluded.mime_type
      and catalog.media_kind = excluded.media_kind
      and (catalog.width_px is null or excluded.width_px is null or catalog.width_px = excluded.width_px)
      and (catalog.height_px is null or excluded.height_px is null or catalog.height_px = excluded.height_px)
      and (catalog.duration_ms is null or excluded.duration_ms is null or catalog.duration_ms = excluded.duration_ms)
     as same_source) as identity_check
   );
 end loop;
 update sma_private.publication_file_sync_v1 set lease_until=null,lease_id=null,finished_at=now() where user_id=c.user_id;
 return jsonb_build_object('ok',true,'count',jsonb_array_length(p_files));
end $$;
revoke all on function public.sma_publication_files_finish_v1(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.sma_publication_files_finish_v1(uuid,uuid,jsonb,text) to service_role;

-- Publisher contract: exact customer + Drive ID + current revision + portal.
-- It deliberately does not grant upload approval; media/account checks remain separate.
create or replace function public.sma_publication_assignment_v1(p_customer_id bigint,p_drive_file_id text,p_asset_revision text,p_platform text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare f sma_private.publication_files_v1%rowtype; a sma_private.publication_assignments_v1%rowtype; j sma_private.publication_previews_v1%rowtype; c public.sma_kunden%rowtype;
begin
 select * into c from public.sma_kunden where id=p_customer_id and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
 if not found then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 select * into f from sma_private.publication_files_v1 where customer_id=c.id and user_id=c.user_id and drive_file_id=p_drive_file_id and available;
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE'); end if;
 if f.revision is distinct from p_asset_revision or f.verified_at<now()-interval '15 minutes' then return jsonb_build_object('ok',false,'code','FILE_CHANGED'); end if;
 select * into a from sma_private.publication_assignments_v1 where asset_id=f.id and platform=p_platform and asset_revision=f.revision;
 if not found then return jsonb_build_object('ok',false,'code','ASSIGNMENT_UNAVAILABLE'); end if;
 select * into j from sma_private.publication_previews_v1 where id=a.preview_id and user_id=c.user_id and customer_id=c.id and revision=a.preview_revision and status='completed';
 if not found or c.shop_oeffentlich is not true or ('https://sma-automation.com/app/shop.html?shop='||c.shop_slug) is distinct from j.shop_url then return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED'); end if;
 return jsonb_build_object('ok',true,'can_publish',false,'asset_id',f.id,'asset_revision',f.revision,'platform',a.platform,'assignment_revision',a.revision,'preview_id',a.preview_id,'preview_revision',a.preview_revision,'text',a.draft,'shop_url',j.shop_url,'media_kind',f.media_kind,'media_check',sma_private.publication_media_precheck_v1(f,p_platform));
end $$;
revoke all on function public.sma_publication_assignment_v1(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.sma_publication_assignment_v1(bigint,text,text,text) to service_role;

