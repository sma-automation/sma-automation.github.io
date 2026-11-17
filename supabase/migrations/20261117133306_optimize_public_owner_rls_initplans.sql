-- 2026-11-17: verified production RLS optimization for growing SMA tenants.
-- Only the already existing authenticated SELECT policies are changed.
-- No owner predicate, allowed role, table privilege, write policy or RLS setting changes.
-- Wrapping auth.uid() in a scalar SELECT allows PostgreSQL to use one InitPlan
-- per statement rather than re-evaluating the helper for every candidate row.
ALTER POLICY "Kunde liest eigene Daten" ON public.sma_kunden
 USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Kunde liest eigene Produkte" ON public.sma_produkte
 USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Kunde liest eigene Bestellungen" ON public.sma_bestellungen
 USING ((SELECT auth.uid()) = user_id);
