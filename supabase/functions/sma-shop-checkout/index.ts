import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createHandler } from './handler.ts';

// Anonymous buyers may prepare carts only after both server-side release gates.
export default {
  fetch: withSupabase({auth: 'none'}, createHandler(() => Deno.env.get('SMA_CHECKOUT_LIVE_ENABLED') === 'true')),
};
