import {boundedJson} from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function call(name:string,input:unknown,auth:string,key:string){
 const r=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{apikey:key,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(input)});
 if(!r.ok)throw Error('UNAVAILABLE');return boundedJson(r,24576);
}
export const serviceRpc=(name:string,input:unknown)=>call(name,input,'Bearer '+service,service);
export const userRpc=(auth:string,action:string,input:unknown)=>call('sma_website_connection_request_v1',{p_action:action,p_input:input},auth,anon);
export async function authenticate(auth:string){
 const r=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:auth},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)return null;return boundedJson(r,32768);
}
