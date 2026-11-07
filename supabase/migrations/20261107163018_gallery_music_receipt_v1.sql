-- Drive catalogue writes and verified upload finishes both pass through this table.
-- Reconcile only a previously reserved output and its server-bound Drive ID.
create function sma_private.gallery_music_receive_file_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update sma_private.gallery_music_v1 j
 set state='completed',result_id=new.id,lease_until=null
 from sma_private.publication_uploads_v1 u, sma_private.publication_files_v1 source,
      sma_private.publication_files_v1 result,
      public.sma_kunden c
 where result.id=new.id and result.drive_file_id=new.drive_file_id and result.available
   and result.media_kind='video' and result.mime_type='video/mp4'
   and result.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$'
   and u.drive_file_id=result.drive_file_id and u.id=j.id
   and u.customer_id=result.customer_id and j.customer_id=result.customer_id
   and u.user_id=result.user_id and j.user_id=result.user_id
   and (u.status='ready' or (u.status='completed' and u.asset_id=new.id))
   and u.name=j.name and result.name=j.name and u.mime_type=result.mime_type
   and u.size_bytes=j.expected_size and result.size_bytes=j.expected_size
   and split_part(result.revision,':',2)=j.expected_sha
   and source.id=j.source_id and new.id<>source.id and source.available
   and source.customer_id=j.customer_id and source.user_id=j.user_id
   and sma_private.gallery_music_key_v1(source.revision)=j.source_key
   and c.id=j.customer_id and c.user_id=j.user_id and c.aktiv is true
   and (c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true)
   and c.n8n_kunde_id=u.n8n_kunde_id and c.kunde_email=u.kunde_email
   and j.state in ('pending','check_upload');
 return null;
end $$;
revoke all on function sma_private.gallery_music_receive_file_v1() from public,anon,authenticated,service_role;
-- A full catalogue scan marks files unavailable, then restores them one by one.
-- Evaluate after the full transaction, even if Drive listed the output first.
create constraint trigger gallery_music_receive_file after insert or update on sma_private.publication_files_v1
deferrable initially deferred
for each row when (new.available and new.media_kind='video' and new.mime_type='video/mp4'
                   and new.revision ~ '^sha256:[a-f0-9]{64}:[0-9]{1,30}$')
execute function sma_private.gallery_music_receive_file_v1();

-- The existing owner lookup and unconfirmed-lease handling stay in the same RPC.
-- A matching acknowledgement can be repeated if the catalogue committed first.
do $patch$
declare original text; anchor constant text:=' if not found or j.state<>''pending'' or j.lease is null';
begin
 select pg_get_functiondef('sma_private.gallery_music_request_v1(text,jsonb)'::regprocedure) into original;
 if md5((select prosrc from pg_proc where oid='sma_private.gallery_music_request_v1(text,jsonb)'::regprocedure))
    <> 'e8437e76d124f74b5a616b87aef06830' or strpos(original,anchor)=0 then
  raise exception 'Unexpected gallery music RPC revision';
 end if;
 execute replace(original,anchor,$change$ if found and p_action='complete' and j.state='completed' and j.lease=(p_input->>'lease')::uuid then
  return jsonb_build_object('ok',true,'state','completed','asset_id',j.result_id);
 end if;
$change$||anchor);
end $patch$;
