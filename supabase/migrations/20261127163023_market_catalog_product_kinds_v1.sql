do $migration$
declare b text; an text; af text;
begin
 b:=pg_get_functiondef('public.sma_market_catalog_v1(text,jsonb)'::regprocedure);
 an:='pid:=(fields->>''id'')::uuid;';
 if strpos(b,an)=0 then raise exception 'CATALOG_BASE_CHANGED';end if;
 b:=replace(b,an,'if coalesce(fields->>''kind'',''Digital'') not in (''Digital'',''Dienstleistung'',''Physisch'') then return ''{"ok":false,"code":"INVALID_INPUT"}'';end if; '||an);
 an:='amount,''EUR'',''Digital'',false);';
 if strpos(b,an)=0 then raise exception 'CATALOG_BASE_CHANGED';end if;
 b:=replace(b,an,'amount,''EUR'',coalesce(fields->>''kind'',''Digital''),false);');
 b:=replace(b,'set produkt_name=title,beschreibung=descr,preis=amount,updated_at=now()','set produkt_name=title,beschreibung=descr,preis=amount,produkt_typ=coalesce(fields->>''kind'',p.produkt_typ),updated_at=now()');
 execute b;
 b:=pg_get_functiondef('public.sma_catalog_job_worker_v1(uuid,text,jsonb)'::regprocedure);
 an:='''category'',ch.category,';if strpos(b,an)=0 then raise exception 'CATALOG_BASE_CHANGED';end if;
 execute replace(b,an,an||'''kind'',prod.produkt_typ,');
 b:=pg_get_functiondef('sma_private.catalog_shopify_take_v1(text)'::regprocedure);
 an:='''prior_stage'',w.write_stage,';if strpos(b,an)=0 then raise exception 'CATALOG_BASE_CHANGED';end if;
 execute replace(b,an,an||'''kind'',p.produkt_typ,');
 b:=pg_get_functiondef('public.sma_catalog_connect_worker_v1(uuid,text,text,text,integer)'::regprocedure);
 execute replace(b,'and code=''RECONNECT''','and code in (''RECONNECT'',''CATEGORY'')');
end $migration$;
