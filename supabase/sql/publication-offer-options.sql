-- Provider-specific marketing-link candidates for one verified customer-owned video revision.
-- Digistore24 URLs are separate records: never overwrite Shopify's existing kauf_url.
-- This provides readable options only; it never edits a caption, approves a post, opens
-- a checkout, performs a provider request, or activates a customer.

create table sma_private.publication_digistore_offers_v1 (
 product_row_id bigint primary key references public.sma_produkte(id) on delete cascade,
 customer_id bigint not null references public.sma_kunden(id),
 user_id uuid not null,
 digistore_product_id bigint not null check (digistore_product_id > 0),
 affiliate_id text not null check (affiliate_id ~ '^[A-Za-z0-9._-]{1,80}$'),
 promo_url text not null check (
   length(promo_url) <= 500 and
   promo_url ~ '^https://www[.]checkout-ds24[.]com/redir/[1-9][0-9]{0,11}/[A-Za-z0-9._-]{1,80}(/[A-Za-z0-9._-]{1,127})?/?$'
 ),
 verification_reference text not null check (length(btrim(verification_reference)) between 8 and 180),
 verified_at timestamptz not null,
 enabled boolean not null default false
);
alter table sma_private.publication_digistore_offers_v1 enable row level security;
revoke all on sma_private.publication_digistore_offers_v1 from public, anon, authenticated, service_role;
-- No client-accessible write path. Privileged importer/operator verification must
-- be implemented and separately authorized before adding real Digistore24 records.

create function sma_private.publication_offer_options_private_v1(p_asset uuid, p_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $body$
declare
 actor uuid := auth.uid();
 customer public.sma_kunden%rowtype;
 media sma_private.publication_files_v1%rowtype;
 product_context jsonb;
 article public.sma_produkte%rowtype;
 ds sma_private.publication_digistore_offers_v1%rowtype;
 article_count integer;
 article_pk bigint;
 offers jsonb := '[]'::jsonb;
begin
 if actor is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED','can_publish',false); end if;
 if (select count(*) from public.sma_kunden where user_id=actor)<>1 then
   return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE','can_publish',false);
 end if;
 select * into customer from public.sma_kunden
   where user_id=actor and aktiv and (demo_delta_aktiv or zahlung_bestaetigt);
 if not found then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE','can_publish',false); end if;
 select * into media from sma_private.publication_files_v1
   where id=p_asset and user_id=actor and customer_id=customer.id and available
     and media_kind='video';
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE','can_publish',false); end if;
 if media.revision is distinct from p_revision then
   return jsonb_build_object('ok',false,'code','FILE_CHANGED','can_publish',false);
 end if;

 product_context := sma_private.publication_product_context_v1(media.id);
 if product_context->>'state' is distinct from 'matched'
    or product_context->>'asset_revision' is distinct from media.revision
    or nullif(btrim(product_context->>'name'),'') is null then
   return jsonb_build_object('ok',true,'state','NO_CONFIRMED_PRODUCT','offers',offers,
     'can_publish',false,'requires_customer_selection',true);
 end if;

 -- The product facts are file/revision-scoped. Do not guess a catalogue record
 -- from fuzzy similarity, another tenant, an unverified label, or a stale SKU.
 select count(*),min(p.id) into article_count,article_pk from public.sma_produkte p
   where p.user_id=actor and p.kunde_id=customer.kunde_id and p.aktiv
     and lower(btrim(p.produkt_name))=lower(btrim(product_context->>'name'));
 if article_count<>1 then
   return jsonb_build_object('ok',true,'state','NO_UNIQUE_CATALOG_MATCH','offers',offers,
     'can_publish',false,'requires_customer_selection',true);
 end if;
 select * into article from public.sma_produkte where id=article_pk;
 if product_context->>'product_id' is not null
    and product_context->>'product_id' is distinct from article.sma_produkt_id then
   return jsonb_build_object('ok',true,'state','PRODUCT_BINDING_CHANGED','offers',offers,
     'can_publish',false,'requires_customer_selection',true);
 end if;

 if sma_private.publication_product_link_available_v1(customer,article.sma_produkt_id) then
   offers:=offers||jsonb_build_array(jsonb_build_object('provider','shopify',
     'label','SMA-Shop · Shopify','product_id',article.sma_produkt_id,
     'url','https://sma-automation.com/app/shop.html?shop='||customer.shop_slug||'&produkt='||article.sma_produkt_id,
     'requires_customer_approval',true));
 end if;

 -- A verified Digistore24 promotion belongs to this exact tenant and product,
 -- and is separate from Shopify. Expired, disabled, malformed or mismatching
 -- affiliate/provider IDs cannot become a customer-visible link.
 select * into ds from sma_private.publication_digistore_offers_v1 d
   where d.product_row_id=article.id and d.customer_id=customer.id and d.user_id=actor
     and article.digistore24_aktiv is true and d.enabled is true
     and d.verified_at between now()-interval '30 days' and now()
     and split_part(d.promo_url,'/',5)=d.digistore_product_id::text
     and split_part(d.promo_url,'/',6)=d.affiliate_id;
 if found then
   offers:=offers||jsonb_build_array(jsonb_build_object('provider','digistore24',
     'label','Digistore24 · bestätigter Promolink','product_id',article.sma_produkt_id,
     'url',ds.promo_url,'requires_customer_approval',true));
 end if;
 return jsonb_build_object('ok',true,
   'state',case when jsonb_array_length(offers)>0 then 'OFFER_OPTIONS' else 'NO_VERIFIED_OFFERS' end,
   'offers',offers,'can_publish',false,'requires_customer_selection',true,
   'asset_revision',media.revision);
end $body$;

revoke all on function sma_private.publication_offer_options_private_v1(uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function sma_private.publication_offer_options_private_v1(uuid,text) to authenticated;

create function public.sma_publication_offer_options_v1(p_asset uuid,p_revision text)
returns jsonb language sql stable security invoker set search_path='' as $wrapper$
 select sma_private.publication_offer_options_private_v1(p_asset,p_revision);
$wrapper$;
revoke all on function public.sma_publication_offer_options_v1(uuid,text)
 from public,anon,service_role;
grant execute on function public.sma_publication_offer_options_v1(uuid,text) to authenticated;