// Exercise the same pinned single-thread core and muxer as the browser. All fixtures are private to memory.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import makeCore from './media-runtime/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js';
import {soundtrackInEngine} from '../app/assets/gallery-music-render.mjs';
import {sha256} from '../app/assets/media-export-model.mjs';
globalThis.self={location:{href:'file:///worker.js'}};
const wasm=new URL('./media-runtime/node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm',import.meta.url);
const core=await makeCore({wasmBinary:await readFile(wasm),mainScriptUrlOrBlob:'file:///core.js#'+btoa(JSON.stringify({wasmURL:'file:///core.wasm'}))});
const run=(args)=>{core.setTimeout(45000);core.exec('-y',...args);const rc=core.ret;core.reset();return rc;};
const bytes=name=>core.FS.readFile(name);
const probe=async name=>{core.ffprobe('-v','error','-show_streams','-show_format','-of','json','-o','meta',name);core.reset();const raw=core.FS.readFile('meta',{encoding:'utf8'});core.FS.unlink('meta');return JSON.parse(raw);};
const ffmpeg={exec:run,writeFile:(name,data)=>core.FS.writeFile(name,data),readFile:bytes};
const make=(...args)=>assert.equal(run(['-v','error',...args]),0);
const videoHash=name=>{make('-i',name,'-map','0:v:0','-c:v','copy','-f','hash','hash.txt');return core.FS.readFile('hash.txt',{encoding:'utf8'});};
make('-f','lavfi','-i','color=c=blue:s=160x240:r=24:d=3','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','silent.mp4');
const source=new Blob([bytes('silent.mp4')],{type:'video/mp4'}),checksum=videoHash('silent.mp4'),signal=new AbortController().signal;
for(const duration of [1,5]){
 make('-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration='+duration,'-c:a','pcm_s16le','tone.wav');
 const music=new Blob([bytes('tone.wav')],{type:'audio/wav'}),track={name:'Test.wav',mime_type:'audio/wav',size_bytes:music.size,sha256:await sha256(await music.arrayBuffer()),start_ms:0,volume:25};
 const result=await soundtrackInEngine(ffmpeg,probe,{source,track,signal,loadTrack:async()=>music});
 assert.equal(result.state,'rendered');assert.equal(videoHash('result.mp4'),checksum);
 const out=await probe('result.mp4');assert.equal(Number(out.streams[0].duration),3);assert.ok(Math.abs(Number(out.streams[1].duration)-3)<.025);
 make('-i','result.mp4','-ss','2.5','-t','0.25','-map','0:a:0','-f','s16le','tail.raw');
 const samples=new Int16Array(bytes('tail.raw').buffer);assert.ok(samples.some(v=>Math.abs(v)>500),'Music must still be audible at the end');
 const preserved=await soundtrackInEngine(ffmpeg,probe,{source:result.blob,track,signal,loadTrack:()=>assert.fail('Existing audio must not request music')});
 assert.equal(preserved.state,'audio_present');
}
console.log('Browser FFmpeg core: shorter and longer tracks cover the video; identical video packets; existing audio preserved.');
