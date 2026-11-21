const site = 'https://sma-automation.com';
const folderId = /^[A-Za-z0-9_-]{10,200}$/;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const headers = {'Content-Type':'application/json', 'Cache-Control':'private, no-store', Vary:'Origin',
 'Access-Control-Allow-Origin':site, 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Access-Control-Allow-Headers':'authorization, apikey, content-type'};
const reply = (status, body) => new Response(JSON.stringify(body), {status, headers});
const denied = () => reply(403, {code:'FOLDER_UNAVAILABLE'});

export function createFolderHandler({identify, binding, issueAccountTicket, readAccount}) {
 return async request => {
  if (request.headers.get('Origin') && request.headers.get('Origin') !== site) return denied();
  if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
  if (request.method !== 'POST') return reply(405, {code:'METHOD_NOT_ALLOWED'});
  // The client chooses no row, customer, folder, operation or worker arguments.
  if (request.body) {
   const reader = request.body.getReader();
   try {
    const first = await reader.read();
    if (!first.done) {await reader.cancel();return reply(400, {code:'INVALID_INPUT'});}
   } finally {reader.releaseLock();}
  }
  const auth = request.headers.get('Authorization');
  if (!auth || !/^Bearer [\w.-]{20,8000}$/.test(auth)) return reply(401, {code:'AUTH_REQUIRED'});
  try {
   const owner = await identify(auth);
   if (!uuid.test(owner || '')) return reply(401, {code:'AUTH_REQUIRED'});
   const current = await binding(owner,true);
   if (current?.code === 'RATE_LIMITED') return reply(429,{code:'RATE_LIMITED'});
   if (!Number.isSafeInteger(current?.row) || current.row<1 || !current.ref || !current.email) return denied();
   const ticket = await issueAccountTicket(current);
   if (!uuid.test(ticket || '')) return denied();
   const read = await readAccount(ticket), account = read?.value;
   if (read?.ok !== true || account?.id !== current.row || account.kunde_id !== current.ref ||
     account.kunde_email !== current.email || account.zugang_aktiv !== true ||
     !(account.demo_delta_aktiv === true || account.zahlung_bestaetigt === true) ||
     typeof account.upload_folder_id !== 'string' || !folderId.test(account.upload_folder_id) ||
     typeof account.processing_folder_id !== 'string' || !folderId.test(account.processing_folder_id) ||
     account.upload_folder_id === account.processing_folder_id) return denied();
   const latest = await binding(owner,false);
   if (latest?.row !== current.row || latest.ref !== current.ref || latest.email !== current.email) return denied();
   return reply(200,{folder_id:account.upload_folder_id});
  } catch {return reply(503,{code:'FOLDER_UNAVAILABLE'});}
 };
}
