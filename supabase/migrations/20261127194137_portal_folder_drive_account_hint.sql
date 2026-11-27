alter table sma_private.publication_portal_folders_v1 add column drive_account_hint text;

do $$
declare
 definition text:=pg_get_functiondef('public.sma_manual_portal_v1(text,text,uuid,text,uuid,uuid,timestamptz)'::regprocedure);
 anchor text:=$match$if p_action='folder' then return jsonb_build_object('ok',true,'folder',folder,$match$;
 replacement text:=$new$if p_action='folder' then return jsonb_build_object('ok',true,'folder',folder,
  'drive_account',(select pf.drive_account_hint from sma_private.publication_portal_folders_v1 pf
    where pf.source_id=src and pf.platform=p_platform and pf.folder_id=folder),$new$;
begin
 if array_length(string_to_array(definition,anchor),1)<>2 then raise exception 'FOLDER_LOOKUP_CHANGED'; end if;
 execute replace(definition,anchor,replacement);
end $$;
