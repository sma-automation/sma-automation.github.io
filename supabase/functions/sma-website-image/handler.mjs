import {inspectWebsiteImage,boundedImageBody,imageDigest} from '../_shared/website-image.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const originAllowed='https://sma-automation.com';
const codes=new Set(['AUTH_REQUIRED','ACCOUNT_UNAVAILABLE','ACCOUNT_CHANGED','ACCESS_INACTIVE','WEBSITE_REQUIRED','IMAGE_UNAVAILABLE','IMAGE_CONFLICT','IMAGE_LIMIT','IMAGE_FORMAT','IMAGE_SIZE','INVALID_INPUT']);
const fail=code=>{throw Object.assign(Error(code),{code});};
const checked=r=>{if(r?.ok!==true)fail(codes.has(r?.code)?r.code:'UNAVAILABLE');return r;};
function pathFor(r){if(!uuid.test(r.id)||!['image/png','image/jpeg'].includes(r.mime))fail('IMAGE_UNAVAILABLE');return 'images/'+r.id+(r.mime==='image/png'?'.png':'.jpg');}
export function createWebsiteImageHandler({authenticate,rpc,upload,download,remove}){
 return async request=>{
  const origin=request.headers.get('origin'),headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Origin, Authorization',...(origin===originAllowed?{'Access-Control-Allow-Origin':originAllowed,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'}:{})};
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
  if(origin&&origin!==originAllowed)return json({ok:false,code:'ORIGIN_REJECTED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(!['GET','POST'].includes(request.method))return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  try{
   const params=new URL(request.url).searchParams,id=params.get('id'),site=params.get('site');
   if(!uuid.test(id||'')||params.size!==(site?2:1)||site&&!uuid.test(site)||request.method==='POST'&&site)fail('INVALID_INPUT');
   let user=null;
   if(!site){const auth=request.headers.get('authorization');if(!auth||!/^Bearer [^\s]+$/.test(auth)||auth.length>8192)fail('AUTH_REQUIRED');user=await authenticate(auth);if(!uuid.test(user?.id||''))fail('AUTH_REQUIRED');}
   const call=async(action,input)=>checked(await rpc('sma_website_image_service_v1',{p_user_id:user?.id||null,p_action:action,p_input:input}));
   if(request.method==='GET'){
    const input={id,...(site?{site_id:site}:{})},action=site?'read_public':'read';
    const media=await call(action,input),path=pathFor(media),bytes=await download(path);
    if(bytes.length!==media.size||await imageDigest(bytes)!==media.sha256)fail('IMAGE_UNAVAILABLE');
    inspectWebsiteImage(bytes);
    // A change of owner, access or published snapshot during the download revokes the response.
    const again=await call(action,input);if(again.sha256!==media.sha256)fail('IMAGE_UNAVAILABLE');
    return new Response(bytes,{headers:{...headers,'Content-Type':media.mime,'Content-Length':String(bytes.length)}});
   }
   const bytes=await boundedImageBody(request),info=inspectWebsiteImage(bytes);
   if(request.headers.get('content-type')!==info.mime)fail('IMAGE_FORMAT');
   const sha256=await imageDigest(bytes),input={id,mime:info.mime,size:bytes.length,width:info.width,height:info.height,sha256};
   // Reap only copies unused by both snapshots for 24 hours; database marks them first.
   const cleanup=await call('reap',{});
   for(const stale of cleanup.images||[]){try{await remove(pathFor(stale));await call('discard',{id:stale.id});}catch{/* A later upload retries cleanup; never remove referenced images. */}}
   const reservation=await call('reserve',input),path=pathFor(reservation);
   if(reservation.state!=='ready'){
    const written=await upload(path,bytes,info.mime);
    if(!written){const stored=await download(path);if(await imageDigest(stored)!==sha256)fail('IMAGE_CONFLICT');}
   }
   await call('complete',{id,sha256});
   return json({ok:true,image:{id,mime:info.mime,size:bytes.length,width:info.width,height:info.height}});
  }catch(e){const code=codes.has(e?.code)?e.code:'UNAVAILABLE';return json({ok:false,code},code==='AUTH_REQUIRED'?401:code==='IMAGE_UNAVAILABLE'?404:409);}
 };
}
