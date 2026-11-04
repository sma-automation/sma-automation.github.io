// Same SMA session and public API key as the dashboard. No external provider credentials.
const origin='https://bnvnmdxosbnuzedokqgh.supabase.co';
const key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';
let client;
async function auth(){if(!client){const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.57.4');client=createClient(origin,key);}return client;}
export async function getOwnerId(){const {data,error}=await (await auth()).auth.getSession();return error?null:data?.session?.user?.id||null;}
async function rpc(name,body,token){
 const response=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
  headers:{'Content-Type':'application/json',apikey:key,...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 if(!response.ok)throw Object.assign(new Error('UNAVAILABLE'),{code:response.status===401?'AUTH_REQUIRED':'UNAVAILABLE'});
 return response.json();
}
export async function customerWebsiteRequest(action,input={}){
 const {data,error}=await (await auth()).auth.getSession();
 if(error||!data?.session)throw Object.assign(new Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
 return rpc('sma_customer_website_v1',{p_action:action,p_input:input},data.session.access_token);
}
export const publicWebsiteRequest=siteId=>rpc('sma_customer_website_public_v1',{p_site_id:siteId});
export async function watchOwner(callback){return (await auth()).auth.onAuthStateChange((_event,session)=>callback(session?.user?.id||null)).data.subscription;}
