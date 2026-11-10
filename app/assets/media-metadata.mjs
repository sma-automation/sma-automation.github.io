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

/**
 * A Drive metadata update can bump its version without changing video bytes.
 * Only a newly verified owner-scoped catalog row of the SAME file may replace
 * the local revision when the caller has no drafts, edits or active order.
 * This never authorizes media analysis, a provider upload or publication.
 */
export function canAdoptVerifiedVideoRevision(previous,next,platform,now=Date.now()){
 const pattern=/^sha256:([a-f0-9]{64}):[0-9]{1,30}$/;
 const oldHash=pattern.exec(previous?.revision||''),newHash=pattern.exec(next?.revision||'');
 const fresh=Date.parse(next?.verified_at);
 return !!previous&&!!next&&typeof previous.id==='string'&&previous.id===next.id&&
  previous.media_kind==='video'&&next.media_kind==='video'&&
  previous.mime_type==='video/mp4'&&next.mime_type===previous.mime_type&&
  previous.name===next.name&&
  Number.isSafeInteger(previous.size_bytes)&&previous.size_bytes>0&&
  next.size_bytes===previous.size_bytes&&
  !!oldHash&&!!newHash&&oldHash[1]===newHash[1]&&previous.revision!==next.revision&&
  ['youtube','tiktok','instagram','facebook'].includes(platform)&&
  !previous.assignments?.some(a=>a.platform===platform)&&
  Array.isArray(next.assignments)&&!next.assignments.some(a=>a.platform===platform)&&
  Number.isSafeInteger(next.duration_ms)&&next.duration_ms>0&&
  Number.isSafeInteger(next.width_px)&&next.width_px>0&&
  Number.isSafeInteger(next.height_px)&&next.height_px>0&&
  Number.isFinite(fresh)&&Number.isFinite(now)&&now>=fresh&&now-fresh<14*60*1000;
}
