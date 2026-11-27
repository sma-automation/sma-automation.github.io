// Decode a small, owner- and revision-bound preview instead of downloading the full video.
export function createManualVideoThumbnails({portal,clips,drive}){
 const cache=new Map();
 async function frame(blob,signal){
  const v=document.createElement('video'),url=URL.createObjectURL(blob);
  v.muted=true;v.playsInline=true;v.preload='auto';
  try{
   return await new Promise((resolve,reject)=>{
    const fail=()=>reject(Error('Videobild nicht verfügbar.'));
    signal.addEventListener('abort',fail,{once:true});
    const cleanup=()=>signal.removeEventListener('abort',fail);
    v.onerror=()=>{cleanup();fail();};
    v.onloadedmetadata=()=>{if(v.duration>.15)v.currentTime=Math.min(.3,v.duration/2);};
    function capture(){
     if(v.seeking||v.readyState<2||!v.videoWidth)return;
     v.onloadeddata=v.onseeked=null;
     try{
      const canvas=document.createElement('canvas');
      const scale=Math.min(1,160/Math.max(v.videoHeight,v.videoWidth));
      canvas.width=Math.max(1,Math.round(v.videoWidth*scale));canvas.height=Math.max(1,Math.round(v.videoHeight*scale));
      canvas.getContext('2d').drawImage(v,0,0,canvas.width,canvas.height);
      canvas.toBlob(poster=>{cleanup();poster&&!signal.aborted?resolve(poster):fail();},'image/jpeg',.83);
     }catch{cleanup();fail();}
    }
    v.onloadeddata=v.onseeked=capture;
    if(signal.aborted){cleanup();fail();return;}
    v.src=url;
   });
  }finally{v.onloadedmetadata=v.onloadeddata=v.onseeked=v.onerror=null;v.removeAttribute('src');v.load();URL.revokeObjectURL(url);}
 }
 return {async request(file,signal){
  const key=JSON.stringify([file.id,file.revision]);
  if(cache.has(key))return cache.get(key);
  let poster;
  try{
   const timed=AbortSignal.any([signal,AbortSignal.timeout(5500)]);
   const clip=await clips.intro(file,portal,timed);
   if(!clip)throw Error('No clip');
   poster=await frame(clip,timed);
  }catch{signal.throwIfAborted();poster=await drive.request(file,signal);}
  signal.throwIfAborted();
  if(cache.size>=96)cache.delete(cache.keys().next().value);
  cache.set(key,poster);return poster;
 },clear(){cache.clear();clips.clear();}};
}
