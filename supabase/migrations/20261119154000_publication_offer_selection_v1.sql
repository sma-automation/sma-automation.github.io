-- Deliberately selected sale link for one revision-bound portal draft.
-- No provider request, checkout, payment, publication, account activation or new media processing.
-- The Digistore24 source remains separate from the Shopify catalogue URL.
create function sma_private.publication_digistore_offer_valid_v1(
 p_file sma_private.publication_files_v1,p_product_id text,p_url text
) returns boolean language sql stable security definer set search_path='' as $sql$
 select (p_file).id is not null and (p_file).available and (p_file).media_kind='video'
   and (p_file).revision is not null
   and p_product_id ~ '^[A-Za-z0-9_-]{1,80}$'
   and (select count(*)=1
     from sma_private.publication_files_v1 f
     join public.sma_kunden c on c.id=f.customer_id and c.user_id=f.user_id
     join public.sma_produkte p on p.user_id=c.user_id and p.kunde_id=c.kunde_id
       and p.sma_produkt_id=p_product_id and p.aktiv is true and p.digistore24_aktiv is true
     join sma_private.publication_digistore_offers_v1 d on d.product_row_id=p.id
       and d.customer_id=c.id and d.user_id=c.user_id
     where f.id=(p_file).id and f.user_id=(p_file).user_id
       and f.customer_id=(p_file).customer_id and f.revision=(p_file).revision and f.available
       and c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
       and d.enabled is true and d.promo_url=p_url
       and d.verified_at between now()-interval '30 days' and now()
       and split_part(d.promo_url,'/',5)=d.digistore_product_id::text
       and split_part(d.promo_url,'/',6)=d.affiliate_id);
$sql$;
revoke all on function sma_private.publication_digistore_offer_valid_v1(
 sma_private.publication_files_v1,text,text) from public,anon,authenticated,service_role;
grant execute on function sma_private.publication_digistore_offer_valid_v1(
 sma_private.publication_files_v1,text,text) to service_role;

create function public.sma_publication_offer_selection_v1(
 p_asset uuid,p_asset_revision text,p_platform text,p_assignment_revision integer,
 p_provider text,p_url text
) returns jsonb language plpgsql security definer set search_path='' as $body$
declare
 actor uuid:=auth.uid();
 c public.sma_kunden%rowtype;
 f sma_private.publication_files_v1%rowtype;
 b sma_private.publication_assignments_v1%rowtype;
 j sma_private.publication_previews_v1%rowtype;
 opts jsonb; chosen jsonb; result_draft jsonb; original text; before_footer text;
 chosen_footer text; rebuilt text; tags text; lang text;
