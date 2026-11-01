-- Deploy the nullable column before publishing the n8n sender change.
-- Backfill existing Shopify rows from a freshly reconciled Shopify snapshot
-- before enabling this trigger. Never derive the source time from updated_at.
alter table public.sma_bestellungen
  add column if not exists quelle_aktualisiert_am timestamptz;

comment on column public.sma_bestellungen.quelle_aktualisiert_am is
  'Shopify order.updated_at. Source revision, not webhook receipt or SMA mirror time.';

create or replace function sma_private.bestellung_quellstand_pruefen_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Runs after the existing customer-to-owner mapping trigger.
  if TG_OP = 'UPDATE' then
    if (NEW.markt, NEW.markt_konto_id, NEW.externe_bestell_id,
        NEW.kunde_id, NEW.user_id, NEW.id)
       is distinct from
       (OLD.markt, OLD.markt_konto_id, OLD.externe_bestell_id,
        OLD.kunde_id, OLD.user_id, OLD.id) then
      raise exception using errcode = '23514',
        message = 'Bestellidentitaet und Kundenzuordnung sind unveraenderlich';
    end if;
  end if;

  if NEW.markt <> 'shopify' then
    return NEW;
  end if;

  if NEW.quelle_aktualisiert_am is null
     or not pg_catalog.isfinite(NEW.quelle_aktualisiert_am)
     or NEW.quelle_aktualisiert_am > pg_catalog.clock_timestamp() + interval '5 minutes'
     or NEW.quelle_aktualisiert_am < NEW.erstellt_am then
    raise exception using errcode = '23514',
      message = 'Gueltiges Shopify updated_at erforderlich';
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.quelle_aktualisiert_am is not null
       and NEW.quelle_aktualisiert_am <= OLD.quelle_aktualisiert_am then
      -- Return the canonical row (rather than NULL) so PostgREST still returns
      -- one item and n8n reaches its webhook acknowledgement on a replay.
      -- Equal source revisions are idempotent; never infer status precedence.
      return OLD;
    end if;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := pg_catalog.clock_timestamp();
  end if;
  return NEW;
end;
$$;

revoke all on function sma_private.bestellung_quellstand_pruefen_v1()
  from public, anon, authenticated;

create or replace trigger sma_bestellungen_zz_quellstand_trigger
before insert or update on public.sma_bestellungen
for each row execute function sma_private.bestellung_quellstand_pruefen_v1();
