-- 2026-11-17: close public RPC access on four internal trigger functions.
-- Verified against the installed trigger/event-trigger bindings before rollout.
-- No business RPC, trigger definition, RLS policy, or data row changes here.
-- Internal service_role retains the permission it had before the migration.
REVOKE EXECUTE ON FUNCTION public.handle_new_sma_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sma_bestellungen_user_id_setzen() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sma_produkte_user_id_setzen() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.handle_new_sma_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
GRANT EXECUTE ON FUNCTION public.sma_bestellungen_user_id_setzen() TO service_role;
GRANT EXECUTE ON FUNCTION public.sma_produkte_user_id_setzen() TO service_role;
