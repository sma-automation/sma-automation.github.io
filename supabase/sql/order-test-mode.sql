-- Nullable for legacy senders: unknown must never silently become a real order.
alter table public.sma_bestellungen add column if not exists ist_testbestellung boolean;
comment on column public.sma_bestellungen.ist_testbestellung is
  'Verified Shopify order.test: true=test, false=non-test, NULL=not yet verified.';

create or replace function sma_private.bestellung_quellstand_pruefen_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if TG_OP='UPDATE' then
    if (NEW.markt,NEW.markt_konto_id,NEW.externe_bestell_id,NEW.kunde_id,NEW.user_id,NEW.id)
       is distinct from
       (OLD.markt,OLD.markt_konto_id,OLD.externe_bestell_id,OLD.kunde_id,OLD.user_id,OLD.id) then
      raise exception using errcode='23514',message='Bestellidentitaet und Kundenzuordnung sind unveraenderlich';
    end if;
  end if;
  if NEW.markt<>'shopify' then return NEW; end if;
  if NEW.quelle_aktualisiert_am is null
     or not pg_catalog.isfinite(NEW.quelle_aktualisiert_am)
     or NEW.quelle_aktualisiert_am>pg_catalog.clock_timestamp()+interval '5 minutes'
     or NEW.quelle_aktualisiert_am<NEW.erstellt_am then
    raise exception using errcode='23514',message='Gueltiges Shopify updated_at erforderlich';
  end if;
  if TG_OP='UPDATE' then
    if OLD.quelle_aktualisiert_am is not null and NEW.quelle_aktualisiert_am<=OLD.quelle_aktualisiert_am then
      -- The immutable test marker can be learned from an equal source revision.
      -- Return OLD so no other business field can piggyback on that enrichment.
      if NEW.quelle_aktualisiert_am=OLD.quelle_aktualisiert_am
         and OLD.ist_testbestellung is null and NEW.ist_testbestellung is not null then
        OLD.ist_testbestellung:=NEW.ist_testbestellung;
        OLD.updated_at:=pg_catalog.clock_timestamp();
      end if;
      return OLD;
    end if;
    if OLD.ist_testbestellung is not null then
      if NEW.ist_testbestellung is not null and NEW.ist_testbestellung is distinct from OLD.ist_testbestellung then
        raise exception using errcode='23514',message='Shopify-Testkennzeichen ist unveraenderlich';
      end if;
      -- Older webhook senders may omit the marker; preserve the verified value.
      NEW.ist_testbestellung:=OLD.ist_testbestellung;
    end if;
    NEW.created_at:=OLD.created_at;
    NEW.updated_at:=pg_catalog.clock_timestamp();
  end if;
  return NEW;
end; $$;
revoke all on function sma_private.bestellung_quellstand_pruefen_v1() from public,anon,authenticated;

-- The existing canonical-order trigger and all RLS/grants stay in place.
-- Deploy the updated order-reconciliation.sql in the same migration.
