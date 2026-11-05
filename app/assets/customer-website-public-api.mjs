// Public-only transport for isolated customer hosts: no session or auth library.
const origin='https://bnvnmdxosbnuzedokqgh.supabase.co';
const key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export async function publicWebsiteRequest(siteId){
 if(!uuid.test(siteId))throw Error('NOT_AVAILABLE');
 const response=await fetch(origin+'/rest/v1/rpc/sma_customer_website_public_v1',{
  method:'POST',headers:{'Content-Type':'application/json',apikey:key},body:JSON.stringify({p_site_id:siteId}),
  credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw Error('NOT_AVAILABLE');return response.json();
}
export async function websiteImageRequest(id,siteId,signal){
 if(!uuid.test(id)||!uuid.test(siteId))throw Error('IMAGE_UNAVAILABLE');
 const response=await fetch(origin+'/functions/v1/sma-website-image?'+new URLSearchParams({id,site:siteId}),{
  headers:{apikey:key},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(20000)])
 });
 if(!response.ok||!['image/png','image/jpeg'].includes(response.headers.get('content-type')))throw Error('IMAGE_UNAVAILABLE');
 const blob=await response.blob();if(blob.size<24||blob.size>2_000_000)throw Error('IMAGE_UNAVAILABLE');return blob;
}
