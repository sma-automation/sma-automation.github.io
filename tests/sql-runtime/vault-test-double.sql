-- Local contract double only: this deliberately does NOT implement encryption.
-- Supabase Vault encryption is checked separately against the native extension.
create schema vault;
create table vault.secrets(id uuid primary key,secret text not null,name text,description text);
create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text,new_name text default null,new_description text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare v uuid:=gen_random_uuid();begin
 insert into vault.secrets values(v,new_secret,new_name,new_description);return v;
end $$;
revoke all on schema vault from public,anon,authenticated,service_role;
revoke all on all tables in schema vault from public,anon,authenticated,service_role;
revoke all on all functions in schema vault from public,anon,authenticated,service_role;
