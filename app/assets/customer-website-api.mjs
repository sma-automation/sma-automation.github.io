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

export async function companyProfileRequest(action,input={}){
 const {data,error}=await (await auth()).auth.getSession();
 if(error||!data?.session)throw Object.assign(new Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
 return rpc('sma_company_profile_v1',{p_action:action,p_input:input},data.session.access_token);
}

// Image bytes pass through an owner-/published-snapshot check on every request.
const imageEndpoint=origin+'/functions/v1/sma-website-image';
async function imageHeaders(privateAccess,expectedOwner){
 if(!privateAccess)return {apikey:key};
 const {data,error}=await (await auth()).auth.getSession();if(error||!data?.session)throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
 if(expectedOwner&&data.session.user?.id!==expectedOwner)throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
 return {apikey:key,Authorization:'Bearer '+data.session.access_token};
}
async function imageError(response){const r=await response.json().catch(()=>({}));throw Object.assign(Error('IMAGE_UNAVAILABLE'),{code:r.code||'IMAGE_UNAVAILABLE'});}
const imageID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export async function uploadWebsiteImage(blob,id,signal,expectedOwner){
 if(!imageID.test(id)||!['image/png','image/jpeg'].includes(blob?.type)||blob.size>2_000_000)throw Object.assign(Error('IMAGE_FORMAT'),{code:'IMAGE_FORMAT'});
 const response=await fetch(imageEndpoint+'?id='+id,{method:'POST',headers:{...await imageHeaders(true,expectedOwner),'Content-Type':blob.type},body:blob,credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(45000)])});
 if(!response.ok)return imageError(response);const result=await response.json();if(result?.ok!==true||result.image?.id!==id)throw Error('IMAGE_UNAVAILABLE');return result.image;
}
export async function websiteImageRequest(id,siteId=null,signal){
 if(!imageID.test(id)||siteId&&!imageID.test(siteId))throw Error('IMAGE_UNAVAILABLE');
 const response=await fetch(imageEndpoint+'?id='+id+(siteId?'&site='+siteId:''),{headers:await imageHeaders(!siteId),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)])});
 if(!response.ok)return imageError(response);if(!['image/png','image/jpeg'].includes(response.headers.get('content-type')))throw Error('IMAGE_UNAVAILABLE');
 const blob=await response.blob();if(blob.size<24||blob.size>2_000_000)throw Error('IMAGE_UNAVAILABLE');return blob;
}
