-- Only the public shop's own active, uniquely addressable listing can be linked.
create function sma_private.publication_product_link_available_v1(c public.sma_kunden, product_id text)
returns boolean language sql stable security invoker set search_path='' as $$
 select c.shop_oeffentlich is true and c.aktiv and (c.zahlung_bestaetigt or c.demo_delta_aktiv)
   and length(c.shop_slug)<=63 and c.shop_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   and product_id ~ '^[A-Za-z0-9_-]{1,80}$'
   and 1=(select count(*) from public.sma_kunden s where s.shop_oeffentlich and s.shop_slug=c.shop_slug)
   and 1=(select count(*) from public.sma_produkte p
     where p.user_id=c.user_id and p.kunde_id=c.kunde_id and p.aktiv and p.sma_produkt_id=product_id);
$$;
revoke all on function sma_private.publication_product_link_available_v1(public.sma_kunden,text)
 from public,anon,authenticated;
grant execute on function sma_private.publication_product_link_available_v1(public.sma_kunden,text) to service_role;

do $$
declare
 ctx regprocedure:='sma_private.publication_product_context_v1(uuid)'::regprocedure;
 files regprocedure:='sma_private.publication_files_request_v1(text,jsonb)'::regprocedure;
 assignment regprocedure:='public.sma_publication_assignment_v1(bigint,text,text,text)'::regprocedure;
 definition text;
 match_key text:=$old$'method',method$old$;
 matched text:='resolved:=matches->0;';
 write_assignment text:='insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft)';
 finish_assignment text:=$old$'assignment_revision',b.revision);
end$old$;
 read_assignment text:=$old$return jsonb_build_object('ok',true,'can_publish',false,'asset_id',f.id$old$;
begin
 definition:=pg_get_functiondef(ctx);
 if strpos(definition,match_key)=0 or strpos(definition,matched)=0 then raise exception 'PRODUCT_CONTEXT_CHANGED'; end if;
 definition:=replace(definition,match_key,match_key||$new$,'match_key',key$new$);
 execute replace(definition,matched,$new$
  resolved:=(matches->0)-'match_key';
  if selected.media_kind='video' then
    declare listing text;
    begin
      -- A catalog match identifies its row even when two products have the same name.
      -- A private profile identifies a listing only through a unique full catalog name.
      select case when count(*)=1 then min(p.sma_produkt_id) end into listing
        from public.sma_produkte p where p.user_id=owner_id and p.kunde_id=customer.kunde_id and p.aktiv
        and case when resolved->>'method'='catalog' then 'shop:'||p.id=(matches->0->>'match_key')
          else lower(trim(p.produkt_name))=lower(trim(resolved->>'name')) end;
      if sma_private.publication_product_link_available_v1(customer,listing) then
        resolved:=resolved||jsonb_build_object('product_id',listing);
      end if;
    end;
  end if;$new$);

 definition:=pg_get_functiondef(files);
 if strpos(definition,write_assignment)=0 or strpos(definition,finish_assignment)=0
    or strpos(definition,$old$if p_action='assign' then$old$)=0 then raise exception 'FILE_ASSIGNMENT_CHANGED'; end if;
 -- Both preview save and assignment write must roll back on a longer product footer.
 definition:=replace(definition,$old$if p_action='assign' then$old$,$new$begin
 if p_action='assign' then$new$);
 definition:=replace(definition,finish_assignment,$new$'assignment_revision',b.revision);
 exception when sqlstate 'SM145' then return jsonb_build_object('ok',false,'code','CAPTION_TOO_LONG');
 end;
end$new$);
 execute replace(definition,write_assignment,$new$
 d:=d-'product_id';
 if f.media_kind='video' then
  declare listing text; shop_footer text; product_footer text; product_caption text;
  begin
   if p_action='save' or (b.preview_id=j.id and b.asset_revision=f.revision) then
    listing:=b.draft->>'product_id';
   else
    listing:=sma_private.publication_product_context_v1(f.id)->>'product_id';
   end if;
   if listing is not null then
    shop_footer:=case when j.input->>'language'='en' then '🛒 Visit our shop: ' else '🛒 Zum Shop: ' end||j.shop_url;
    product_footer:=case when j.input->>'language'='en' then '🛒 View product: ' else '🛒 Zum Produkt: ' end||j.shop_url||'&produkt='||listing;
    -- Refuse malformed templates before persisting any part of an edit.
    if right(d->>'caption',length(shop_footer)+2) is distinct from chr(10)||chr(10)||shop_footer then
     raise exception 'INVALID_SAVED_CAPTION';
    end if;
    product_caption:=left(d->>'caption',-length(shop_footer))||product_footer;
    if octet_length(product_caption)>5000 or (portal='tiktok' and char_length(product_caption)+
      (select count(*) from regexp_split_to_table(product_caption,'') as u(ch) where ascii(ch)>65535)>2200) then
     raise exception using errcode='SM145',message='CAPTION_TOO_LONG';
    end if;
    d:=d||jsonb_build_object('product_id',listing,'caption',product_caption);
   end if;
  end;
 end if;
 $new$||write_assignment);

 definition:=pg_get_functiondef(assignment);
 if strpos(definition,read_assignment)=0 then raise exception 'ASSIGNMENT_HANDOFF_CHANGED'; end if;
 execute replace(definition,read_assignment,$new$
 if a.draft ? 'product_id' and (jsonb_typeof(a.draft->'product_id') is distinct from 'string'
    or sma_private.publication_product_link_available_v1(c,a.draft->>'product_id') is not true) then
  return jsonb_build_object('ok',false,'code','ASSIGNMENT_CHANGED');
 end if;
 $new$||read_assignment);
end $$;
