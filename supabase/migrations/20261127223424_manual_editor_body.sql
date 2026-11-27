-- Keep the customer's editable text alongside the caption that includes the standard shop invitation.
do $migration$
declare
 fn text:=pg_get_functiondef('sma_private.content_editor_v1(text,jsonb)'::regprocedure);
 reader text:=pg_get_functiondef('sma_private.publication_files_request_v1(text,jsonb)'::regprocedure);
 write_part text:=$old$set editor_note=jsonb_build_object('source',note,'asset_revision',f.revision,$old$;
 read_part text:=$old$jsonb_build_object('editor_source_text',b.editor_note->>'source') else j.input end$old$;
begin
 if array_length(string_to_array(fn,write_part),1)<>2 or array_length(string_to_array(reader,read_part),1)<>2 then
  raise exception 'MANUAL_EDITOR_READ_WRITE_CONTRACT_CHANGED';
 end if;
 execute replace(fn,write_part,$new$set editor_note=jsonb_build_object('source',note,'body',btrim(p_input->>'body'),'asset_revision',f.revision,$new$);
 execute replace(reader,read_part,$new$jsonb_build_object('editor_source_text',b.editor_note->>'source')
  || case when b.editor_note?'body' and b.editor_note->'receipt_revision'=to_jsonb(b.revision)
       then jsonb_build_object('editor_body',b.editor_note->>'body') else '{}'::jsonb end else j.input end$new$);
end $migration$;
