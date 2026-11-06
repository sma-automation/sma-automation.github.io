import {readEditorSettings,editorUUID,editorTimestamp} from './media-editor-model.mjs?v=3';
export const EXPORT_MAX_BYTES=24000000;
export const EXPORT_RENDERER='sma-browser-export-v1';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function exportPlan(file,settings){
 const s=readEditorSettings(settings,file),w=file.width_px,h=file.height_px;
 if(!['video/mp4','image/jpeg','image/png','image/webp'].includes(file.mime_type)||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>4096||h>4096||w*h>12000000||!Number.isInteger(file.size_bytes)||file.size_bytes<1||file.size_bytes>EXPORT_MAX_BYTES||file.media_kind==='video'&&(!Number.isInteger(file.duration_ms)||file.duration_ms<1||file.duration_ms>60000))throw Error('EXPORT_UNSUPPORTED');
 const even=n=>Math.max(2,Math.floor(n/2)*2),factor=Math.min(1,1280/Math.max(w,h));
 const [width,height]=({'9:16':[720,1280],'1:1':[720,720],'16:9':[1280,720]})[s.format]||[even(w*factor),even(h*factor)];
 const scale=s.fit==='contain'?Math.min(width/w,height/h):Math.max(width/w,height/h),round=s.fit==='contain'?Math.floor:Math.ceil;
 const scaledWidth=Math.max(2,round(w*scale/2)*2),scaledHeight=Math.max(2,round(h*scale/2)*2);
 const x=Math.max(0,Math.round(Math.abs(width-scaledWidth)*s.position_x/200)*2),y=Math.max(0,Math.round(Math.abs(height-scaledHeight)*s.position_y/200)*2);
 return {width,height,scaledWidth,scaledHeight,x,y,fit:s.fit,settings:s,media_kind:file.media_kind,duration_ms:file.media_kind==='video'?(s.end_ms??file.duration_ms)-s.start_ms:null,cover_ms:s.cover_ms===null?null:s.cover_ms-s.start_ms};
}
export function exportArguments(plan,hasAudio=false){
 const p=plan,s=p.settings,geometry=`scale=${p.scaledWidth}:${p.scaledHeight}:flags=lanczos,`+(p.fit==='contain'?`pad=${p.width}:${p.height}:${p.x}:${p.y}:color=0xe8ecf5`:`crop=${p.width}:${p.height}:${p.x}:${p.y}`)+',setsar=1';
 const video=p.media_kind==='video',time=video?`trim=start=${s.start_ms/1000}:duration=${p.duration_ms/1000},setpts=PTS-STARTPTS,`:'';
 const music=video?s.music:null,original=video&&hasAudio&&s.audio_volume>0,extra=!!music&&music.volume>0;
 let filters=`[0:v:0]${time}${geometry}[base];[base][1:v:0]overlay=0:0:eof_action=repeat[v]`;
 const audio=(start,volume)=>`atrim=start=${start/1000}:duration=${p.duration_ms/1000},asetpts=PTS-STARTPTS,volume=${volume/100},apad,atrim=duration=${p.duration_ms/1000}`;
 if(original)filters+=`;[0:a:0]${audio(s.start_ms,s.audio_volume)}[original]`;
 if(extra)filters+=`;[2:a:0]${audio(music.start_ms,music.volume)}[music]`;
 if(original&&extra)filters+=';[original][music]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=0[a]';
 const args=['-hide_banner','-v','error','-xerror','-err_detect','explode','-i','source','-i','overlay.png',...(music?['-i','music']:[]),'-filter_complex',filters,'-map','[v]','-map_metadata','-1','-map_chapters','-1','-threads','1'];
 if(video){
  if(original||extra)args.push('-map',original&&extra?'[a]':original?'[original]':'[music]','-c:a','aac','-b:a','128k');else args.push('-an');
  args.push('-t',String(p.duration_ms/1000),'-r','30','-c:v','libx264','-preset','ultrafast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart','result.mp4');
 }else args.push('-frames:v','1','-an','-c:v','png','result.png');
 return args;
}
export function verifyMediaProbe(probe,file,{outputPlan=null,hasAudio=false}={}){
 if(!object(probe)||!Array.isArray(probe.streams))throw Error('MEDIA_INVALID');
 const vs=probe.streams.filter(s=>s.codec_type==='video'),as=probe.streams.filter(s=>s.codec_type==='audio');
 if(vs.length!==1||as.length>1)throw Error('MEDIA_INVALID');
 const v=vs[0],rotation=Number(v.side_data_list?.find(x=>x.rotation!==undefined)?.rotation||v.tags?.rotate||0),rotated=Math.abs(rotation)%180===90;
 const width=rotated?v.height:v.width,height=rotated?v.width:v.height,duration=Number(probe.format?.duration??v.duration)*1000;
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||width*height>12000000||width!==(outputPlan?.width??file.width_px)||height!==(outputPlan?.height??file.height_px))throw Error('MEDIA_INVALID');
 if(file.media_kind==='video'){
  const expected=outputPlan?.duration_ms??file.duration_ms;
  if(!Number.isFinite(duration)||duration<=0||duration>60500||Math.abs(duration-expected)>250)throw Error('MEDIA_INVALID');
  if(outputPlan&&(v.codec_name!=='h264'||v.pix_fmt!=='yuv420p'||as.length!==((hasAudio&&outputPlan.settings.audio_volume>0||outputPlan.settings.music?.volume>0)?1:0)))throw Error('MEDIA_INVALID');
 }
 if(outputPlan&&file.media_kind==='image'&&v.codec_name!=='png')throw Error('MEDIA_INVALID');
 return {hasAudio:as.length===1,width,height,duration_ms:Math.round(duration)};
}
export function readExportReceipt(r,context){
 if(!object(r)||r.ok!==true)throw Error(r?.code||'EXPORT_UNAVAILABLE');
 if(r.version!==1||r.can_publish!==false||r.export_id!==context.export_id||r.draft_revision!==context.draft_revision||!['prepared','completed'].includes(r.status))throw Error('EXPORT_UNAVAILABLE');
 const cover=context.has_cover;
 for(const k of ['media','cover']){if(k==='cover'&&!cover){if(r.cover!==null)throw Error('EXPORT_UNAVAILABLE');continue;}const a=r[k],mime=k==='media'&&context.file.media_kind==='video'?'video/mp4':'image/png',name='SMA-Export-'+context.export_id+(k==='cover'?'-Cover.png':mime==='video/mp4'?'.mp4':'.png');if(!object(a)||!editorUUID(a.upload_id)||k==='media'&&a.upload_id!==context.export_id||k==='cover'&&a.upload_id===context.export_id||a.mime_type!==mime||a.name!==name||(r.status==='completed'?!editorUUID(a.asset_id):a.asset_id!==null))throw Error('EXPORT_UNAVAILABLE');}
 return r;
}
export function readExportList(r){
 if(!object(r)||r.ok!==true||r.version!==1||r.can_publish!==false||!Array.isArray(r.exports)||r.exports.length>5)throw Error('EXPORT_UNAVAILABLE');
 return r.exports.map(e=>{if(!editorUUID(e.export_id)||!Number.isInteger(e.draft_revision)||e.draft_revision<0||!editorTimestamp(e.completed_at))throw Error('EXPORT_UNAVAILABLE');for(const k of ['media','cover']){const f=e[k];if(k==='cover'&&f===null)continue;if(!object(f)||!editorUUID(f.asset_id)||typeof f.asset_revision!=='string'||!/^sha256:[a-f0-9]{64}:[0-9]{1,30}$/.test(f.asset_revision)||typeof f.name!=='string'||f.name.length>250)throw Error('EXPORT_UNAVAILABLE');}return e;});
}
export async function sha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');}
