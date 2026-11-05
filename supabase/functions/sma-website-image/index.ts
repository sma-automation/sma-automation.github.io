import {createWebsiteImageHandler} from './handler.mjs';
import {authenticate,serviceRpc} from '../sma-wordpress-connect/runtime.ts';
import {boundedImageBody} from '../_shared/website-image.mjs';
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const objectURL=(path:string)=>base+'/storage/v1/object/sma-webseitenbilder/'+path;
const headers={apikey:key,Authorization:'Bearer '+key};
Deno.serve(createWebsiteImageHandler({
 resolvePublicOrigin:async(origin:string,site:string)=>serviceRpc('sma_website_origin_v1',{p_hostname:new URL(origin).hostname,p_site:site}),
 authenticate,rpc:serviceRpc,
 upload:async(path:string,bytes:Uint8Array,mime:string)=>{
  const r=await fetch(objectURL(path),{method:'POST',headers:{...headers,'Content-Type':mime,'cache-control':'0','x-upsert':'false'},body:new Uint8Array(bytes).buffer,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(r.ok)return true;
  const result=await r.json().catch(()=>({}));if(r.status===409||result?.statusCode==='409'||result?.error==='Duplicate')return false;throw Error('UNAVAILABLE');
 },
 download:async(path:string)=>{const r=await fetch(objectURL(path),{headers,redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('UNAVAILABLE');return boundedImageBody(r);},
 remove:async(path:string)=>{const r=await fetch(base+'/storage/v1/object/sma-webseitenbilder',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]}),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('UNAVAILABLE');}
}));
