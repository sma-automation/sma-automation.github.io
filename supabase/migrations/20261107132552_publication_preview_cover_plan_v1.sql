-- Use exactly the candidate cover and timestamp of the existing handoff.
-- This projection reads the export only and never reserves a provider attempt.
do $$begin
 if (select md5(prosrc) from pg_proc where oid='sma_private.publication_editor_result_v1(uuid,text)'::regprocedure)
  <> 'fd6db01928c7d138c4ea461add3cb189' then raise exception 'PREVIEW_COVER_BASELINE_CHANGED'; end if;
end $$;

create or replace function sma_private.publication_editor_result_v1(p_asset_id uuid,p_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 uid uuid:=auth.uid();
 c public.sma_kunden%rowtype;
 f sma_private.publication_files_v1%rowtype;
 context sma_private.publication_orders_v1%rowtype;
 plan jsonb; cover jsonb; cover_name text;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','AUTH_REQUIRED');end if;
 if p_asset_id is null or p_revision is null or char_length(p_revision) not between 1 and 250 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if (select count(*) from public.sma_kunden where user_id=uid)<>1 then return jsonb_build_object('ok',false,'code','ACCOUNT_UNAVAILABLE');end if;
 select * into c from public.sma_kunden where user_id=uid;
 if c.aktiv is not true or not(c.demo_delta_aktiv is true or c.zahlung_bestaetigt is true) then return jsonb_build_object('ok',false,'code','ACCESS_INACTIVE');end if;
 select * into f from sma_private.publication_files_v1 where id=p_asset_id and user_id=uid and customer_id=c.id and available;
 if not found then return jsonb_build_object('ok',false,'code','FILE_UNAVAILABLE');end if;
 if f.revision is distinct from p_revision then return jsonb_build_object('ok',false,'code','FILE_CHANGED');end if;
 context.user_id:=uid;context.customer_id:=c.id;
 context.binding:=jsonb_build_object('asset_id',f.id,'asset_revision',f.revision);
 plan:=sma_private.publication_cover_plan_v1(context);
 if plan is not null then
  select name into strict cover_name from sma_private.publication_files_v1
   where id=(plan->>'asset_id')::uuid and revision=plan->>'asset_revision' and user_id=uid and customer_id=c.id and available;
  cover:=jsonb_build_object('name',cover_name,'asset_id',plan->'asset_id','asset_revision',plan->'asset_revision',
    'position_ms',plan->'position_ms','size_bytes',plan->'size_bytes');
 end if;
 return jsonb_build_object('ok',true,'version',1,'can_publish',false,'asset_id',f.id,'asset_revision',f.revision,'cover',cover);
exception
 when raise_exception then
  if sqlerrm<>'COVER_UNAVAILABLE' then raise;end if;
  return jsonb_build_object('ok',false,'code','COVER_UNAVAILABLE');
 when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok',false,'code','COVER_UNAVAILABLE');
end $$;
