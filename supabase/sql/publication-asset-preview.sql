-- Read-only ownership gate for the authenticated n8n thumbnail proxy.
-- No public media links, new table grants, or publishing permissions.
create or replace function sma_private.publication_asset_preview_v1(p_asset_id uuid,p_revision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); c public.sma_kunden%rowtype; f sma_private.publication_files_v1%rowtype;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED'); end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE'); end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 select * into f from sma_private.publication_files_v1 where id=p_asset_id and user_id=uid and customer_id=c.id and available;
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE'); end if;
 if p_revision is distinct from f.revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED'); end if;
 if c.n8n_kunde_id is null or c.kunde_email is null then return jsonb_build_object('ok',false,'code','FOLDER_UNAVAILABLE'); end if;
 return jsonb_build_object('ok',true,'asset_id',f.id,'asset_revision',f.revision,'drive_file_id',f.drive_file_id,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'media_kind',f.media_kind,'n8n_kunde_id',c.n8n_kunde_id,'kunde_email',c.kunde_email,'can_publish',false);
end $$;
revoke all on function sma_private.publication_asset_preview_v1(uuid,text) from public,anon,authenticated;
grant execute on function sma_private.publication_asset_preview_v1(uuid,text) to authenticated;
create or replace function public.sma_publication_asset_preview_v1(p_asset_id uuid,p_revision text)
returns jsonb language sql security invoker set search_path='' as $$ select sma_private.publication_asset_preview_v1(p_asset_id,p_revision); $$;
revoke all on function public.sma_publication_asset_preview_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.sma_publication_asset_preview_v1(uuid,text) to authenticated;
