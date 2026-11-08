/** Read-only local preflight for an operator-approved SMA catalogue master.
 *
 * Inputs are private local files. This tool never uploads, writes a database,
 * changes catalogue listing state, approves content, or makes purchases.
 * Usage: node n8n/publishing/verify-gallery-master.mjs MASTER.wav SIDE-CAR.aac
 */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, realpath, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, extname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceDir=dirname(fileURLToPath(import.meta.url));
const sha256=data=>createHash('sha256').update(data).digest('hex');
const fail=message=>{throw Error(message);};

export function masterMetadata(fileName, bytes, probe){
 const ext=extname(fileName).toLowerCase();
 const mime_type={'.wav':'audio/wav','.mp3':'audio/mpeg'}[ext];
 if(!mime_type)fail('Master must be WAV or MP3');
 if(!Number.isSafeInteger(bytes.length)||bytes.length<12||bytes.length>8000000)fail('Master size outside catalog limit');
 const streams=probe?.streams;
 if(!Array.isArray(streams)||streams.length!==1||streams[0]?.codec_type!=='audio')fail('Master needs exactly one audio stream');
 if(ext==='.wav'&&!String(probe?.format?.format_name||'').split(',').includes('wav'))fail('Master WAV container mismatch');
 if(ext==='.mp3'&&!String(probe?.format?.format_name||'').split(',').includes('mp3'))fail('Master MP3 container mismatch');
 const duration=Number(probe?.format?.duration);
 if(!Number.isFinite(duration)||duration<=0||duration>600)fail('Master duration outside 10-minute limit');
 const hash=sha256(bytes);
 return {sha256:hash, size_bytes:bytes.length,mime_type,object_name:hash+ext,duration_seconds:Number(duration.toFixed(3))};
}

export function sidecarMetadata(data, probe, masterHash){
 if(!/^[0-9a-f]{64}$/.test(masterHash))fail('Invalid master hash');
 if(data.length<12||data.length>1500000)fail('Sidecar outside 1.5MB limit');
 if(probe?.format?.format_name!=='aac')fail('Sidecar is not raw AAC ADTS');
 if(!Array.isArray(probe?.streams)||probe.streams.length!==1)fail('Sidecar must contain exactly one stream');
 const stream=probe.streams[0];
 if(stream.codec_type!=='audio'||stream.codec_name!=='aac'||stream.profile!=='LC'||Number(stream.sample_rate)!==48000||Number(stream.channels)!==2)fail('Sidecar must be stereo 48kHz AAC-LC');
 // FFprobe's estimated container duration can be inaccurate for raw VBR ADTS.
 // Count decoded ADTS frames instead (1024 samples per AAC-LC frame).
 const frames=Number(stream.nb_read_frames);
 if(!Number.isSafeInteger(frames)||frames<=0)fail('No countable AAC frames');
 const duration=frames*1024/48000;
 if(duration<60||duration>60.3)fail('Sidecar does not cover the 60-second render window');
 const hash=sha256(data);
 return {sha256:hash,size_bytes:data.length,mime_type:'audio/aac',duration_seconds:Number(duration.toFixed(3)),storage_path:`render/${masterHash}/${hash}.aac`};
}

function probeFile(file){
 const json=execFileSync('ffprobe',['-v','error','-count_frames','-show_format','-show_streams','-of','json',file],{encoding:'utf8',timeout:30000,maxBuffer:1048576});
 return JSON.parse(json);
}

export async function verifyGalleryMaster(masterPath,sidecarPath){
 const master=await realpath(masterPath),sidecar=await realpath(sidecarPath);
 if(!(await stat(master)).isFile()||!(await stat(sidecar)).isFile())fail('Both inputs must be regular files');
 const [masterBytes,sidecarBytes]=await Promise.all([readFile(master),readFile(sidecar)]);
 const catalog=masterMetadata(master,masterBytes,probeFile(master));
 const audio=sidecarMetadata(sidecarBytes,probeFile(sidecar),catalog.sha256);
 const tmp=await mkdtemp(join(tmpdir(),'sma-audio-preflight-'));
 try{
  const output=join(tmp,'rendered');
  const p=execFileSync('python3',[join(sourceDir,'prepare-gallery-audio.py'),master,output],{encoding:'utf8',timeout:150000,maxBuffer:200000});
  const generated=resolve(p.trim());
  const base=resolve(output)+sep;
  if(!generated.startsWith(base))fail('Untrusted generated path');
  const regenerated=await readFile(generated);
  if(!regenerated.equals(sidecarBytes))fail('Sidecar differs from the current SMA audio renderer output');
  if(relative(output,generated).replaceAll('\\','/')!==audio.storage_path)fail('Sidecar storage path mismatch');
  return {ok:true,status:'candidate_verified_only',approved:false,listed:false,master:catalog,sidecar:audio,
   checks:{single_master_stream:true,sidecar_format:true,render_bytes_identical:true},
   note:'No upload, listing, credit allocation, purchase or publication was performed.'};
 }finally{await rm(tmp,{recursive:true,force:true});}
}

const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 if(process.argv.length!==4){console.error('Usage: node n8n/publishing/verify-gallery-master.mjs MASTER.wav SIDE-CAR.aac');process.exitCode=2;}
 else verifyGalleryMaster(process.argv[2],process.argv[3]).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error('FAIL:',error.message);process.exitCode=1;});
}