begin
 if actor is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED','can_publish',false); end if;
 if p_provider is null or p_platform is null or p_provider not in ('shopify','digistore24') or p_platform not in ('youtube','tiktok')
   or p_asset is null or p_asset_revision is null or p_url is null
   or length(p_url)>500 or p_assignment_revision is null or p_assignment_revision<1
   then return jsonb_build_object('ok',false,'code','INVALID_INPUT','can_publish',false); end if;
 if (select count(*) from public.sma_kunden where user_id=actor)<>1 then
   return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE','can_publish',false); end if;
 select * into c from public.sma_kunden where user_id=actor and aktiv
   and (demo_delta_aktiv or zahlung_bestaetigt);
 if not found then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE','can_publish',false); end if;
 select * into f from sma_private.publication_files_v1
   where id=p_asset and user_id=actor and customer_id=c.id and available and media_kind='video'
   for update;
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE','can_publish',false); end if;
 if f.revision is distinct from p_asset_revision then
   return jsonb_build_object('ok',false,'code','FILE_CHANGED','can_publish',false); end if;
 if f.verified_at is null or f.verified_at<now()-interval '15 minutes' then
   return jsonb_build_object('ok',false,'code','FILE_REFRESH_REQUIRED','can_publish',false); end if;
 select * into b from sma_private.publication_assignments_v1
   where asset_id=f.id and platform=p_platform for update;
 if not found or b.asset_revision is distinct from f.revision then
   return jsonb_build_object('ok',false,'code','ASSIGNMENT_UNAVAILABLE','can_publish',false); end if;
 if b.revision is distinct from p_assignment_revision then
   return jsonb_build_object('ok',false,'code','ASSIGNMENT_CONFLICT','can_publish',false); end if;
 select * into j from sma_private.publication_previews_v1 where id=b.preview_id
   and user_id=actor and customer_id=c.id for update;
 if not found or j.status<>'completed' or j.preview->'can_publish' is distinct from 'false'::jsonb
   or j.revision is distinct from b.preview_revision or j.input->>'media_kind'<>'video'
   or j.input->>'language' not in ('de','en')
   or c.shop_oeffentlich is not true
   or ('https://sma-automation.com/app/shop.html?shop='||c.shop_slug) is distinct from j.shop_url
   then return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED','can_publish',false); end if;
 opts:=sma_private.publication_offer_options_private_v1(f.id,f.revision);
 if opts->'ok' is distinct from 'true'::jsonb or opts->>'state'<>'OFFER_OPTIONS'
   then return jsonb_build_object('ok',false,'code','OFFER_UNAVAILABLE','can_publish',false); end if;
 select o into chosen from jsonb_array_elements(opts->'offers') o
   where o->>'provider'=p_provider and o->>'url'=p_url
     and o->'requires_customer_approval'='true'::jsonb;
 if chosen is null or chosen->>'product_id' is null
   then return jsonb_build_object('ok',false,'code','OFFER_CHANGED','can_publish',false); end if;
 if p_provider='digistore24' and sma_private.publication_digistore_offer_valid_v1(
      f,chosen->>'product_id',p_url) is not true
   then return jsonb_build_object('ok',false,'code','OFFER_CHANGED','can_publish',false); end if;

 result_draft:=b.draft; lang:=j.input->>'language';
 if result_draft->>'platform' is distinct from p_platform
   or jsonb_typeof(result_draft->'hashtags') is distinct from 'array'
   or jsonb_typeof(result_draft->'review_notes') is distinct from 'array'
   or jsonb_typeof(result_draft->'body') is distinct from 'string'
   or jsonb_typeof(result_draft->'caption') is distinct from 'string'
   or length(result_draft->>'body') not between 10 and 1200
   then return jsonb_build_object('ok',false,'code','SAVED_TEXT_INVALID','can_publish',false); end if;
 if exists(select from jsonb_array_elements(result_draft->'hashtags') AS tags(value)
   where jsonb_typeof(tags.value)<>'string') then
   return jsonb_build_object('ok',false,'code','SAVED_TEXT_INVALID','can_publish',false); end if;
 select string_agg('#'||tag,' ' order by pos) into tags
   from jsonb_array_elements_text(result_draft->'hashtags') with ordinality t(tag,pos);
 original:=concat_ws(E'\n\n',result_draft->>'body',nullif(tags,''));
 before_footer:=case
   when result_draft->>'offer_provider'='digistore24' then
     (case when lang='en' then '🛒 View offer: ' else '🛒 Zum Angebot: ' end)||
        coalesce(result_draft->>'offer_url','')
   when result_draft?'product_id' then
     (case when lang='en' then '🛒 View product: ' else '🛒 Zum Produkt: ' end)||
       j.shop_url||'&produkt='||(result_draft->>'product_id')
   else (case when lang='en' then '🛒 Visit our shop: ' else '🛒 Zum Shop: ' end)||j.shop_url
 end;
 if result_draft->>'caption' is distinct from original||E'\n\n'||before_footer then
   return jsonb_build_object('ok',false,'code','SAVED_TEXT_INVALID','can_publish',false); end if;
 chosen_footer:=case
   when p_provider='shopify' then
     (case when lang='en' then '🛒 View product: ' else '🛒 Zum Produkt: ' end)||p_url
   else
     (case when lang='en' then '🛒 View offer: ' else '🛒 Zum Angebot: ' end)||p_url
 end;
 rebuilt:=original||E'\n\n'||chosen_footer;
 if octet_length(rebuilt)>5000 or (p_platform='tiktok' and
   char_length(rebuilt)+(select count(*) from regexp_split_to_table(rebuilt,'') t(c) where ascii(c)>65535)>2200)
   then return jsonb_build_object('ok',false,'code','CAPTION_TOO_LONG','can_publish',false); end if;
 result_draft:=result_draft-'product_id'-'offer_provider'-'offer_url'-'offer_product_id';
 if p_provider='shopify' then
   result_draft:=result_draft||jsonb_build_object('product_id',chosen->>'product_id','caption',rebuilt);
 else
   result_draft:=result_draft||jsonb_build_object('offer_provider','digistore24',
     'offer_url',p_url,'offer_product_id',chosen->>'product_id','caption',rebuilt);
 end if;
 if result_draft=b.draft then return jsonb_build_object('ok',true,'status','completed',
   'id',j.id,'input',j.input,'preview',jsonb_set(j.preview,'{drafts}',jsonb_build_array(b.draft)),
   'revision',j.revision,'assignment_revision',b.revision,'can_publish',false); end if;
 update sma_private.publication_assignments_v1
   set draft=result_draft,revision=revision+1,updated_at=now()
   where asset_id=f.id and platform=p_platform and revision=p_assignment_revision
   returning * into b;
 if not found then return jsonb_build_object('ok',false,'code','ASSIGNMENT_CONFLICT','can_publish',false); end if;
 return jsonb_build_object('ok',true,'status','completed','id',j.id,'input',j.input,
   'preview',jsonb_set(j.preview,'{drafts}',jsonb_build_array(b.draft)),
   'revision',j.revision,'assignment_revision',b.revision,'can_publish',false,
   'offer_link_available',true);
end $body$;
revoke all on function public.sma_publication_offer_selection_v1(uuid,text,text,integer,text,text)
 from public,anon,service_role;
