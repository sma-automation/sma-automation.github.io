// Native device uploads; no OAuth token, customer/folder ID or file path reaches
// Google from the page. The server issues a single-file resumable capability.
export const UPLOAD_MAX_BYTES=4000000000;
const extensions={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif',avif:'image/avif',tif:'image/tiff',tiff:'image/tiff',bmp:'image/bmp',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',avi:'video/x-msvideo',mpeg:'video/mpeg',mpg:'video/mpeg',mkv:'video/x-matroska','3gp':'video/3gpp'};
export function deviceFileMetadata(file,portal){
 if(!file||typeof file.name!=='string'||!file.name.trim()||file.name.length>250||/[\u0000-\u001f\u007f/\\\u202a-\u202e\u2066-\u2069]/u.test(file.name))throw Error('INVALID_INPUT');
 const mime=extensions[file.name.split('.').pop().toLowerCase()];
 if(!mime||(file.type&&file.type!=='application/octet-stream'&&file.type!==mime&&!(file.type==='video/x-m4v'&&mime==='video/mp4')))throw Error('UPLOAD_FORMAT');
 if(!Number.isSafeInteger(file.size)||file.size<1||file.size>UPLOAD_MAX_BYTES)throw Error('UPLOAD_SIZE');
 if(['youtube','tiktok'].includes(portal)&&!mime.startsWith('video/'))throw Error('PORTAL_REQUIRES_VIDEO');
 return {name:file.name,mime_type:mime,size_bytes:file.size};
}
export function checkedUploadURL(value){
 if(typeof value!=='string'||value.length>4000||!/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/.test(value))throw Error('UPLOAD_UNAVAILABLE');
 const parts=value.split('?');if(parts.length!==2)throw Error('UPLOAD_UNAVAILABLE');
 const seen=new Set();for(const item of parts[1].split('&')){
  const m=/^(uploadType|supportsAllDrives|upload_id|session_crd)=([A-Za-z0-9_.%~=-]+)$/.exec(item);
  if(!m||seen.has(m[1])||(m[1]==='uploadType'&&m[2]!=='resumable')||(m[1]==='supportsAllDrives'&&m[2]!=='true'))throw Error('UPLOAD_UNAVAILABLE');seen.add(m[1]);
 }
 if(!seen.has('uploadType')||!seen.has('upload_id'))throw Error('UPLOAD_UNAVAILABLE');return value;
}
function acknowledged(response,total){
 if([200,201].includes(response.status))return total;
 if(response.status===404||response.status===410)throw Error('UPLOAD_EXPIRED');
 if(response.status!==308)throw Error(response.status>=500||response.status===429?'UPLOAD_NETWORK':'UPLOAD_UNAVAILABLE');
 const range=response.headers.get('Range');
 if(!range)return 0;
 if(!/^bytes=0-\d+$/.test(range))throw Error('UPLOAD_INCOMPLETE');
 const offset=Number(range.slice(8))+1;
 if(!Number.isSafeInteger(offset)||offset<1||offset>=total)throw Error('UPLOAD_INCOMPLETE');
 return offset;
}
export async function transferDeviceFile({file,url,mime,signal,onProgress=()=>{},fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 checkedUploadURL(url);const total=file.size,chunk=8*1024*1024;let offset=0,recover=true,failures=0;
 const put=range=>({method:'PUT',headers:{'Content-Type':mime,'Content-Range':range},credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
 while(offset<total){
  signal.throwIfAborted();
  try{
   let response;
   if(recover){response=await fetcher(url,{...put('bytes */'+total),body:new Blob([])});}
   else{const end=Math.min(offset+chunk,total);response=await fetcher(url,{...put('bytes '+offset+'-'+(end-1)+'/'+total),body:file.slice(offset,end)});}
   const next=acknowledged(response,total);
   if(!recover&&next<=offset)throw Error('UPLOAD_NETWORK');
   if(next<offset)throw Error('UPLOAD_INCOMPLETE');
   if(next>offset)failures=0;offset=next;onProgress(offset,total);recover=false;
  }catch(e){
   signal.throwIfAborted();
   if(['UPLOAD_EXPIRED','UPLOAD_UNAVAILABLE','UPLOAD_INCOMPLETE'].includes(e.message))throw e;
   if(++failures>4)throw Error('UPLOAD_NETWORK');
   recover=true;await wait(Math.min(1000*2**failures,10000));
  }
 }
}
