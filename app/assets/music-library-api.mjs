import {createCatalogAPI} from './music-catalog.mjs?v=1';
import {inspectMusic,readMusicSetting,verifyMusicBytes} from './media-music-model.mjs?v=1';
const origin='https://bnvnmdxosbnuzedokqgh.supabase.co',key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';
export function readMusicTrack(t,owner){
 if(!t||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(t.id)||!['pending','ready'].includes(t.status)||typeof t.favourite!=='boolean')throw Error('MUSIC_UNAVAILABLE');
 readMusicSetting({name:t.name,sha256:t.sha256,size_bytes:t.size_bytes,mime_type:t.mime_type,volume:25,start_ms:0});
 if(t.object_name!==owner+'/'+t.sha256+(t.mime_type==='audio/wav'?'.wav':'.mp3'))throw Error('MUSIC_UNAVAILABLE');
 return t;
}
export function createMusicLibraryAPI({owner,getSession,request=fetch,includeCatalog=false}){
 const catalog=createCatalogAPI({owner,getSession,request});
 const auth=async signal=>{signal?.throwIfAborted();const s=await getSession();signal?.throwIfAborted();if(!s?.access_token||s.user?.id!==owner)throw Error('AUTH_REQUIRED');return s;};
 const call=async(action,input={},signal)=>{const s=await auth(signal),r=await request(origin+'/rest/v1/rpc/sma_music_library_v1',{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)]),headers:{apikey:key,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_input:input})});await auth(signal);if(!r.ok)throw Error(r.status===401?'AUTH_REQUIRED':'MUSIC_UNAVAILABLE');const data=await r.json();await auth(signal);if(data?.ok!==true||data.version!==1)throw Error(['AUTH_REQUIRED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE','MUSIC_LIMIT','MUSIC_NOT_FOUND','MUSIC_INCOMPLETE','MUSIC_CONFLICT'].includes(data?.code)?data.code:'MUSIC_UNAVAILABLE');return data;};
 async function privateSource(setting,signal){const m=readMusicSetting(setting),r=await call('get',{sha256:m.sha256},signal),t=readMusicTrack(r.track,owner);if(t.status!=='ready'||t.size_bytes!==m.size_bytes||t.mime_type!==m.mime_type)throw Error('MUSIC_REQUIRED');const s=await auth(signal),response=await request(origin+'/storage/v1/object/authenticated/sma-musik/'+t.object_name,{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]),headers:{apikey:key,Authorization:'Bearer '+s.access_token}});if(!response.ok)throw Error('MUSIC_REQUIRED');const blob=await response.blob();await verifyMusicBytes(blob,m);await auth(signal);return blob;}
 return {catalog,async list(signal){const r=await call('list',{},signal);if(!Array.isArray(r.tracks)||r.tracks.length>100)throw Error('MUSIC_UNAVAILABLE');const own=r.tracks.map(t=>readMusicTrack(t,owner));
  if(!includeCatalog)return own;
  const shared=(await catalog.overview(signal)).tracks.filter(t=>t.available&&!own.some(row=>row.sha256===t.sha256));
  return own.concat(shared.map(t=>({...t,catalog:true,favourite:false,status:'ready'})));
 },async source(setting,signal){
  try{return await privateSource(setting,signal);}catch(e){if(!includeCatalog||e.message!=='MUSIC_NOT_FOUND')throw e;return catalog.source(setting,signal);}
 },
 async upload(file,signal){const m=await inspectMusic(file),input=Object.fromEntries(['name','sha256','size_bytes','mime_type'].map(k=>[k,m[k]]));let t=readMusicTrack((await call('prepare',input,signal)).track,owner);if(t.status==='ready')return t;const s=await auth(signal),body=new Blob([file],{type:m.mime_type});const r=await request(origin+'/storage/v1/object/sma-musik/'+t.object_name,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(90000)]),headers:{apikey:key,Authorization:'Bearer '+s.access_token,'x-upsert':'false','Content-Type':m.mime_type,'Cache-Control':'no-cache'},body});await auth(signal);if(!r.ok){const error=await r.json().catch(()=>({}));if(r.status!==409&&error.statusCode!=='409'&&error.error!=='Duplicate')throw Error('MUSIC_UNAVAILABLE');}t=readMusicTrack((await call('complete',{sha256:m.sha256},signal)).track,owner);return t;},
 async favourite(t,value,signal){return readMusicTrack((await call('favourite',{sha256:t.sha256,favourite:value},signal)).track,owner);}};
}
