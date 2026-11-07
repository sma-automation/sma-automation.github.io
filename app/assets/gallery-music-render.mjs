import {withMediaEngine} from './media-export-render.mjs?v=3';
import {verifyMusicBytes,verifyMusicProbe} from './media-music-model.mjs?v=1';
import {EXPORT_MAX_BYTES} from './media-export-model.mjs?v=2';

// Copy the encoded video and its display metadata. Loop a short track, trim a long one.
export function soundtrackArgs(duration){
 return ['-hide_banner','-v','error','-xerror','-i','source','-stream_loop','-1','-t',String(duration),'-i','music',
  '-map','0:v:0','-map','1:a:0','-c:v','copy','-af','atrim=duration='+duration+',asetpts=PTS-STARTPTS,volume=0.25',
  '-c:a','aac','-b:a','128k','-threads','1','-movflags','+faststart','result.mp4'];
}
export async function soundtrackInEngine(ffmpeg,probe,{source,track,loadTrack,signal}){
 signal.throwIfAborted();
 await ffmpeg.writeFile('source',new Uint8Array(await source.arrayBuffer()));
 let input;
 try{input=await probe('source');}catch(error){if(error.message==='MEDIA_INVALID')return {state:'unsupported'};throw error;}
 const streams=input.streams;
 if(!Array.isArray(streams)||!input.format?.format_name?.split(',').includes('mp4'))return {state:'unsupported'};
 if(streams.some(s=>s.codec_type==='audio'))return {state:'audio_present'};
 // Do not silently discard additional video, subtitle or data streams.
 const video=streams[0],duration=Number(video?.duration??input.format.duration);
 if(streams.length!==1||video.codec_type!=='video'||video.disposition?.attached_pic===1||
    !Number.isFinite(duration)||duration<=0||duration>60)return {state:'unsupported'};
 const music=await loadTrack(track,signal);
 await verifyMusicBytes(music,track);
 await ffmpeg.writeFile('music',new Uint8Array(await music.arrayBuffer()));
 verifyMusicProbe(await probe('music'),track);
 signal.throwIfAborted();
 if(await ffmpeg.exec(soundtrackArgs(duration),180000)!==0)throw Error('RENDER_FAILED');
 const output=await probe('result.mp4');
 const v=output.streams?.find(s=>s.codec_type==='video'),a=output.streams?.find(s=>s.codec_type==='audio');
 if(output.streams?.length!==2||!v||v.codec_name!==video.codec_name||v.width!==video.width||v.height!==video.height||
    !Number.isFinite(Number(v.duration))||Math.abs(Number(v.duration)-duration)>.05||v.nb_frames!==video.nb_frames||
    a?.codec_name!=='aac'||!Number.isFinite(Number(a.duration))||Math.abs(Number(a.duration)-duration)>.05)throw Error('RENDER_FAILED');
 const bytes=await ffmpeg.readFile('result.mp4');
 signal.throwIfAborted();
 if(bytes.length<12||bytes.length>EXPORT_MAX_BYTES)return {state:'unsupported'};
 return {state:'rendered',blob:new Blob([bytes],{type:'video/mp4'})};
}
export function renderSoundtrack(input){
 return withMediaEngine(input.signal,(ffmpeg,probe)=>soundtrackInEngine(ffmpeg,probe,input));
}
