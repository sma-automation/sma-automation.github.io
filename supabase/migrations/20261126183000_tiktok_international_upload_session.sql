create or replace function sma_private.publication_provider_session_valid_v1(p_platform text,u text)
returns boolean language sql immutable set search_path='' as $$
 -- No arbitrary hosts, ports, credentials, redirects, fragments or escaped path.
 select u is not null and octet_length(u) between 40 and 4000 and u !~ '[[:space:]\\#]' and
 case p_platform when 'youtube' then u ~ '^https://www\.googleapis\.com/upload/youtube/v3/videos\?[^#]*$' and u ~ '[?&]upload_id=[A-Za-z0-9_-]+' and u ~ '[?&]uploadType=resumable(&|$)'
 when 'tiktok' then u ~ '^https://(open-upload|upload\.us)\.tiktokapis\.com/(video|upload)/\?[A-Za-z0-9_=&.%-]+$'
   or u ~ '^https://open-upload-i18n[.]tiktokapis[.]com/upload[?](upload_id=[A-Za-z0-9_.~%-]+&upload_token=[A-Za-z0-9_.~%+=-]+|upload_token=[A-Za-z0-9_.~%+=-]+&upload_id=[A-Za-z0-9_.~%-]+)$'
 else false end;
$$;
