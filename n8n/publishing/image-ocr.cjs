'use strict';
const {createHash}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {readFileSync}=require('node:fs');
const {isAbsolute,join}=require('node:path');
const {probeBytes}=require('./media-byte-probe.cjs');
const {verifyBytes}=require('./content-review.cjs');
const PROFILE='tesseract-image-text-2026-11-02.1';
function fail(code){throw Error(code);}
function parseTsv(tsv,width,height){
 if(typeof tsv!=='string'||Buffer.byteLength(tsv)>1048576)fail('OCR_INCOMPLETE');
 const rows=tsv.replace(/[\r\n]+$/, '').split(/\r?\n/);
 if(rows.shift()!=='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext')fail('OCR_INCOMPLETE');
 const words=[];let chars=0;
 for(const row of rows){
  const c=row.split('\t');if(c.length!==12)fail('OCR_INCOMPLETE');
  const nums=c.slice(0,11).map(v=>v.trim()===''?NaN:Number(v));
  if(nums.some(v=>!Number.isFinite(v))||nums.slice(0,10).some(v=>!Number.isSafeInteger(v)||v<0)||nums[0]<1||nums[0]>5||nums[1]!==1)fail('OCR_INCOMPLETE');
  if(nums[0]!==5)continue;
  const text=c[11].normalize('NFC').trim();if(!text)continue;
  if(/[\u0000-\u001f\u007f]/.test(text)||nums[10]<0||nums[10]>100||nums[6]+nums[8]>width||nums[7]+nums[9]>height||nums[8]===0||nums[9]===0)fail('OCR_INCOMPLETE');
  chars+=text.length;if(chars>20000||words.length>=2000)fail('OCR_LIMIT');
  words.push({text,confidence:nums[10],box:{x:nums[6],y:nums[7],width:nums[8],height:nums[9]},line_key:nums.slice(1,5).join(':')});
 }
 let text='',previous=null;
 for(const w of words){text+=(text?(previous===w.line_key?' ':'\n'):'')+w.text;previous=w.line_key;}
 return {status:words.length?'text_detected':'no_text_detected',text,words,needs_review:words.some(w=>w.confidence<80)};
}
function recognizeImage(bytes,expected,config){
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>12000000)fail('MEDIA_UNSUPPORTED');
 // Reject formats that Tesseract could interpret as a file list or document.
 const input=Buffer.from(bytes);
 const png=input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=input[0]===255&&input[1]===216&&input[2]===255;
 if(!png&&!jpeg)fail('MEDIA_UNSUPPORTED');
 const facts=probeBytes(input,expected);
 verifyBytes(input,{media_kind:'image',mime_type:png?'image/png':'image/jpeg',size_bytes:input.length,revision:'sha256:'+facts.content_sha256+':1'});
 if(facts.media_kind!=='image'||facts.streams[0].width*facts.streams[0].height>20000000)fail('MEDIA_UNSUPPORTED');
 if(!config||!['deu','eng','deu+eng'].includes(config.language)||!isAbsolute(config.tessdata_dir||''))fail('OCR_CONFIGURATION_REQUIRED');
 const models=[];
 for(const language of config.language.split('+')){
  let data;try{data=readFileSync(join(config.tessdata_dir,language+'.traineddata'));}catch{fail('OCR_LANGUAGE_UNAVAILABLE');}
  models.push({language,sha256:createHash('sha256').update(data).digest('hex')});
 }
 const env={PATH:process.env.PATH,LANG:'C',OMP_THREAD_LIMIT:'1'};
 const version=spawnSync('tesseract',['--version'],{env,timeout:3000,maxBuffer:16384,shell:false,windowsHide:true});
 if(version.error?.code==='ENOENT')fail('OCR_UNAVAILABLE');
 const engine=version.stdout?.toString().split(/\r?\n/)[0];
 if(version.error||version.status!==0||!/^tesseract 5\.\d+\.\d+(?:[-.\w]*)?$/.test(engine||''))fail('OCR_UNAVAILABLE');
 const result=spawnSync('tesseract',['stdin','stdout','--tessdata-dir',config.tessdata_dir,'-l',config.language,'--psm','11','-c','tessedit_create_tsv=1'],{input,env,timeout:20000,maxBuffer:1048576,shell:false,windowsHide:true});
 if(result.error||result.status!==0||result.signal)fail('OCR_FAILED');
 for(const model of models){
  let current;try{current=readFileSync(join(config.tessdata_dir,model.language+'.traineddata'));}catch{fail('OCR_MODEL_CHANGED');}
  if(createHash('sha256').update(current).digest('hex')!==model.sha256)fail('OCR_MODEL_CHANGED');
 }
 // Version, models and configuration are part of the evidence identity.
 const evidence=parseTsv(result.stdout.toString(),facts.streams[0].width,facts.streams[0].height);
 const identity={profile:PROFILE,engine,models,language:config.language,page_segmentation_mode:11};
 return {schema:'sma.image-text.v1',...identity,model_profile_sha256:createHash('sha256').update(JSON.stringify(identity)).digest('hex'),content_sha256:facts.content_sha256,size_bytes:facts.size_bytes,scope:'single_image',...evidence,untrusted_text:true,content_verified:false,can_publish:false};
}
module.exports={PROFILE,parseTsv,recognizeImage};
