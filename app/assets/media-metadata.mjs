export function missingVideoMetadata(file){
 if(file?.media_kind!=='video')return [];
 const positive=v=>Number.isSafeInteger(v)&&v>0,missing=[];
 if(!positive(file.duration_ms))missing.push('Videolänge');
 if(!positive(file.width_px)||!positive(file.height_px))missing.push('Bildgröße');
 return missing;
}
export function videoMetadataNotice(file){
 const missing=missingVideoMetadata(file);
 return missing.length?'Dateiangaben fehlen noch: '+missing.join(' und ')+'. Bei neuen Videos stellt Google Drive diese Angaben manchmal erst nach dem Upload bereit. Bitte nach kurzer Wartezeit aktualisieren.':'';
}
// Existing owner-scoped catalogue sync only; no upload, analysis or publication.
export async function refreshMediaCatalog({getSession,owner,signal,request=fetch}){
 const check=async()=>{signal?.throwIfAborted();const s=await getSession();signal?.throwIfAborted();if(!s?.user?.id||s.user.id!==owner||!s.access_token)throw Error('AUTH_REQUIRED');return s;};
 const s=await check(),response=await request('https://johnmusic.app.n8n.cloud/webhook/sma-publication-files-v1',{method:'POST',headers:{Authorization:'Bearer '+s.access_token},credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(90000)])});
 const data=await response.json();await check();
 if(!response.ok||data?.ok!==true)throw Error(['AUTH_REQUIRED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE','FILE_SYNC_RATE_LIMITED','FILE_SYNC_RUNNING','FOLDER_UNAVAILABLE'].includes(data?.code)?data.code:'FILE_SYNC_UNAVAILABLE');
}
