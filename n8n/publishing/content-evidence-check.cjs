'use strict';
const {createHash}=require('node:crypto');
const RULE='content-evidence-2026-11-02.1';
const SHA=/^[a-f0-9]{64}$/;
const PORTALS=['youtube','instagram','facebook','tiktok'];
function fail(code){throw Error(code);}
function text(value,max=20000){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))fail('CONTENT_INPUT_INVALID');return value.normalize('NFC');}
function id(value){if(typeof value!=='string'||!value.trim()||value.length>200)fail('CONTENT_INPUT_INVALID');return value;}
function parseAmount(raw,language){
 if(typeof raw!=='string'||!['de','en'].includes(language))return null;
 const s=raw.trim().replace(/\u00a0/g,' ');
 const valid=language==='de'?/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{2})?$/:/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?$/;
 if(!valid.test(s))return null;
 const normalized=language==='de'?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
 const [units,cents='00']=normalized.split('.');
 const minor=Number(units)*100+Number(cents);return Number.isSafeInteger(minor)?minor:null;
}
function prices(value,language){
 const out=[];
 const re=/(?<![\p{L}\p{N}.,])(?:(EUR|USD|GBP|€)\s*([+-]?\d[\d., \u00a0]*)|([+-]?\d[\d., \u00a0]*)\s*(EUR|USD|GBP|€))(?!\p{L})/gu;
 for(const m of value.matchAll(re)){const currency=m[1]||m[4],raw=(m[2]||m[3]).trim();out.push({currency:currency==='€'?'EUR':currency,minor:parseAmount(raw,language),raw});if(out.length>100)fail('CONTENT_INPUT_LIMIT');}
 return out;
}
function evidenceSource(envelope,context,approved){
 for(const key of ['customer_id','asset_id','asset_revision'])if(envelope?.[key]!==context[key])fail('CONTENT_BINDING_MISMATCH');
 const r=envelope.result;
 if(!r||r.content_sha256!==context.content_sha256||r.size_bytes!==context.size_bytes||!SHA.test(r.model_profile_sha256||'')||!Array.isArray(approved?.[r.schema])||!approved[r.schema].includes(r.model_profile_sha256)||r.can_publish!==false||r.content_verified!==false||r.untrusted_text!==true)fail('CONTENT_EVIDENCE_INVALID');
 let reconstructed='',uncertain=false,kind;
 if(r.schema==='sma.image-text.v1'){
  if(context.media_kind!=='image'||r.scope!=='single_image'||!Array.isArray(r.words)||r.words.length>2000)fail('CONTENT_EVIDENCE_INVALID');
  let previous;
  for(const word of r.words){if(!word||typeof word.line_key!=='string'||typeof word.confidence!=='number'||!Number.isFinite(word.confidence)||word.confidence<0||word.confidence>100)fail('CONTENT_EVIDENCE_INVALID');const w=text(word.text);if(!w)fail('CONTENT_EVIDENCE_INVALID');reconstructed+=(reconstructed?(previous===word.line_key?' ':'\n'):'')+w;previous=word.line_key;uncertain ||=word.confidence<80;}
  kind='ocr';
  if(r.status!==(reconstructed?'text_detected':'no_text_detected'))fail('CONTENT_EVIDENCE_INVALID');
 }else if(r.schema==='sma.speech-text.v1'){
  if(context.media_kind!=='video'||!Array.isArray(r.segments)||r.segments.length>500||!Number.isFinite(r.decoded_duration_ms)||r.decoded_duration_ms<=0||r.decoded_duration_ms>=60000||r.options?.language!==context.language)fail('CONTENT_EVIDENCE_INVALID');
  let previous=0;
  reconstructed=r.segments.map(s=>{if(!s||!Number.isSafeInteger(s.start_ms)||!Number.isSafeInteger(s.end_ms)||s.start_ms<previous||s.end_ms<=s.start_ms||s.end_ms>r.decoded_duration_ms+100)fail('CONTENT_EVIDENCE_INVALID');previous=s.end_ms;const t=text(s.text);if(!t)fail('CONTENT_EVIDENCE_INVALID');return t;}).join('\n');
  kind='speech';uncertain=true;
  if(r.status!==(reconstructed?'text_detected':'no_speech_detected'))fail('CONTENT_EVIDENCE_INVALID');
 }else fail('CONTENT_EVIDENCE_INVALID');
 if(text(r.text)!==text(reconstructed))fail('CONTENT_EVIDENCE_INVALID');
 return {kind,text:reconstructed,model_profile_sha256:r.model_profile_sha256,needs_review:uncertain};
}
// Internal worker input only: matching envelope fields do not authenticate a caller.
function compareEvidence({context,preview,product,evidence,approved_profiles},nowMs=Date.now()){
 if(!context||!preview||!product||!Array.isArray(evidence)||evidence.length>2||!Number.isFinite(nowMs))fail('CONTENT_INPUT_INVALID');
 const c={};
 for(const key of ['customer_id','asset_id','asset_revision','portal','text_revision','product_id','product_revision','language','media_kind'])c[key]=id(context[key]);
 if(!PORTALS.includes(c.portal)||!['de','en'].includes(c.language)||!['image','video'].includes(c.media_kind)||!/^(sha256:[a-f0-9]{64}|md5:[a-f0-9]{32}):\d+$/.test(c.asset_revision)||!SHA.test(context.content_sha256||'')||!Number.isSafeInteger(context.size_bytes)||context.size_bytes<=0)fail('CONTENT_INPUT_INVALID');
 c.content_sha256=context.content_sha256;c.size_bytes=context.size_bytes;
 if(c.asset_revision.startsWith('sha256:')&&c.asset_revision.split(':')[1]!==c.content_sha256)fail('CONTENT_BINDING_MISMATCH');
 for(const key of ['customer_id','asset_id','asset_revision','portal','text_revision'])if(preview[key]!==c[key])fail('CONTENT_BINDING_MISMATCH');
 if(product.customer_id!==c.customer_id||product.id!==c.product_id||product.revision!==c.product_revision)fail('CONTENT_BINDING_MISMATCH');
 if(!['EUR','USD','GBP'].includes(product.currency)||!(product.price_minor===null||(Number.isSafeInteger(product.price_minor)&&product.price_minor>=0))||![true,false,null].includes(product.available))fail('CONTENT_INPUT_INVALID');
 const title=text(preview.title,500),body=text(preview.body,10000);
 if(!title.trim()&&!body.trim())fail('CONTENT_INPUT_INVALID');
 const sources=evidence.map(e=>evidenceSource(e,c,approved_profiles));
 if(new Set(sources.map(s=>s.kind)).size!==sources.length)fail('CONTENT_EVIDENCE_INVALID');
 const findings=[{code:'SEMANTIC_ALIGNMENT_PENDING'}];
 const verified=typeof product.verified_at==='string'?Date.parse(product.verified_at):NaN;
 const fresh=Number.isFinite(verified)&&verified<=nowMs&&nowMs-verified<=900000;
 if(!fresh)findings.push({code:'PRODUCT_REFRESH_REQUIRED'});
 if(product.price_minor===null)findings.push({code:'PRODUCT_PRICE_MISSING'});
 if(fresh&&product.available===false)findings.push({code:'PRODUCT_UNAVAILABLE'});
 if(product.available===null)findings.push({code:'AVAILABILITY_UNKNOWN'});
 if(c.media_kind==='image'&&!sources.some(s=>s.kind==='ocr'))findings.push({code:'OCR_REQUIRED'});
 if(c.media_kind==='video'){
  findings.push({code:'VIDEO_VISUAL_CONTENT_PENDING'});
  if(context.audio_present===true&&!sources.some(s=>s.kind==='speech'))findings.push({code:'TRANSCRIPT_REQUIRED'});
  if(![true,false].includes(context.audio_present))findings.push({code:'AUDIO_STATUS_UNKNOWN'});
 }
 for(const source of sources){if(!source.text.trim())findings.push({code:'NO_TEXT_DETECTED',source:source.kind});if(source.needs_review)findings.push({code:'RECOGNITION_REVIEW_REQUIRED',source:source.kind});}
 const all=[{kind:'portal',text:[title,body].join('\n')},...sources];
 for(const source of all){
  for(const amount of prices(source.text,c.language)){
   if(amount.minor===null)findings.push({code:'PRICE_FORMAT_UNCLEAR',source:source.kind,raw:amount.raw});
   else if(fresh&&product.price_minor!==null&&(amount.currency!==product.currency||amount.minor!==product.price_minor))findings.push({code:'PRICE_DIFFERS_FROM_PRODUCT',source:source.kind,currency:amount.currency,price_minor:amount.minor});
   else findings.push({code:'PRICE_CONTEXT_REQUIRES_REVIEW',source:source.kind});
  }
 }
 const snapshot={context:c,preview:{title,body},product:{id:product.id,revision:product.revision,verified_at:product.verified_at??null,currency:product.currency,price_minor:product.price_minor,available:product.available},audio_present:c.media_kind==='video'?(context.audio_present??null):null,sources};
 return {schema:'sma.content-comparison.v1',rule_version:RULE,input_sha256:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),context:c,facts_valid_until:fresh?new Date(verified+900000).toISOString():null,outcome:'needs_review',findings,sources,checks:{price_comparison:fresh&&product.price_minor!==null?'performed':'pending',semantic_alignment:'pending',rights:'pending'},can_publish:false};
}
module.exports={RULE,parseAmount,prices,compareEvidence};
