-- 11.11.2026: only show Instagram codec/FPS passes when private,
-- owner-, revision- and checksum-validated technical evidence is available.
-- Existing export-specific BINARY_INSPECTION wording is preserved.
-- No audio, safety, account or provider approval is granted.
-- Stop instead of overwriting unreviewed live function changes.
do $guard$
begin
 if md5(pg_get_functiondef('sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text)'::regprocedure))
   is distinct from 'c6f190b58b62da6ff7cb944cf359a597' then
  raise exception 'PRECHECK_SOURCE_CHANGED';
 end if;
end
$guard$;

CREATE OR REPLACE FUNCTION sma_private.publication_media_precheck_v1(f sma_private.publication_files_v1, p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare checks jsonb:='[]'; state text; label text; review jsonb; outcome text; recommendations jsonb:='[]'; scope_notice text; technical jsonb; fps_ok boolean;
begin
 if p_platform not in ('youtube','instagram','facebook','tiktok') or p_platform is null then return jsonb_build_object('can_publish',false,'status','unavailable'); end if;
 label:=case p_platform when 'youtube' then 'YouTube-Video' when 'tiktok' then 'TikTok-Video' when 'instagram' then case when f.media_kind='video' then 'Instagram-Reel' else 'Instagram-Bild' end else case when f.media_kind='video' then 'Facebook-Video' else 'Facebook-Bild' end end;
 checks:=checks||jsonb_build_array(jsonb_build_object('code','FILE_SIZE','status',case when f.size_bytes>0 then 'pass' else 'fail' end,'message',case when f.size_bytes>0 then 'Die Datei enthält Daten.' else 'Die Datei ist leer. Bitte lade eine vollständige Datei hoch.' end));
 if f.verified_at is null or f.verified_at<now()-interval '15 minutes' then
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
 technical:=sma_private.publication_video_technical_v1(f);
 -- These requirements cannot be inferred from Drive dimensions or MIME metadata.
 if f.media_kind='video' and p_platform='tiktok' and technical is not null then
  fps_ok:=(technical->>'frame_rate_num')::numeric/(technical->>'frame_rate_den')::numeric between 23 and 60
   and (technical->>'min_frame_interval_us')::numeric>=16665 and (technical->>'max_frame_interval_us')::numeric<=43480;
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VIDEO_FRAMERATE','status',case when (technical->>'decoded_frames')::integer<2 then 'pending' when fps_ok then 'pass' else 'fail' end,'message',case when (technical->>'decoded_frames')::integer<2 then 'Zu wenige decodierte Bilder für einen Bildratennachweis.' when fps_ok then 'Bildrate und Abstände aller decodierten Bilder liegen innerhalb der SMA-Prüfgrenzen für 23 bis 60 Bilder pro Sekunde.' else 'Bildrate oder Bildabstände liegen außerhalb der SMA-Prüfgrenzen für 23 bis 60 Bilder pro Sekunde.' end));
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VIDEO_CODEC','status',case when technical->>'video_codec' in ('h264','hevc','vp8','vp9') then 'pass' else 'fail' end,'message','Geprüfter Videocodec: '||(technical->>'video_codec')||'. Erlaubt sind H.264, H.265, VP8 und VP9.'));
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VIDEO_DIMENSIONS','status',case when (technical->>'width_px')::integer between 360 and 4096 and (technical->>'height_px')::integer between 360 and 4096 then 'pass' else 'fail' end,'message','Die decodierte Breite und Höhe müssen jeweils zwischen 360 und 4096 Pixeln liegen.'));
 elsif f.media_kind='video' and p_platform='instagram' and technical is not null then
  -- Only the already validated, owner- and SHA-bound video evidence may
  -- replace these pending checks. No MIME/Drive metadata inference.
  fps_ok:=(technical->>'frame_rate_num')::numeric/(technical->>'frame_rate_den')::numeric between 23 and 60
   and (technical->>'min_frame_interval_us')::numeric>=16665 and (technical->>'max_frame_interval_us')::numeric<=43480;
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VIDEO_FRAMERATE','status',case when (technical->>'decoded_frames')::integer<2 then 'pending' when fps_ok then 'pass' else 'fail' end,'message',case when (technical->>'decoded_frames')::integer<2 then 'Zu wenige vollständig dekodierte Bilder für einen Bildratennachweis.' when fps_ok then 'Geprüfte Bildrate und Bildabstände liegen innerhalb der SMA-Vorprüfgrenze von 23 bis 60 fps.' else 'Die geprüfte Bildrate oder Bildabstände liegen außerhalb der SMA-Vorprüfgrenze von 23 bis 60 fps.' end));
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VIDEO_CODEC','status',case when technical->>'video_codec' in ('h264','hevc') then 'pass' else 'fail' end,'message','Geprüfter Videocodec: '||(technical->>'video_codec')||'. Instagram-Reel-Vorprüfung: H.264 oder HEVC.'));
 elsif f.media_kind='video' and p_platform in ('tiktok','instagram') then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VIDEO_FRAMERATE_PENDING','status','pending','message','Die Bildrate muss an der Videodatei geprüft werden: 23 bis 60 Bilder pro Sekunde.'));
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VIDEO_CODEC_PENDING','status','pending','message',case when p_platform='tiktok' then 'Der Videocodec muss geprüft werden: H.264, H.265, VP8 oder VP9.' else 'Der Videocodec muss geprüft werden: H.264 oder HEVC.' end));
 end if;
 if f.media_kind='video' and p_platform='instagram' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','INSTAGRAM_AUDIO_BITRATE_PENDING','status','pending','message','Ton und Datenraten müssen geprüft werden: AAC mit 48 kHz und 128 kbit/s, Video höchstens 25 Mbit/s.'));
  recommendations:=recommendations||jsonb_build_array(jsonb_build_object('code','INSTAGRAM_REEL_ASPECT','status',case when f.width_px is null or f.height_px is null then 'unknown' when f.width_px::bigint*16=f.height_px::bigint*9 then 'matches' else 'suggested' end,'message',case when f.width_px is null or f.height_px is null then 'Für Reels wird Hochformat 9:16 empfohlen. Ohne Auflösung ist ein Vergleich noch nicht möglich.' when f.width_px::bigint*16=f.height_px::bigint*9 then 'Die gemeldeten Abmessungen entsprechen dem für Reels empfohlenen Hochformat 9:16. Die tatsächliche Ausrichtung muss noch geprüft werden.' else 'Für Reels wird Hochformat 9:16 empfohlen. Deine Datei hat andere gemeldete Abmessungen. Eine eigene Hochformat-Variante kann sinnvoll sein; die Abweichung ist allein kein Formatfehler.' end));
 elsif f.media_kind='video' and p_platform='tiktok' then
  recommendations:=recommendations||jsonb_build_array(jsonb_build_object('code','TIKTOK_MP4_RECOMMENDED','status',case when f.mime_type='video/mp4' then 'matches' else 'suggested' end,'message',case when f.mime_type='video/mp4' then 'Die Datei ist als MP4 gemeldet, dem empfohlenen TikTok-Container. H.264 ist der empfohlene Videocodec.' else 'TikTok empfiehlt MP4 mit H.264. MOV und WebM bleiben mögliche Container; eine Umwandlung ist nicht allein wegen dieser Empfehlung erforderlich.' end));
 end if;
 if p_platform='facebook' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','FACEBOOK_ROUTE_PENDING','status','pending','message','Der Facebook-Veröffentlichungsweg ist noch nicht festgelegt. Vorgaben für Reels dürfen nicht auf jeden Bild- oder Videobeitrag übertragen werden.'));
 end if;
 scope_notice:=case p_platform when 'youtube' then 'YouTube-Video: Größe und Länge werden vorgeprüft. Die Einordnung als Short und die Möglichkeiten des Zielkontos sind noch offen.' when 'tiktok' then 'TikTok-Video: Format, Größe und Auflösung werden vorgeprüft. Die erlaubte Länge wird zusätzlich vom Zielkonto bestimmt.' when 'instagram' then case when f.media_kind='video' then 'Instagram-Reel: Format, Länge und Breite werden vorgeprüft. Der konkrete Veröffentlichungsweg und sein Größenlimit müssen noch bestätigt werden.' else 'Instagram-Bild: Das Ausgabeprofil ist noch offen. Eine bestandene Bildprüfung bestätigt allein nicht die Eignung für Instagram.' end else 'Facebook: Das Ausgabeprofil ist noch offen. Zuerst muss der Veröffentlichungsweg für diesen Beitrag feststehen.' end;
 if technical is not null then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','BINARY_INSPECTION','status','pass','message',case when sma_private.publication_export_technical_v1(f) is not null then 'Lokale FFmpeg-Prüfung des gespeicherten Exports. Die Prüfsumme stimmt. Bildfolge und Tonstatus wurden vollständig geprüft.' else 'Die hashgeprüfte Datei wurde vollständig ohne gemeldeten Decodierfehler gelesen; Codec, Bildzeiten und Tonstatus sind belegt. Dies ist keine Inhalts- oder Veröffentlichungsfreigabe.' end));
 else
 checks:=checks||jsonb_build_array(jsonb_build_object('code','BINARY_INSPECTION_PENDING','status','pending','message',case when f.media_kind='video' then 'Codec, Bildrate, Ton und die tatsächliche Abspielbarkeit sind noch nicht geprüft.' else 'Die tatsächliche Bilddatei, ihre Ausrichtung und der Farbraum sind noch nicht geprüft.' end));
 end if;
 review:=sma_private.publication_review_summary_v1(f);outcome:=review->'result'->>'outcome';
 if review->>'status'='completed' then
  checks:=checks||jsonb_build_array(jsonb_build_object('code','VISUAL_REVIEW','status',case when outcome='clear' then 'pass' else 'pending' end,'message',case when outcome='clear' then 'Die visuelle Sicherheitsprüfung meldet unter den SMA-Prüfgrenzen keine Auffälligkeit. Dies ist keine Veröffentlichungsfreigabe.' else 'Die visuelle Sicherheitsprüfung meldet mögliche Auffälligkeiten. Bitte prüfe den Inhalt vor der Freigabe.' end));
 else
  checks:=checks||jsonb_build_array(jsonb_build_object('code','CONTENT_REVIEW_PENDING','status','pending','message',case when review->>'status'='processing' then 'Die visuelle Sicherheitsprüfung läuft.' when review->>'status'='failed' then 'Die visuelle Sicherheitsprüfung konnte nicht abgeschlossen werden.' else 'Für diesen Dateistand liegt noch keine visuelle Sicherheitsprüfung vor.' end));
 end if;
 checks:=checks||jsonb_build_array(jsonb_build_object('code','SEMANTIC_REVIEW_PENDING','status','pending','message','Gesprochener und eingeblendeter Text, Aussagen und die Übereinstimmung mit dem Portaltext sind noch nicht geprüft.'));
 checks:=checks||jsonb_build_array(jsonb_build_object('code','PUBLICATION_APPROVAL_PENDING','status','pending','message','Zielkonto, Rechte, Kennzeichnungen und endgültige Freigabe sind noch offen.'));
 state:=case when exists(select 1 from jsonb_array_elements(checks) q where q->>'status'='fail') then 'needs_changes' else 'needs_review' end;
 return jsonb_build_object('rules_version','2026-11-03.1','status',state,'can_publish',false,'profile',label,'scope_notice',scope_notice,'facts_source','drive_metadata','technical',technical,'recommendations',recommendations,'asset_id',f.id,'asset_revision',f.revision,'verified_at',f.verified_at,'facts',jsonb_build_object('mime_type',f.mime_type,'size_bytes',f.size_bytes,'width_px',f.width_px,'height_px',f.height_px,'duration_ms',f.duration_ms),'checks',checks,'content_review',review);
end $function$;

revoke all on function sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text) from public,anon,authenticated;
grant execute on function sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text) to service_role;
