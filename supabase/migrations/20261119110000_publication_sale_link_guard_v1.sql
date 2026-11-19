-- Sale-only publication product link policy. Does not change the public product catalogue,
-- stored product rows, existing drafts or any checkout/provider execution.
-- Digistore24-only listings are NOT linked via the Shopify-only SMA cart;
-- they need a separate verified Digistore24 destination and provider route.
-- Baseline check prevents silent replacement of a differently modified live policy.
do $guard$
begin
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='sma_private' and p.proname='publication_product_link_available_v1'
       and md5(p.prosrc)='81064568bd18e5675de8c37d2ba63d56')<>1 then
   raise exception 'SALE_LINK_POLICY_BASELINE_CHANGED';
 end if;
end $guard$;

create or replace function sma_private.publication_product_link_available_v1(c public.sma_kunden, product_id text)
returns boolean language sql stable security invoker set search_path='' as $$
 select c.shop_oeffentlich is true and c.aktiv and (c.zahlung_bestaetigt or c.demo_delta_aktiv)
   and length(c.shop_slug)<=63 and c.shop_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   and product_id ~ '^[A-Za-z0-9_-]{1,80}$'
   and 1=(select count(*) from public.sma_kunden s where s.shop_oeffentlich and s.shop_slug=c.shop_slug)
   and 1=(select count(*) from public.sma_produkte p
     where p.user_id=c.user_id and p.kunde_id=c.kunde_id and p.aktiv and p.sma_produkt_id=product_id
       and p.shopify_aktiv is true and p.bestand>0
       and p.preis is not null and p.preis>=0 and p.waehrung ~ '^[A-Z]{3}
$$;
       -- The public checkout accepts only the exact owner's active Shopify cart variant URL.
       and p.kauf_url ~ '^https://[a-z0-9][a-z0-9-]*\.myshopify\.com/cart/[1-9][0-9]{5,24}:[1-9][0-9]*/?
$$;
       and 1=(select count(*) from public.sma_shopify_konten sk
         where sk.sma_kunden_id=c.id and sk.aktiv is true
           and nullif(btrim(sk.markt_konto_id),'') is not null
           and sk.shopify_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com
$$;
           and starts_with(p.kauf_url,'https://'||sk.shopify_domain||'/cart/')));
$$;
revoke all on function sma_private.publication_product_link_available_v1(public.sma_kunden,text)
 from public,anon,authenticated;
grant execute on function sma_private.publication_product_link_available_v1(public.sma_kunden,text) to service_role;
