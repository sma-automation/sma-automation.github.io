'use strict';
const {checkedDriveRevision,evidenceManifest}=require('./video-evidence.cjs');
const VIDEO_MAGIC_POLICY='magic-video-2026-11-02.1';
const VIDEO_SUBJECTS=['product','food','place','service_scene','document','other','unclear'];
const VIDEO_BAD_TEXT=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/u;
function videoFile(meta,context,folders) {
  if(context?.ok!==true||context.analysis?.policy_version!==VIDEO_MAGIC_POLICY||
     !Array.isArray(folders)||folders.length!==2||!Array.isArray(meta.parents)||!meta.parents.some(p=>folders.includes(p)))throw Error('FOLDER_UNAVAILABLE');
  const f={...context,revision:context.asset_revision};
  if(f.media_kind!=='video'||f.mime_type!=='video/mp4'||!Number.isSafeInteger(f.size_bytes)||f.size_bytes<1||f.size_bytes>24000000||
     !Number.isInteger(f.duration_ms)||f.duration_ms<1||f.duration_ms>60000||!/^sha256:[a-f0-9]{64}:\d+$/.test(f.revision||''))throw Error('VIDEO_UNSUPPORTED');
  checkedDriveRevision(meta,f);
  if(Number(meta.videoMediaMetadata?.durationMillis)!==f.duration_ms)throw Error('FILE_CHANGED');
  return f;
}
function videoTranscript(r) {
  if(typeof r?.text!=='string'||r.text.length>20000||VIDEO_BAD_TEXT.test(r.text))throw Error('TRANSCRIPT_INVALID');
  const transcript=r.text.trim();return {transcript,audio_status:transcript?'transcribed':'no_speech_recognized'};
}
function videoRecognitionRequest(prepared) {
  const props={subject_type:{type:'string',enum:VIDEO_SUBJECTS},description:{type:'string',minLength:20,maxLength:1000},
    spoken_summary:{type:'string',maxLength:1200}};
  for(const [key,count,max] of [['observations',8,180],['visible_text',12,160],['uncertainties',5,180]])
    props[key]={type:'array',maxItems:count,items:{type:'string',minLength:1,maxLength:max}};
  const r=prepared.request;
  return {...prepared,request:{...r,instructions:r.instructions+' Ordne das Motiv einer subject_type zu. Fasse gesprochene Aussagen separat in spoken_summary zusammen; sie sind nicht als sichtbare oder bestätigte Tatsachen darzustellen. Ohne erkanntes Sprechen muss spoken_summary leer sein. Bei unklarem Hauptmotiv subject_type unclear mit konkreter Unsicherheit. Halte alle Schema-Längen strikt ein.',
    text:{format:{type:'json_schema',name:'sma_video_magic_v1',strict:true,schema:{type:'object',additionalProperties:false,required:Object.keys(props),properties:props}}}}};
}
function videoRecognitionResult(response) {
  if(response?.status!=='completed'||response.error||response.incomplete_details||!Array.isArray(response.output))throw Error('VIDEO_RECOGNITION_FAILED');
  const messages=response.output.filter(x=>x.type==='message');
  if(messages.length!==1||messages[0].content?.length!==1||messages[0].content[0].type!=='output_text')throw Error('VIDEO_RECOGNITION_INVALID');
  const raw=messages[0].content[0].text;
  if(typeof raw!=='string'||raw.length>16000)throw Error('VIDEO_RECOGNITION_INVALID');
  let r;try{r=JSON.parse(raw);}catch{throw Error('VIDEO_RECOGNITION_INVALID');}
  if(!r||Array.isArray(r)||Object.keys(r).sort().join()!=='description,observations,spoken_summary,subject_type,uncertainties,visible_text'||!VIDEO_SUBJECTS.includes(r.subject_type))throw Error('VIDEO_RECOGNITION_INVALID');
  const text=(s,min,max)=>{if(typeof s!=='string'||s.trim().length<min||s.length>max||VIDEO_BAD_TEXT.test(s))throw Error('VIDEO_RECOGNITION_INVALID');return s.trim();};
  r.description=text(r.description,20,1000);r.spoken_summary=text(r.spoken_summary,0,1200);
  for(const [k,count,max] of [['observations',8,180],['visible_text',12,160],['uncertainties',5,180]]) {
    if(!Array.isArray(r[k])||r[k].length>count)throw Error('VIDEO_RECOGNITION_INVALID');r[k]=r[k].map(s=>text(s,1,max));
  }
  if(r.subject_type==='unclear'&&!r.uncertainties.length)throw Error('VIDEO_RECOGNITION_INVALID');return r;
}
function videoMagicResult(response,evidence,context) {
  const r=videoRecognitionResult(response),m=evidenceManifest(evidence.manifest,context),t=evidence.transcript;
  if(!['transcribed','no_audio_stream','no_speech_recognized'].includes(evidence.audio_status)||typeof t!=='string'||t.length>20000||VIDEO_BAD_TEXT.test(t)||
    (evidence.audio_status==='no_audio_stream')!==(m.audio_status==='no_audio_stream')||
    (evidence.audio_status==='transcribed'?(!t.trim()||!r.spoken_summary):(t!==''||r.spoken_summary!=='')))throw Error('TRANSCRIPT_INVALID');
  return {policy_version:VIDEO_MAGIC_POLICY,...r,transcript:t,audio_status:evidence.audio_status,
    evidence:{source_sha256:m.sha256,source_size_bytes:m.size_bytes,duration_ms:m.duration_ms,positions_ms:m.positions_ms,frame_sha256:m.frames.map(f=>f.sha256),sampling:m.sampling},
    content_comparison:'model_checked_sampled_evidence',requires_confirmation:true,can_publish:false};
}
module.exports={VIDEO_MAGIC_POLICY,videoFile,videoTranscript,videoRecognitionRequest,videoRecognitionResult,videoMagicResult};
