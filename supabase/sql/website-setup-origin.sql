-- Registered custom hosts and image hosts follow the same current-owner gate.
-- The canonical SMA public page and non-browser public API consumers remain supported.
create function sma_private.website_public_with_origin_v1(p_site_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare origin text;
begin
 begin origin:=nullif(current_setting('request.headers',true),'')::jsonb->>'origin';
 exception when others then return jsonb_build_object('ok',false,'code','NOT_AVAILABLE');end;
 if origin is not null and origin<>'https://sma-automation.com' then
  if origin !~ '^https://[a-z0-9.-]+$' or not sma_private.website_origin_v1(substring(origin from 9),p_site_id) then
   return jsonb_build_object('ok',false,'code','NOT_AVAILABLE');
  end if;
 end if;
 return sma_private.customer_website_public_v1(p_site_id);
end $$;
revoke all on function sma_private.website_public_with_origin_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function sma_private.website_public_with_origin_v1(uuid) to anon,authenticated;
create or replace function public.sma_customer_website_public_v1(p_site_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select sma_private.website_public_with_origin_v1(p_site_id)$$;
