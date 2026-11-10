-- Appended to the comparison fixture before its ROLLBACK by the runner.
update sma_private.publication_files_v1 set verified_at=now() where id='fa680000-0000-4000-8000-000000000001';
insert into sma_private.publication_orders_v1(id,user_id,customer_id,binding,draft,choices)
select 'fa680000-0000-4000-8000-000000000010',c.user_id,c.customer_id,c.binding,a.draft,'{"visibility":"private","made_for_kids":false,"contains_synthetic_media":false}'::jsonb
from sma_private.publication_comparisons_v1 c join sma_private.publication_assignments_v1 a on a.asset_id=(c.binding->>'asset_id')::uuid and a.platform=c.binding->>'platform'
where c.customer_id=909000000071 limit 1;
set local role service_role;
do $$declare o constant uuid:='fa680000-0000-4000-8000-000000000010';r jsonb;c jsonb;res jsonb;l uuid;old_l uuid;b jsonb;begin
 assert (select count(*) from sma_private.publication_comparison_queue_v1 where order_id=o)=1;
 r:=public.sma_publication_comparison_delivery_v1('claim',o);assert r->>'state'='running' and r?'lease_id',r::text;l:=(r->>'lease_id')::uuid;b:=r->'binding';
 r:=public.sma_publication_comparison_delivery_v1('claim',o);assert r->>'state'='running' and not(r?'lease_id');
 assert public.sma_publication_comparison_delivery_v1('finish',o,gen_random_uuid())->>'code'='INVALID_LEASE';
 update sma_private.publication_comparison_queue_v1 set lease_until=now()-interval '1 second' where order_id=o;
 old_l:=l;r:=public.sma_publication_comparison_delivery_v1('claim',o);l:=(r->>'lease_id')::uuid;assert l<>old_l;
 assert public.sma_publication_comparison_delivery_v1('finish',o,old_l)->>'code'='INVALID_LEASE';
 c:=public.sma_publication_comparison_v1('start',b);assert c->>'state'='processing',c::text;
 res:=jsonb_build_object('policy_version',c->>'policy_version','source_fingerprint',c->>'source_fingerprint','scope','stored_video_observations_ocr_transcript','verdict','consistent_with_evidence','issues','[]'::jsonb,'can_upload',false,'can_publish',false);
 assert public.sma_publication_comparison_v1('finish',b,(c->>'lease_id')::uuid,res)->>'state'='completed';
 assert public.sma_publication_comparison_delivery_v1('finish',o,l)->>'state'='completed';
 assert public.sma_publication_comparison_delivery_v1('claim',o)->>'state'='completed';
 assert (select deliveries from sma_private.publication_comparison_queue_v1 where order_id=o)=2;
 assert (select approved_at is null from sma_private.publication_orders_v1 where id=o);
 assert not exists(select 1 from sma_private.publication_journal_v1 where order_id=o);
 update sma_private.publication_magic_results_v1 set result=jsonb_set(result,'{description}','"Noch ein anderer Beleg."') where asset_id='fa680000-0000-4000-8000-000000000001';
 r:=public.sma_publication_comparison_delivery_v1('claim',o);assert r?'lease_id','Changed evidence must get a new comparison delivery';
 assert (select deliveries from sma_private.publication_comparison_queue_v1 where order_id=o)=1;
 update sma_private.publication_orders_v1 set state='cancelled' where id=o;
 assert public.sma_publication_comparison_delivery_v1('claim',o)->>'code'='ORDER_UNAVAILABLE';
 assert (select state from sma_private.publication_comparison_queue_v1 where order_id=o)='cancelled';
end $$;
reset role;
