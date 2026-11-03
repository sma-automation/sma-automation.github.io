begin;
-- In-memory records only: no customer files, review jobs or rate limits are changed.
do $$ declare f sma_private.publication_files_v1%rowtype; r jsonb; p text; kind text; begin
 f.id:='fa330000-0000-4000-8000-000000000001';f.revision:='fixture:1';f.available:=false;
 f.media_kind:='video';f.mime_type:='video/mp4';f.size_bytes:=1000000;f.width_px:=1080;f.height_px:=1920;f.duration_ms:=12500;f.verified_at:=now();
 r:=sma_private.publication_media_precheck_v1(f,'instagram');
 assert r->>'rules_version'='2026-11-03.1';assert r->>'facts_source'='drive_metadata';
 assert r->'recommendations' @> '[{"code":"INSTAGRAM_REEL_ASPECT","status":"matches"}]';
 assert r->'checks' @> '[{"code":"VIDEO_FRAMERATE_PENDING","status":"pending"},{"code":"VIDEO_CODEC_PENDING","status":"pending"},{"code":"INSTAGRAM_AUDIO_BITRATE_PENDING","status":"pending"}]';
 assert r->>'status'='needs_review' and r->'can_publish'='false';
 f.width_px:=1920;f.height_px:=1080;r:=sma_private.publication_media_precheck_v1(f,'instagram');
 assert r->'recommendations' @> '[{"code":"INSTAGRAM_REEL_ASPECT","status":"suggested"}]';
 assert r->>'status'='needs_review','Landscape recommendation must not fail a valid metadata check';
 f.width_px:=null;r:=sma_private.publication_media_precheck_v1(f,'instagram');
 assert r->'recommendations' @> '[{"code":"INSTAGRAM_REEL_ASPECT","status":"unknown"}]';
 assert r->'checks' @> '[{"code":"DIMENSIONS_MISSING","status":"pending"}]';
 f.width_px:=2147483647;f.height_px:=2147483647;r:=sma_private.publication_media_precheck_v1(f,'instagram');
 assert r->>'status'='needs_changes','Real width failure must remain despite advisory recommendations';
 f.width_px:=1080;f.height_px:=1920;f.mime_type:='video/webm';r:=sma_private.publication_media_precheck_v1(f,'tiktok');
 assert r->'checks' @> '[{"code":"TIKTOK_FORMAT","status":"pass"}]';
 assert r->'recommendations' @> '[{"code":"TIKTOK_MP4_RECOMMENDED","status":"suggested"}]';
 assert r->>'status'='needs_review','Supported WebM must not fail because MP4 is recommended';
 f.mime_type:='video/mp4';r:=sma_private.publication_media_precheck_v1(f,'tiktok');
 assert r->'recommendations' @> '[{"code":"TIKTOK_MP4_RECOMMENDED","status":"matches"}]';
 assert r->'checks' @> '[{"code":"VIDEO_CODEC_PENDING","status":"pending"}]','MIME cannot prove codec';
 foreach kind in array array['video','image'] loop
  f.media_kind:=kind;f.mime_type:=case when kind='image' then 'image/png' else 'video/mp4' end;
  foreach p in array array['instagram','facebook','youtube','tiktok'] loop
   r:=sma_private.publication_media_precheck_v1(f,p);
   assert length(r->>'scope_notice')>20;assert r->'can_publish'='false';
   assert r->'content_review'->'can_publish'='false';
   if kind='image' or p in ('facebook','youtube') then assert r->'recommendations'='[]';end if;
   if p='facebook' then
    assert r->'checks' @> '[{"code":"FACEBOOK_ROUTE_PENDING","status":"pending"}]';
    assert not r->'checks' @> '[{"code":"VIDEO_FRAMERATE_PENDING"}]','Reel rules must not leak into an unspecified Facebook route';
   end if;
  end loop;
 end loop;
 f.verified_at:=null;r:=sma_private.publication_media_precheck_v1(f,'instagram');
 assert r->'checks' @> '[{"code":"FILE_REFRESH_REQUIRED","status":"pending"}]';
 assert not has_function_privilege('authenticated','sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text)','EXECUTE');
 assert not has_function_privilege('anon','sma_private.publication_media_precheck_v1(sma_private.publication_files_v1,text)','EXECUTE');
end $$;
rollback;
select 'Portal scope, advisory-only recommendations, unknown metadata, overflow and private function permissions passed; no writes' as result;
