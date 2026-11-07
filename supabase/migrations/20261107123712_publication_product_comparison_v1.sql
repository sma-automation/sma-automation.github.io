-- Reuse byte-bound product facts when a trusted reviewer checks a saved original-video draft.
-- Only the existing service comparison can consume this projection.
create function sma_private.publication_comparison_product_v1(f sma_private.publication_files_v1)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when count(*)=1 then (jsonb_agg(jsonb_build_object(
   'name',p.name,'topic',p.topic,'purpose',p.purpose,'profile_id',p.id)))->0 end
 from sma_private.publication_files_v1 actual
 join public.sma_kunden c on c.id=actual.customer_id and c.user_id=actual.user_id
 join sma_private.publication_product_sources_v1 s on s.customer_id=c.id and s.user_id=c.user_id
  and s.sha256=split_part(actual.revision,':',2)
 join sma_private.publication_product_profiles_v1 p on p.id=s.product_id and p.customer_id=c.id and p.user_id=c.user_id
 where actual.id=f.id and actual.user_id=f.user_id and actual.customer_id=f.customer_id
  and actual.available and actual.media_kind='video' and actual.revision=f.revision
  and actual.revision ~ '^sha256:[a-f0-9]{64}:[0-9]+$' and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt);
$$;
revoke all on function sma_private.publication_comparison_product_v1(sma_private.publication_files_v1) from public,anon,authenticated;
grant execute on function sma_private.publication_comparison_product_v1(sma_private.publication_files_v1) to service_role;

do $$
declare
 ctx regprocedure:='public.sma_publication_comparison_context_v1(jsonb)'::regprocedure;
 rpc regprocedure:='public.sma_publication_comparison_v1(text,jsonb,uuid,jsonb)'::regprocedure;
 media regprocedure:='sma_private.publication_comparison_media_v1(jsonb,jsonb,jsonb)'::regprocedure;
 definition text;
 context_return text:=$old$return jsonb_build_object('ok',true,'policy_version','portal-content-2026-11-03.1','source_fingerprint',fingerprint,'binding',b,'draft',r->'text','analysis',a,$old$;
 scope_guard text:=$old$or p_result->>'scope' is distinct from 'stored_video_observations_ocr_transcript'$old$;
 projection text:=$old$if r->>'scope'='reviewed_export_reference_v1' then$old$;
begin
 if (select count(*) from pg_proc where (oid=ctx and md5(prosrc)='8625eee94608201cb24fcdb3a7861d9a')
  or (oid=rpc and md5(prosrc)='d9914f0133db74ae4db531e692f8e150')
  or (oid=media and md5(prosrc)='56ebbd1de3d1bd81a3a3a7fb2f070597'))<>3 then
  raise exception 'PRODUCT_COMPARISON_BASELINE_CHANGED';
 end if;
 definition:=replace(pg_get_functiondef(ctx),'fingerprint text;','fingerprint text; product jsonb;');
 execute replace(definition,context_return,$new$product:=sma_private.publication_comparison_product_v1(f);
 if product is not null then
  fingerprint:=encode(sha256(convert_to(jsonb_build_array(fingerprint,product)::text,'UTF8')),'hex');
 end if;
 $new$||context_return||$new$'product_context',product,$new$);
 -- The standard n8n result keeps its original visual-only scope and result validation.
 execute replace(pg_get_functiondef(rpc),scope_guard,$new$or (p_result->>'scope' is distinct from 'stored_video_observations_ocr_transcript'
  and (p_result->>'scope' is distinct from 'assisted_video_and_product_facts'
   or jsonb_typeof(c->'product_context') is distinct from 'object'))$new$);
 execute replace(pg_get_functiondef(media),projection,$new$if r->>'scope'='assisted_video_and_product_facts' then
  message:=case r->>'verdict' when 'consistent_with_evidence'
   then 'Assistenzprüfung: Der Beitrag passt zu den Video-Beobachtungen und den bestätigten Produktangaben.'
   when 'needs_review' then 'Assistenzprüfung: Bitte prüfe die folgenden Aussagen im Beitrag.'
   else 'Assistenzprüfung: Die Video-Beobachtungen und Produktangaben reichen für diesen Text noch nicht aus.' end;
 elsif r->>'scope'='reviewed_export_reference_v1' then$new$);
end $$;
