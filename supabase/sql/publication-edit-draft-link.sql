-- Apply explicit link edits to the locked file/portal assignment. Text-only saves keep their old contract.
do $migration$
declare
 rpc regprocedure:='sma_private.publication_files_request_v1(text,jsonb)'::regprocedure;
 definition text:=pg_get_functiondef(rpc);
 vars text:='items jsonb; d jsonb;';
 save_start text:=$old$  select jsonb_agg(jsonb_build_object('platform',x->>'platform','title',case when x->>'platform'=portal$old$;
 save_end text:='  select * into j from sma_private.publication_previews_v1 where id=j.id;';
 choose text:=$old$if p_action='save' or (b.preview_id=j.id and b.asset_revision=f.revision) then$old$;
 reader text:=$old$'preview',jsonb_set(j.preview,'{drafts}',jsonb_build_array(b.draft))$old$;
 cleanup text:=$old$d:=d-'product_id';$old$;
 write_assignment text:='insert into sma_private.publication_assignments_v1(asset_id,platform,preview_id,preview_revision,asset_revision,draft)';
 marker text;
begin
 foreach marker in array array[vars,save_start,save_end,choose,reader,cleanup,write_assignment] loop
  if length(definition)-length(replace(definition,marker,''))<>length(marker) then
   raise exception 'PUBLICATION_LINK_EDIT_BASELINE_CHANGED';
  end if;
 end loop;
 definition:=replace(definition,vars,vars||' edited_listing text; link_only boolean:=false;');
 definition:=replace(definition,reader,$new$'link_product',case when b.draft->>'product_id' is not null then
   (select to_jsonb(p) from sma_private.publication_catalog_search_v1(c,null,null,b.draft->>'product_id') p) end,$new$||reader);
 definition:=replace(definition,save_start,$new$  if b.asset_revision is distinct from f.revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED'); end if;
  if p_input?'link_target' then
   if f.media_kind<>'video' or j.status<>'completed' or j.preview->'can_publish' is distinct from 'false'::jsonb
    then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
   if p_input->'link_target'<>'null'::jsonb then
    declare target jsonb:=p_input->'link_target'; ctx jsonb; candidate jsonb; mode text;
    begin
     if jsonb_typeof(target)<>'object' or jsonb_typeof(target->'product_id') is distinct from 'string'
       or (target->>'product_id')!~'^[A-Za-z0-9_-]{1,80}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT'); end if;
     ctx:=sma_private.publication_product_context_v1(f.id);
     if ctx is null then
      mode:='catalog';
      select to_jsonb(p) into candidate from sma_private.publication_catalog_search_v1(c,null,null,target->>'product_id') p;
     elsif ctx->>'state'='matched' then mode:='matched'; candidate:=ctx;
     elsif ctx->>'state'='ambiguous' then
      mode:='choice';
      select item into candidate from jsonb_array_elements(ctx->'choices') item where item->>'product_id'=target->>'product_id';
     end if;
     if candidate->>'product_id' is null or target is distinct from jsonb_build_object('source',mode,
       'product_id',candidate->>'product_id','name',candidate->>'name','purpose',candidate->>'purpose') then
      return jsonb_build_object('ok',false,'code','PRODUCT_SELECTION_CHANGED');
     end if;
     edited_listing:=candidate->>'product_id';
    end;
   end if;
   -- Change only the assignment when all editorial fields are byte-for-byte the saved ones.
   link_only:=p_input->'title'=b.draft->'title' and p_input->'body'=b.draft->'body'
     and (not (p_input?'hashtags') or p_input->'hashtags'=b.draft->'hashtags');
  end if;
  if link_only is not true then
$new$||save_start);
 definition:=replace(definition,save_end,save_end||'
  end if;');
 definition:=replace(definition,choose,$new$if p_action='save' and p_input?'link_target' then
    listing:=edited_listing;
   elsif p_action='save' or (b.preview_id=j.id and b.asset_revision=f.revision) then$new$);
 -- Link-only edits retain the archived file draft, including its review notes and formatting.
 definition:=replace(definition,cleanup,$new$if link_only then
  declare shop_suffix text; old_suffix text;
  begin
   d:=b.draft;
   shop_suffix:=case when j.input->>'language'='en' then '🛒 Visit our shop: ' else '🛒 Zum Shop: ' end||j.shop_url;
   old_suffix:=case when d?'product_id' then
    (case when j.input->>'language'='en' then '🛒 View product: ' else '🛒 Zum Produkt: ' end)||j.shop_url||'&produkt='||(d->>'product_id')
    else shop_suffix end;
   if old_suffix is null or right(d->>'caption',length(old_suffix)+2) is distinct from chr(10)||chr(10)||old_suffix then
    return jsonb_build_object('ok',false,'code','INVALID_EDIT');
   end if;
   d:=d||jsonb_build_object('caption',left(d->>'caption',-length(old_suffix))||shop_suffix);
  end;
 end if;
 $new$||cleanup);
 -- A retry against the current revision that already has this exact destination is a no-op.
 execute replace(definition,write_assignment,$new$if link_only and d=b.draft then
  return jsonb_build_object('ok',true,'status','completed','id',j.id,'input',j.input,'preview',
    jsonb_set(j.preview,'{drafts}',jsonb_build_array(b.draft)),'revision',j.revision,'assignment_revision',b.revision);
 end if;
 $new$||write_assignment);
end $migration$;
