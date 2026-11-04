import {createHandler,limitedJson} from './handler.mjs';
// No external dependencies. Both the gateway and Auth validate the user JWT.
// Service credentials stay in this server environment and are used only for
// the narrow completion RPC after a lookup of the server-created challenge.
const base=Deno.env.get('SUPABASE_URL')!;
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function call(name:string,input:unknown,auth:string,key:string){
 return limitedJson(await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(8000)}));
}
Deno.serve(createHandler({
 authenticate:async(auth:string)=>{
  const response=await fetch(base+'/auth/v1/user',{headers:{apikey:anon,Authorization:auth},redirect:'error',signal:AbortSignal.timeout(8000)});
  if(response.status===401||response.status===403)return null;
  return (await limitedJson(response)).id;
 },
 rpc:(auth:string,action:string)=>call('sma_website_domain_check_v1',{p_action:action},auth,anon),
 finish:(uid:string,attempt:string,result:string)=>call('sma_website_domain_check_finish_v1',{p_user_id:uid,p_attempt_id:attempt,p_result:result},'Bearer '+service,service)
}));
