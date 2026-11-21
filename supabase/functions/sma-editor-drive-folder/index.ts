import {createFolderHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const endpoint='https://johnmusic.app.n8n.cloud/webhook/sma-paket-dienst-v1';

async function post(target:string, headers:Record<string,string>, body:unknown) {
  const response=await fetch(target,{method:'POST',redirect:'error',cache:'no-store',
    headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(22000)});
  if (!response.ok) throw Error('UNAVAILABLE');
  return response.json();
}
const internal=(rpc:string,body:unknown)=>post(url+'/rest/v1/rpc/'+rpc,{apikey:service,Authorization:'Bearer '+service},body);

Deno.serve(createFolderHandler({
  identify: async (authorization:string) => {
    const response=await fetch(url+'/auth/v1/user',{headers:{apikey:anon,Authorization:authorization},
      redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
    return response.ok ? (await response.json()).id : null;
  },
  binding:(owner:string,reserve:boolean)=>internal('sma_editor_drive_binding_v1',{p_owner:owner,p_reserve:reserve}),
  issueAccountTicket:(data:unknown)=>internal('sma_package_ticket_v1',{p_job:{op:'account',data}}),
  readAccount:(ticket:string)=>post(endpoint,{},{ticket})
}));
