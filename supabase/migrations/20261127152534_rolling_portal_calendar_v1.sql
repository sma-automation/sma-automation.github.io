-- Keep the configured slots available before a customer opens the dashboard.
-- The existing fifteen-minute clock also recovers gaps after a gallery import.
create or replace function sma_private.fill_remaining_portal_slots_v1() returns void
language plpgsql set search_path='' as $$
declare
 today date := (now() at time zone 'Europe/Vienna')::date;
 entry record;
begin
 for entry in
  select distinct dt.day,s.id,s.customer_id,s.owner_id
  from sma_private.publication_rotation_sources_v1 s
  join sma_private.planned_draft_sources_v1 enabled on enabled.source_id=s.id
  join sma_private.publication_daily_settings_v1 st on (st.customer_id,st.owner_id)=(s.customer_id,s.owner_id)
  join public.sma_kunden c on (c.id,c.user_id)=(s.customer_id,s.owner_id)
  cross join lateral (select today+n as day from generate_series(0,2) n) dt
  where c.aktiv and (c.demo_delta_aktiv or c.zahlung_bestaetigt)
    and exists(select from sma_private.publication_portal_folders_v1 pf
      cross join lateral jsonb_array_elements_text(st.times->pf.platform) hours(h)
      where pf.source_id=s.id and ((dt.day+h::time) at time zone 'Europe/Vienna')>now()
        and not exists(select from sma_private.publication_joint_plans_v1 j where (j.customer_id,j.owner_id)=(s.customer_id,s.owner_id)
          and j.plan_day=dt.day and (j.portal_times->>pf.platform)::timestamptz=((dt.day+h::time) at time zone 'Europe/Vienna')))
  order by dt.day,s.customer_id,s.id,s.owner_id
 loop
  perform sma_private.publication_portal_fill_v1(entry.id,entry.customer_id,entry.owner_id,entry.day);
 end loop;
end $$;
