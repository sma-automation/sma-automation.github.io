-- Import evidence maps a merchant SKU to an existing vendor product without a remote write.
create table sma_private.catalog_digi_existing_v1(
 product_id bigint primary key references public.sma_produkte(id) on delete cascade,
 vendor text not null, remote_id text not null check(remote_id ~ '^[1-9][0-9]*$'),
 baseline_revision bigint not null check(baseline_revision>0), unique(vendor,remote_id)
);
alter table sma_private.catalog_digi_existing_v1 enable row level security;
revoke all on sma_private.catalog_digi_existing_v1 from public,anon,authenticated,service_role;

do $migration$
declare b text; anchor text;
begin
 b:=pg_get_functiondef('public.sma_catalog_connect_worker_v1(uuid,text,text,text,integer)'::regprocedure);
 anchor:='coalesce(category_in,0)<1';
 if strpos(b,anchor)=0 then raise exception 'CATALOG_CONNECT_CHANGED';end if;
 execute replace(b,anchor,'category_in<1');
 b:=pg_get_functiondef('public.sma_catalog_job_worker_v1(uuid,text,jsonb)'::regprocedure);
 anchor:='''category'',ch.category,';
 if strpos(b,anchor)=0 then raise exception 'CATALOG_CLAIM_CHANGED';end if;
 b:=replace(b,anchor,anchor||$s$'existing',(select jsonb_build_object('remote_id',e.remote_id,'revision',e.baseline_revision,'vendor',e.vendor)
    from sma_private.catalog_digi_existing_v1 e where e.product_id=w.product_id and w.market='digistore24'),$s$);
 anchor:='elsif op=''finish'' and';
 if strpos(b,anchor)=0 then raise exception 'CATALOG_FINISH_CHANGED';end if;
 b:=replace(b,anchor,$s$elsif op='record_link' and w.market='digistore24' and w.sent_revision=0 and w.write_stage is null and exists(
  select from sma_private.catalog_digi_existing_v1 e join sma_private.catalog_channels_v1 c on c.customer_id=w.customer_id and c.market=w.market and lower(c.identity)=lower(e.vendor)
  where e.product_id=w.product_id and e.remote_id=arg->>'remote_id' and e.baseline_revision=(arg->>'baseline')::bigint and e.baseline_revision<=w.revision) and arg->>'plan_id' ~ '^[1-9][0-9]*$' then
  update sma_private.catalog_work_v1 set remote_id=arg->>'remote_id',plan_id=arg->>'plan_id',sent_revision=(arg->>'baseline')::bigint,
   state=case when revision=(arg->>'baseline')::bigint then 'synced' else 'queued' end,code='EXISTING_LINK',ticket=null,claimed=false,expires_at=null,attempts=0,next_at=now() where ticket=t;
 $s$||anchor);
 execute b;
 b:=pg_get_functiondef('public.sma_market_catalog_v1(text,jsonb)'::regprocedure);
 anchor:='when w.sent_revision=w.revision then ''synced''';
 if strpos(b,anchor)=0 then raise exception 'CATALOG_VIEW_CHANGED';end if;
 execute replace(b,anchor,'when w.sent_revision=w.revision and w.code=''EXISTING_LINK'' then ''Verknüpft'' '||anchor);
end $migration$;
