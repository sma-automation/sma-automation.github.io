-- Read only listings that the customer's public shop can resolve unambiguously.
create function sma_private.publication_catalog_search_v1(
 c public.sma_kunden, term text, after_id text, exact_id text
) returns table(product_id text,name text,sku text,purpose text)
language sql stable security invoker set search_path='' as $$
 select p.sma_produkt_id,left(trim(p.produkt_name),160),left(trim(p.sku),80),left(trim(coalesce(p.beschreibung,'')),1200)
 from public.sma_produkte p
 where p.user_id=c.user_id and p.kunde_id=c.kunde_id and p.aktiv and nullif(trim(p.produkt_name),'') is not null
   and (exact_id is null or p.sma_produkt_id=exact_id)
   and (after_id is null or p.sma_produkt_id collate "C">after_id collate "C")
   and (term is null or strpos(lower(p.produkt_name),lower(term))>0 or strpos(lower(p.sku),lower(term))>0
        or strpos(lower(p.sma_produkt_id),lower(term))>0)
   and sma_private.publication_product_link_available_v1(c,p.sma_produkt_id)
 order by p.sma_produkt_id collate "C" limit 11;
$$;
revoke all on function sma_private.publication_catalog_search_v1(public.sma_kunden,text,text,text)
 from public,anon,authenticated,service_role;

do $migration$
declare
 rpc regprocedure:='sma_private.publication_files_request_v1(text,jsonb)'::regprocedure;
 allowed text:=$old$p_action not in ('get','assign','save','check')$old$;
 checked_file text:=$old$if p_action='check' then$old$;
 prefix_decl text:=$old$prefix constant text:='SMA-Produktauswahl (Kunden-/Katalogdaten): ';$old$;
 parse_facts text:='if starts_with(source_text,prefix) then';
 select_match text:=$old$if product_context->>'state'='matched' then$old$;
 definition text:=pg_get_functiondef(rpc);
 marker text;
begin
 foreach marker in array array[allowed,checked_file,prefix_decl,parse_facts,select_match] loop
  if length(definition)-length(replace(definition,marker,''))<>length(marker) then
   raise exception 'PUBLICATION_CATALOG_BASELINE_CHANGED';
  end if;
 end loop;
 definition:=replace(definition,allowed,$new$p_action not in ('get','assign','save','check','catalog_search')$new$);
 definition:=replace(definition,checked_file,$new$if p_action='catalog_search' then
  if p_input->>'asset_revision' is distinct from f.revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED'); end if;
  if f.media_kind<>'video' or sma_private.publication_product_context_v1(f.id) is not null then
   return jsonb_build_object('ok',false,'code','PRODUCT_SELECTION_CHANGED');
  end if;
  if c.shop_oeffentlich is not true then return jsonb_build_object('ok',false,'code','PUBLIC_SHOP_REQUIRED'); end if;
  if exists(select from jsonb_object_keys(p_input) k where k not in ('asset_id','asset_revision','platform','query','after','product_id'))
   or (p_input?'product_id')=(p_input?'query')
   or (p_input?'product_id' and (jsonb_typeof(p_input->'product_id')<>'string' or (p_input->>'product_id')!~'^[A-Za-z0-9_-]{1,80}$' or p_input?'after'))
   or (p_input?'query' and (jsonb_typeof(p_input->'query')<>'string' or length(p_input->>'query')>160))
   or (p_input?'after' and (jsonb_typeof(p_input->'after')<>'string' or (p_input->>'after')!~'^[A-Za-z0-9_-]{1,80}$')) then
   return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.product_id collate "C"),'[]') into items
   from sma_private.publication_catalog_search_v1(c,nullif(trim(p_input->>'query'),''),p_input->>'after',p_input->>'product_id') p;
  return jsonb_build_object('ok',true,'choices',items-10,'more',jsonb_array_length(items)>10);
 end if;
 $new$||checked_file);
 definition:=replace(definition,prefix_decl,$new$prefix text:='SMA-Produktauswahl (Kunden-/Katalogdaten): ';
      catalog_prefix constant text:='SMA-Artikelauswahl aus dem Shop: ';$new$);
 definition:=replace(definition,parse_facts,'if starts_with(source_text,catalog_prefix) then prefix:=catalog_prefix; end if;
      '||parse_facts);
 -- A manual catalogue selection applies only while this video has no product evidence.
 execute replace(definition,select_match,$new$if prefix=catalog_prefix then
          if product_context is null and jsonb_typeof(facts->'Artikelnummer')='string' then
            select to_jsonb(p) into candidate from sma_private.publication_catalog_search_v1(c,null,null,facts->>'Artikelnummer') p;
          end if;
        elsif product_context->>'state'='matched' then$new$);
end $migration$;