grant execute on function public.sma_publication_offer_selection_v1(uuid,text,text,integer,text,text)
 to authenticated;

-- Augment the pre-existing draft save/lookup and provider handoff atomically.
-- Preserve historical migrations and reject a changed live baseline.
do $patch$
declare
 fn regprocedure:='sma_private.publication_files_request_v1(text,jsonb)'::regprocedure;
 handoff regprocedure:='public.sma_publication_assignment_v1(bigint,text,text,text)'::regprocedure;
 definition text; marker text;
 suffix text; cleanup text;
begin
 if (select count(*) from pg_proc where oid in (fn,handoff))<>2
 then raise exception 'OFFER_SELECTION_BASELINE_CHANGED'; end if;
 -- The exact structural insertion markers below must still match the installed definitions.

 definition:=pg_get_functiondef(fn);
 suffix:=$old$old_suffix:=case when d?'product_id' then$old$;
 if strpos(definition,suffix)=0 then raise exception 'OFFER_LINK_EDIT_CHANGED'; end if;
 definition:=replace(definition,suffix,$new$old_suffix:=case
    when d->>'offer_provider'='digistore24' then
      (case when j.input->>'language'='en' then '🛒 View offer: ' else '🛒 Zum Angebot: ' end)||coalesce(d->>'offer_url','')
    when d?'product_id' then$new$);
 cleanup:=$old$d:=d-'product_id';$old$;
 if length(definition)-length(replace(definition,cleanup,''))<>length(cleanup)
 then raise exception 'OFFER_LINK_CLEANUP_CHANGED'; end if;
 definition:=replace(definition,cleanup,$new$d:=d-'product_id'-'offer_provider'-'offer_url'-'offer_product_id';$new$);

 marker:=$old$ if link_only and d=b.draft then$old$;
 if strpos(definition,marker)=0 then raise exception 'OFFER_SAVE_INSERT_CHANGED'; end if;
 definition:=replace(definition,marker,$new$
 if p_action='save' and not(p_input?'link_target') and b.draft->>'offer_provider'='digistore24' then
  declare shop_footer text; new_footer text; new_caption text;
  begin
   if sma_private.publication_digistore_offer_valid_v1(
     f,b.draft->>'offer_product_id',b.draft->>'offer_url') is not true then
    return jsonb_build_object('ok',false,'code','PRODUCT_LINK_UNAVAILABLE');
   end if;
   shop_footer:=(case when j.input->>'language'='en' then '🛒 Visit our shop: ' else '🛒 Zum Shop: ' end)||j.shop_url;
   new_footer:=(case when j.input->>'language'='en' then '🛒 View offer: ' else '🛒 Zum Angebot: ' end)||b.draft->>'offer_url';
   if d->>'product_id' is not null or right(d->>'caption',length(shop_footer)) is distinct from shop_footer then
    return jsonb_build_object('ok',false,'code','INVALID_EDIT');
   end if;
   new_caption:=left(d->>'caption',-length(shop_footer))||new_footer;
   if octet_length(new_caption)>5000 or (portal='tiktok' and
       char_length(new_caption)+(select count(*) from regexp_split_to_table(new_caption,'') t(ch)
         where ascii(ch)>65535)>2200) then
    return jsonb_build_object('ok',false,'code','CAPTION_TOO_LONG');
   end if;
   d:=d||jsonb_build_object('offer_provider','digistore24',
     'offer_url',b.draft->>'offer_url','offer_product_id',b.draft->>'offer_product_id',
     'caption',new_caption);
  end;
 end if;
 $new$||marker);
 marker:=$old$'product_link_available',case when b.draft?'product_id' then$old$;
 if length(definition)-length(replace(definition,marker,''))<>3*length(marker)
 then raise exception 'OFFER_LOOKUP_BASELINE_CHANGED'; end if;
 definition:=replace(definition,marker,$new$'offer_link_available',case when b.draft->>'offer_provider'='digistore24' then
   sma_private.publication_digistore_offer_valid_v1(f,b.draft->>'offer_product_id',b.draft->>'offer_url') end,
  $new$||marker);
 execute definition;

 definition:=pg_get_functiondef(handoff);
 marker:=$old$ return jsonb_build_object('ok',true,'can_publish',false,'asset_id',f.id$old$;
 if strpos(definition,marker)=0 then raise exception 'OFFER_HANDOFF_BASELINE_CHANGED'; end if;
 execute replace(definition,marker,$new$
 if a.draft->>'offer_provider'='digistore24' then
  if a.draft?'product_id' or a.draft->>'offer_url' is null
     or sma_private.publication_digistore_offer_valid_v1(f,a.draft->>'offer_product_id',a.draft->>'offer_url') is not true then
   return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED');
  end if;
 elsif a.draft?'offer_provider' or a.draft?'offer_url' or a.draft?'offer_product_id' then
  return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED');
 end if;
 $new$||marker);
end $patch$;
