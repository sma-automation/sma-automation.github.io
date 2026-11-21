-- Optional visual text style. Legacy drafts render using their original text position.
create or replace function sma_private.publication_editor_settings_valid_v1(s jsonb,f sma_private.publication_files_v1)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text;v numeric;end_time numeric;m jsonb;style jsonb;
begin
 if jsonb_typeof(s) is distinct from 'object' or octet_length(s::text)>4000 then return false;end if;
 if (select count(*) from jsonb_object_keys(s)) not between 10 and 12 or not(s ?& array['format','fit','position_x','position_y','start_ms','end_ms','cover_ms','overlay_text','overlay_position','audio_volume']) or exists(select 1 from jsonb_object_keys(s) x where x not in
  ('format','fit','position_x','position_y','start_ms','end_ms','cover_ms','overlay_text','overlay_position','audio_volume','music','overlay_style')) then return false;end if;
 if coalesce(s->>'format','') not in ('original','9:16','1:1','16:9') or coalesce(s->>'fit','') not in ('contain','cover')
  or coalesce(s->>'overlay_position','') not in ('top','center','bottom')
  or jsonb_typeof(s->'overlay_text') is distinct from 'string' or char_length(s->>'overlay_text')>160
  or (s->>'overlay_text') ~ '[[:cntrl:]]' then return false;end if;
 foreach k in array array['position_x','position_y','start_ms','end_ms','cover_ms','audio_volume'] loop
  if k in ('end_ms','cover_ms') and s->k='null'::jsonb then continue;end if;
  if jsonb_typeof(s->k) is distinct from 'number' or (s->>k) !~ '^[0-9]{1,14}$' then return false;end if;
  v:=(s->>k)::numeric;
  if k in ('position_x','position_y','audio_volume') and v>100 then return false;end if;
 end loop;
 if f.media_kind='image' or f.duration_ms is null or f.duration_ms<=0 then
  if s->'start_ms'<>'0'::jsonb or s->'end_ms'<>'null'::jsonb or s->'cover_ms'<>'null'::jsonb then return false;end if;
 else
  end_time:=coalesce((s->>'end_ms')::numeric,f.duration_ms);
  if (s->>'start_ms')::numeric>=end_time or end_time>f.duration_ms then return false;end if;
  if s->'cover_ms'<>'null'::jsonb and ((s->>'cover_ms')::numeric<(s->>'start_ms')::numeric or (s->>'cover_ms')::numeric>=end_time) then return false;end if;
 end if;
 if f.media_kind='image' and s->'audio_volume'<>'100'::jsonb then return false;end if;
 if s ? 'overlay_style' then
  style := s->'overlay_style';
  if jsonb_typeof(style) is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(style)) <> 5
   or not (style ?& array['x','y','size','bold','color'])
   or jsonb_typeof(style->'bold') is distinct from 'boolean'
   or jsonb_typeof(style->'color') is distinct from 'string'
   or (style->>'color') not in ('#ffffff','#15171f','#ffd357','#9ccaff') then return false; end if;
  foreach k in array array['x','y','size'] loop
   if jsonb_typeof(style->k) is distinct from 'number' or (style->>k) !~ '^[0-9]{1,3}$' then return false; end if;
   v := (style->>k)::integer;
   if (k = 'size' and v not between 50 and 260) or (k <> 'size' and v > 100) then return false; end if;
  end loop;
 end if;
 if s?'music' then
  m:=s->'music';
  if f.media_kind<>'video' or jsonb_typeof(m) is distinct from 'object' then return false;end if;
  if (select count(*) from jsonb_object_keys(m))<>6 or not(m ?& array['name','sha256','size_bytes','mime_type','volume','start_ms'])
   or jsonb_typeof(m->'name') is distinct from 'string' or char_length(m->>'name') not between 1 and 180 or (m->>'name') ~ '[[:cntrl:]]'
   or coalesce(m->>'sha256','') !~ '^[a-f0-9]{64}$' or coalesce(m->>'mime_type','') not in ('audio/mpeg','audio/wav') then return false;end if;
  foreach k in array array['size_bytes','volume','start_ms'] loop
   if jsonb_typeof(m->k) is distinct from 'number' or (m->>k) !~ '^[0-9]{1,9}$' then return false;end if;
  end loop;
  if (m->>'size_bytes')::bigint not between 12 and 8000000 or (m->>'volume')::int>100 or (m->>'start_ms')::int>=600000 then return false;end if;
 end if;
 return true;
end $$;
revoke all on function sma_private.publication_editor_settings_valid_v1(jsonb,sma_private.publication_files_v1) from public,anon,authenticated,service_role;
