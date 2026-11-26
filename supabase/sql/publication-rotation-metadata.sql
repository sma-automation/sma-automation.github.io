-- Drive increments its file version while it extracts video metadata. Rebind
-- only an unapproved editorial slot for a verified, byte-identical gallery copy.
create function sma_private.publication_rotation_refresh_plan_v1(f sma_private.publication_files_v1) returns void
language sql volatile security definer set search_path='' as $$
 update sma_private.publication_joint_plans_v1 j set asset_revision=f.revision,version=j.version+1
 from sma_private.publication_rotation_sources_v1 s join sma_private.publication_rotation_imports_v1 i on i.source_id=s.id
 where s.customer_id=f.customer_id and s.owner_id=f.user_id and i.copy_id=f.drive_file_id and i.verified_at is not null
 and f.available and f.revision ~ '^sha256:[a-f0-9]{64}:[0-9]+$' and split_part(f.revision,':',2)=i.digest
 and j.customer_id=f.customer_id and j.owner_id=f.user_id and j.asset_id=f.id and j.daily_slot is not null
 and j.desired_at>now() and j.asset_revision<>f.revision and j.asset_revision ~ '^sha256:[a-f0-9]{64}:[0-9]+$'
 and split_part(j.asset_revision,':',2)=i.digest
 and not exists(select from sma_private.publication_joint_plans_v1 other where other.customer_id=j.customer_id
   and other.owner_id=j.owner_id and other.asset_id=j.asset_id and other.asset_revision=f.revision)
 and not exists(select from sma_private.publication_orders_v1 o where o.customer_id=j.customer_id and o.user_id=j.owner_id
   and o.binding->>'asset_id'=j.asset_id::text and o.binding->>'asset_revision'=j.asset_revision and o.state<>'cancelled')
$$;
create function sma_private.publication_rotation_refresh_trigger_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.user_id=new.user_id and old.customer_id=new.customer_id and old.size_bytes=new.size_bytes and old.mime_type=new.mime_type
   and old.revision<>new.revision then perform sma_private.publication_rotation_refresh_plan_v1(new); end if;
 return new;
end $$;
create trigger publication_rotation_refresh_plan_v1 after update of revision on sma_private.publication_files_v1
 for each row execute function sma_private.publication_rotation_refresh_trigger_v1();
revoke all on function sma_private.publication_rotation_refresh_plan_v1(sma_private.publication_files_v1),
 sma_private.publication_rotation_refresh_trigger_v1() from public,anon,authenticated;
select sma_private.publication_rotation_refresh_plan_v1(f) from sma_private.publication_files_v1 f
join sma_private.publication_rotation_imports_v1 i on i.copy_id=f.drive_file_id and i.verified_at is not null;
