-- Revisit deferred media fairly. The old ordering always put a stuck text
-- operation before fresh files from the same customer.
alter table sma_private.planned_draft_tasks_v1 add column refresh_attempts integer not null default 0;
do $migration$
declare
 run_body text:=pg_get_functiondef('sma_private.run_planned_drafts_v1()'::regprocedure);
 prep_body text:=pg_get_functiondef('sma_private.prepare_planned_draft_v1(sma_private.planned_draft_tasks_v1,sma_private.planned_draft_media_v1)'::regprocedure);
 rank_anchor text:='order by v.owner_id,(d.text_id is not null) desc,';
 command_anchor text:='if command.state=''completed'' and op=''preview_prepare'' then';
begin
 if array_length(string_to_array(run_body,rank_anchor),1)<>2 or array_length(string_to_array(prep_body,command_anchor),1)<>2 then raise exception 'DRAFT_PREPARATION_BASE_CHANGED';end if;
 execute replace(run_body,rank_anchor,'order by v.owner_id,d.next_at,(d.text_id is not null) desc,');
 execute replace(prep_body,command_anchor,$recovery$
 -- A job that expired before execution can be prepared again from fresh Drive
 -- evidence. Running or ambiguous commands retain their existing identity.
 if ((command.state in ('queued','offered') and command.accepted_execution_id is null and command.child_execution_id is null and exists (
   select from sma_private.file_jobs_v1 j where j.id=command.job_id
    and j.deadline_at < now()-interval '2 minutes' and j.state<>'uncertain'
    and (j.delivery_until is null or j.delivery_until<now())
 )) or (command.state='failed' and coalesce(command.response_body->>'code',command.error_code) in ('FILE_REFRESH_REQUIRED','FILE_JOB_EXPIRED')))
 and not exists(select from sma_private.publication_previews_v1 p where p.id=case when op='preview_prepare' then (command.input->>'request_id')::uuid end)
 then
  update sma_private.planned_draft_tasks_v1 set magic_id=case when op='magic_video' then null else magic_id end,
    text_id=case when op='preview_prepare' then null else text_id end,
    refresh_attempts=least(refresh_attempts+1,5), next_at=now()+interval '2 minutes'*power(2,least(refresh_attempts,4)), last_code='DRIVE_REFRESH_PENDING' where id=t.id;
  perform sma_private.planned_draft_signal_v1(t.id,'drive');
  return;
 end if;
$recovery$||command_anchor);
end $migration$;
