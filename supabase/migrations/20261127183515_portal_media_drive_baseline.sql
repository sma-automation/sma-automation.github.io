-- File IDs and modified times observed at enrollment distinguish existing stock
-- from new arrivals, including an older file moved in from another Drive folder.
alter table sma_private.portal_media_profiles_v1 add column initial_drive_files jsonb not null
 default '{}'::jsonb check(jsonb_typeof(initial_drive_files)='object');
