-- Exercise the installed scheduler and live webhook with a private, one-use
-- synthetic fixture. Customer files and music catalogue entries are unnecessary.
alter table sma_private.gallery_background_probe_v1 add column dispatched_at timestamptz;
create or replace function sma_private.gallery_background_tick_v1() returns bigint
language plpgsql security definer set search_path='' as $$
declare payload jsonb;
begin
 payload:=sma_private.gallery_background_pick_v1();
 if payload is null then
  update sma_private.gallery_background_probe_v1 p set dispatched_at=now()
   where p.singleton and p.dispatched_at is null and p.ticket is not null and p.completed_at is null and p.expires_at>now()
   returning jsonb_build_object('id',p.id,'ticket',p.ticket) into payload;
 end if;
 if payload is null then return null;end if;
 return net.http_post(url:='https://johnmusic.app.n8n.cloud/webhook/sma-gallery-soundtrack-v1',
  body:=payload,headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=15000);
end $$;
