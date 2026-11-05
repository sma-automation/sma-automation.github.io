import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createHandler } from './handler.ts';

// Versioned operational release. The independent merchant gate in handler.ts
// remains mandatory. Set false and redeploy to stop all new checkout links.
const CHECKOUT_RELEASE_ENABLED = true;
export default {
  fetch: withSupabase({auth: 'none'}, createHandler(() => CHECKOUT_RELEASE_ENABLED)),
};
