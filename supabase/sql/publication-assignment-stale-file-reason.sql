-- SMA publication: distinguish a stale verified_at from an altered media revision.
-- Existing service-only function; no refreshed timestamps, no provider grants.
-- Live DB baseline verified 2026-11-11. Reject changed function source.
do $guard$
begin
 if to_regprocedure('public.sma_publication_assignment_v1(bigint,text,text,text)') is null
   or (select md5(prosrc) from pg_proc where oid='public.sma_publication_assignment_v1(bigint,text,text,text)'::regprocedure)
      is distinct from '874e294631f9b69f3dfa616899438843' then
   raise exception 'PUBLICATION_ASSIGNMENT_SOURCE_CHANGED';
 end if;
end
$guard$;

CREATE OR REPLACE FUNCTION public.sma_publication_assignment_v1(p_customer_id bigint, p_drive_file_id text, p_asset_revision text, p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f sma_private.publication_files_v1%rowtype; a sma_private.publication_assignments_v1%rowtype; j sma_private.publication_previews_v1%rowtype; c public.sma_kunden%rowtype;
begin
 select * into c from public.sma_kunden where id=p_customer_id and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
 if not found then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE'); end if;
 select * into f from sma_private.publication_files_v1 where customer_id=c.id and user_id=c.user_id and drive_file_id=p_drive_file_id and available;
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE'); end if;
 if f.revision is distinct from p_asset_revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED'); end if;
 if f.verified_at<now()-interval '15 minutes' then return jsonb_build_object('ok',false,'code','FILE_REFRESH_REQUIRED'); end if;
 select * into a from sma_private.publication_assignments_v1 where asset_id=f.id and platform=p_platform and asset_revision=f.revision;
 if not found then return jsonb_build_object('ok',false,'code','ASSIGNMENT_UNAVAILABLE'); end if;
 select * into j from sma_private.publication_previews_v1 where id=a.preview_id and user_id=c.user_id and customer_id=c.id and revision=a.preview_revision and status='completed';
 if not found or c.shop_oeffentlich is not true or ('https://sma-automation.com/app/shop.html?shop='||c.shop_slug) is distinct from j.shop_url then return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED'); end if;
 
 if a.draft ? 'product_id' and (jsonb_typeof(a.draft->'product_id') is distinct from 'string'
    or sma_private.publication_product_link_available_v1(c,a.draft->>'product_id') is not true) then
  return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED');
 end if;
 return jsonb_build_object('ok',true,'can_publish',false,'asset_id',f.id,'asset_revision',f.revision,'platform',a.platform,'assignment_revision',a.revision,'preview_id',a.preview_id,'preview_revision',a.preview_revision,'text',a.draft,'shop_url',j.shop_url,'media_kind',f.media_kind,'media_check',sma_private.publication_media_precheck_v1(f,p_platform));
end $function$;

revoke all on function public.sma_publication_assignment_v1(bigint,text,text,text)
 from public,anon,authenticated;
grant execute on function public.sma_publication_assignment_v1(bigint,text,text,text)
 to service_role;
