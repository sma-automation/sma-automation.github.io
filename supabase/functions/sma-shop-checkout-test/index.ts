import { createSupabaseContext } from 'npm:@supabase/server@1';
import { createHandler } from './handler.ts';
export default {
  fetch: createHandler((req: Request) => createSupabaseContext(req, {auth: 'user'})),
};
