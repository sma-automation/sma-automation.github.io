import {verifyMusicBytes,verifyMusicProbe} from './media-music-model.mjs?v=1';
import {exportPlan,exportArguments,verifyMediaProbe,EXPORT_MAX_BYTES,sha256} from './media-export-model.mjs?v=2';
const coreBase='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/';
const coreFiles=[['ffmpeg-core.js','text/javascript',111804,'67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3'],['ffmpeg-core.wasm','application/wasm',32232419,'9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7']];
async function checkedCoreFile(entry,signal){const [name,type,size,hash]=entry,response=await fetch(coreBase+name,{credentials:'omit',referrerPolicy:'no-referrer',signal});if(!response.ok)throw Error('RENDERER_UNAVAILABLE');const data=await response.arrayBuffer();if(data.byteLength!==size||await sha256(data)!==hash)throw Error('RENDERER_UNAVAILABLE');return URL.createObjectURL(new Blob([data],{type}));}
export async function overlayPNG(doc,plan){
 const canvas=doc.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('RENDERER_UNAVAILABLE');
 const text=plan.settings.overlay_text;
 if(text){
  const fontSize=Math.max(16,Math.round(plan.width/25)),pad=Math.round(plan.width*.025),left=Math.round(plan.width*.05),max=plan.width-left*2-pad*2,lines=[];let line='';
  ctx.font=`500 ${fontSize}px Arial, sans-serif`;ctx.textBaseline='middle';ctx.textAlign='center';
  for(const ch of Array.from(text)){if(line&&ctx.measureText(line+ch).width>max){lines.push(line);line='';}line+=ch;}if(line)lines.push(line);
  const lineHeight=Math.ceil(fontSize*1.35),height=lines.length*lineHeight+2*pad,position=plan.settings.overlay_position;
  const top=Math.max(0,position==='top'?Math.round(plan.height*.05):position==='center'?Math.round((plan.height-height)/2):Math.round(plan.height*.95-height));
  ctx.fillStyle='rgba(0,0,0,0.7)';ctx.fillRect(left,top,plan.width-left*2,height);ctx.fillStyle='white';lines.forEach((line,n)=>ctx.fillText(line,plan.width/2,top+pad+lineHeight*(n+.5)));
 }
 return new Uint8Array(await (await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('RENDERER_UNAVAILABLE')),'image/png'))).arrayBuffer());
}
export async function withMediaEngine(signal,action){
 let ffmpeg;const urls=[];let timer;
 const abort=()=>ffmpeg?.terminate();signal.throwIfAborted();signal.addEventListener('abort',abort,{once:true});
 try{
  const {FFmpeg}=await import('../vendor/ffmpeg-0.12.15/index.js');ffmpeg=new FFmpeg();
  for(const entry of coreFiles){signal.throwIfAborted();urls.push(await checkedCoreFile(entry,signal));}
  signal.throwIfAborted();timer=setTimeout(()=>ffmpeg.terminate(),12*60*1000);
  await ffmpeg.load({coreURL:urls[0],wasmURL:urls[1]});signal.throwIfAborted();
  // core 0.12.10 leaves ret=-1 after a successful ffprobe. Read a fresh, named
  // report and validate its complete media metadata; never reuse a prior report.
  const probe=async name=>{const report=name+'.probe.json',rc=await ffmpeg.ffprobe(['-v','error','-show_error','-show_streams','-show_format','-of','json','-o',report,name],30000);if(rc!==0&&rc!==-1)throw Error('MEDIA_INVALID');const data=JSON.parse(await ffmpeg.readFile(report,'utf8'));if(data.error||data.format?.filename!==name)throw Error('MEDIA_INVALID');return data;};
  return await action(ffmpeg,probe);
 }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);ffmpeg?.terminate();urls.forEach(url=>URL.revokeObjectURL(url));}
}
export async function renderMedia({doc,file,settings,source,music=null,signal,onProgress=()=>{}}){
 const plan=exportPlan(file,settings);
 if(plan.settings.music)await verifyMusicBytes(music,plan.settings.music);
 try{
  onProgress('Exportwerkzeug wird geladen …');
  return await withMediaEngine(signal,async(ffmpeg,probe)=>{
   await ffmpeg.writeFile('source',new Uint8Array(await source.arrayBuffer()));
   const info=verifyMediaProbe(await probe('source'),file);
   if(plan.settings.music){await ffmpeg.writeFile('music',new Uint8Array(await music.arrayBuffer()));verifyMusicProbe(await probe('music'),plan.settings.music);}
   await ffmpeg.writeFile('overlay.png',await overlayPNG(doc,plan));signal.throwIfAborted();
   onProgress('Datei wird verarbeitet. Dieses Fenster bitte geöffnet lassen …');
   if(await ffmpeg.exec(exportArguments(plan,info.hasAudio),10*60*1000)!==0)throw Error('RENDER_FAILED');signal.throwIfAborted();
   const mediaName=plan.media_kind==='video'?'result.mp4':'result.png';verifyMediaProbe(await probe(mediaName),file,{outputPlan:plan,hasAudio:info.hasAudio});
   const bytes=await ffmpeg.readFile(mediaName);if(bytes.length<12||bytes.length>EXPORT_MAX_BYTES)throw Error('EXPORT_SIZE');
   const media=new Blob([bytes],{type:plan.media_kind==='video'?'video/mp4':'image/png'});let cover=null;
   if(plan.cover_ms!==null){onProgress('Coverbild wird erzeugt …');const at=Math.min(plan.cover_ms,Math.max(0,plan.duration_ms-34))/1000;if(await ffmpeg.exec(['-v','error','-ss',String(at),'-i',mediaName,'-frames:v','1','-map_metadata','-1','-threads','1','cover.png'],30000)!==0)throw Error('RENDER_FAILED');const c=await ffmpeg.readFile('cover.png');if(c.length<12||c.length>EXPORT_MAX_BYTES)throw Error('EXPORT_SIZE');cover=new Blob([c],{type:'image/png'});}
   signal.throwIfAborted();return {media,cover,plan};
  });
 }catch(e){signal.throwIfAborted();throw ['MUSIC_INVALID','MUSIC_REQUIRED','MEDIA_INVALID','EXPORT_SIZE','RENDERER_UNAVAILABLE','EXPORT_UNSUPPORTED'].includes(e?.message)?e:Error('RENDER_FAILED');}
}
