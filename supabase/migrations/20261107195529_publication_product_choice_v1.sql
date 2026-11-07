-- Offer only matched listings that can be addressed in this customer's public shop.
-- The choice lives in the saved preview input; existing file assignments keep their snapshot.
do $migration$
declare
 ctx regprocedure:='sma_private.publication_product_context_v1(uuid)'::regprocedure;
 files regprocedure:='sma_private.publication_files_request_v1(text,jsonb)'::regprocedure;
 ambiguous text:=$old$return jsonb_build_object('state','ambiguous','asset_id',asset,'asset_revision',selected.revision);$old$;
 assign_link text:=$old$listing:=sma_private.publication_product_context_v1(f.id)->>'product_id';$old$;
 definition text;
begin
 definition:=pg_get_functiondef(ctx);
 if length(definition)-length(replace(definition,ambiguous,''))<>length(ambiguous)
 then raise exception 'PRODUCT_CONTEXT_CHANGED'; end if;
 execute replace(definition,ambiguous,$new$
    resolved:=jsonb_build_object('state','ambiguous','asset_id',asset,'asset_revision',selected.revision);
    if selected.media_kind='video' and customer.shop_oeffentlich then
      declare choices jsonb;
      begin
        select jsonb_agg(to_jsonb(q) order by lower(q.name),q.product_id)
        into choices from (
          select p.sma_produkt_id as product_id,left(trim(p.produkt_name),160) as name,
                 left(trim(coalesce(p.beschreibung,'')),1200) as purpose,left(trim(p.sku),80) as sku
          from public.sma_produkte p
          where p.user_id=owner_id and p.kunde_id=customer.kunde_id and p.aktiv
            and exists(select from jsonb_array_elements(matches) m where
              case when m->>'method'='catalog' then m->>'match_key'='shop:'||p.id
              else lower(trim(p.produkt_name))=lower(trim(m->>'name')) end)
            and sma_private.publication_product_link_available_v1(customer,p.sma_produkt_id)
        ) q;
        if choices is not null then resolved:=resolved||jsonb_build_object('choices',choices); end if;
      end;
    end if;
    return resolved;$new$);

 definition:=pg_get_functiondef(files);
 if length(definition)-length(replace(definition,assign_link,''))<>length(assign_link)
 then raise exception 'PRODUCT_ASSIGNMENT_CHANGED';end if;
 execute replace(definition,assign_link,$new$
    declare
      product_context jsonb:=sma_private.publication_product_context_v1(f.id);
      source_text text:=j.input->>'source_text';
      prefix constant text:='SMA-Produktauswahl (Kunden-/Katalogdaten): ';
      separator constant text:=chr(10)||'Dateiinhalt: ';
      facts jsonb;
      candidate jsonb;
    begin
      if starts_with(source_text,prefix) then
        if strpos(source_text,separator)<=length(prefix) then
          return jsonb_build_object('ok',false,'code','PRODUCT_SELECTION_CHANGED');
        end if;
        begin
          facts:=substring(source_text from length(prefix)+1 for strpos(source_text,separator)-length(prefix)-1)::jsonb;
        exception when invalid_text_representation or numeric_value_out_of_range then
          return jsonb_build_object('ok',false,'code','PRODUCT_SELECTION_CHANGED');
        end;
        if product_context->>'state'='matched' then
          candidate:=product_context;
        else
          select item into candidate from jsonb_array_elements(product_context->'choices') item
            where item->>'product_id'=facts->>'Artikelnummer';
        end if;
        if candidate->>'product_id' is null or facts is distinct from jsonb_build_object(
          'Artikelnummer',candidate->>'product_id','Produkt',candidate->>'name',
          'Thema',coalesce(candidate->>'topic',''),'Einsatzzweck',candidate->>'purpose') then
          return jsonb_build_object('ok',false,'code','PRODUCT_SELECTION_CHANGED');
        end if;
        listing:=candidate->>'product_id';
      else
        listing:=product_context->>'product_id';
      end if;
    end;$new$);
end $migration$;
