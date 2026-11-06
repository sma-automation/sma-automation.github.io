import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
const source=(await readFile(new URL('../app/assets/publication-order.mjs',import.meta.url),'utf8')).replaceAll('export function','function').replaceAll('export const','const');
const keys=['full_playback','visual_clear','speech_text_checked','claims_match'];let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
function fixture({option=true,platform='youtube'}={}){
 const {document:doc}=parseHTML('<html><head></head><body></body></html>'),requests=[],create=doc.createElement.bind(doc);
 doc.createElement=tag=>{const e=create(tag);e.handlers={};e.addEventListener=(name,fn)=>{e.handlers[name]=fn;};
  if(tag==='dialog'){e.showModal=()=>e.open=true;e.close=()=>e.open=false;}
  if(tag==='form')e.reportValidity=()=>true;
  if(tag==='select')Object.defineProperty(e,'value',{get(){return this.selectedValue||'';},set(v){this.selectedValue=v;}});
  if(tag==='input')e.checked=false;
  return e;
 };
 const binding={asset_id:'synthetic-asset',asset_revision:'sha256:'+'a'.repeat(64)+':2',platform};let currentBinding={...binding},reloadPatch={};
 const scope={AbortSignal,crypto:{randomUUID:()=> 'ab660000-0000-4000-9000-000000000010'},fetch:async(_url,opts)=>{
  const req=JSON.parse(opts.body);requests.push(req);const common={ok:true,id:req.input.id,can_publish:false,can_upload:false,target:{id:'synthetic-channel',platform},account_check:{target_id:'synthetic-channel',display_name:'Synthetic',policy:{privacy_levels:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_duration_sec:60}}};
  if(req.action==='account')return {ok:true,json:async()=>({...common,stage:'account'})};
  return {ok:true,json:async()=>({...common,binding,choices:req.input.choices||{visibility:'private'},state:req.action==='approve'?'approved':'prepared',draft:{title:'Synthetic title',caption:'Synthetic caption'},approval_policy:'media-consent-2026-11-03.1',approval_token:'synthetic-token',human_review_option:option?{policy_version:'human-video-2026-11-06.1',source_fingerprint:'b'.repeat(64)}:null,...(req.action==='get'?reloadPatch:{})})};
 }};
 vm.runInNewContext(source+';this.install=installOrderReview;this.confirm=reviewConfirmation;',scope);
 scope.install(doc,{host:doc.body,portalName:platform,session:async()=>({access_token:'synthetic'}),getContext:()=>({binding:currentBinding,name:'Synthetic.mp4'}),refresh:async()=>{}});
 const $=id=>doc.getElementById(id),dialog=$('publicationOrderDialog'),buttons=[...dialog.querySelectorAll('button')],approve=buttons.find(e=>e.textContent==='Veröffentlichung freigeben'),status=buttons.find(e=>e.textContent==='Status erneut laden');
 const change=(id,value=true)=>{const e=$(id);e.checked=value;e.handlers.change();};
 const ready=()=>{for(const key of ['content_checked','media_rights','music_rights',...(platform==='tiktok'?['tiktok_music_terms']:[])])change('order-review-'+key);for(const key of keys)change('order-human-'+key);change('order-final-consent');};
 const open=async()=>{await $('preparePublicationOrder').handlers.click();$('order-visibility').value=platform==='youtube'?'private':'SELF_ONLY';if(platform==='youtube'){$('order-made_for_kids').value='false';$('order-contains_synthetic_media').value='false';}await dialog.querySelector('form').handlers.submit({preventDefault(){}});};
 return {$,doc,requests,approve,status,change,ready,open,patch:v=>reloadPatch=v,changeBinding:()=>currentBinding={...binding,asset_revision:'changed'}};
}
for(const platform of ['youtube','tiktok']){
 const t=fixture({platform});await t.open();eq(t.$('order-human-review').hidden,false);eq(t.$('order-human-enabled').checked,false);eq(t.approve.disabled,true);eq(t.requests.map(x=>x.action),['account','prepare']);
 for(const key of keys){eq(t.$('order-human-'+key).checked,false);eq(t.$('order-human-'+key).disabled,true);}
 t.change('order-human-enabled');eq(t.$('order-final-consent').checked,false);for(const key of keys)eq(t.$('order-human-'+key).disabled,false);
 for(const key of ['content_checked','media_rights','music_rights',...(platform==='tiktok'?['tiktok_music_terms']:[])])t.change('order-review-'+key);
 t.change('order-final-consent');for(const key of keys){eq(t.approve.disabled,true);t.change('order-human-'+key);}eq(t.approve.disabled,false);
 await t.approve.handlers.click();eq(t.requests.map(x=>x.action),['account','prepare','approve']);
 const review=t.requests.at(-1).input.review;eq(review.human_review,{policy_version:'human-video-2026-11-06.1',source_fingerprint:'b'.repeat(64),full_playback:true,visual_clear:true,speech_text_checked:true,claims_match:true});eq(review.tiktok_music_terms,platform==='tiktok');eq(t.$('order-human-review').hidden,true);eq(t.$('order-human-enabled').checked,false);
}
{
 const t=fixture();await t.open();t.change('order-human-enabled');t.ready();eq(t.approve.disabled,false);
 t.change('order-human-enabled',false);eq(t.$('order-final-consent').checked,false);for(const key of keys)eq(t.$('order-human-'+key).checked,false);
 t.change('order-human-enabled');eq(t.approve.disabled,true);t.ready();await t.status.handlers.click();eq(t.approve.disabled,true);eq(t.$('order-human-enabled').checked,false);for(const key of keys)eq(t.$('order-human-'+key).checked,false);eq(t.requests.some(x=>x.action==='approve'),false);
 t.patch({human_review_option:null,check_error:'FILE_CHANGED'});await t.status.handlers.click();eq(t.$('order-human-review').hidden,true);eq(t.approve.disabled,true);
}
{
 const t=fixture({option:false});await t.open();eq(t.$('order-human-review').hidden,true);eq(t.$('order-human-enabled').disabled,true);t.change('order-human-enabled');t.ready();eq(t.approve.disabled,true);eq(t.requests.some(x=>x.action==='approve'),false);
}
{
 const t=fixture();await t.open();t.change('order-human-enabled');t.ready();t.changeBinding();await t.approve.handlers.click();eq(t.requests.some(x=>x.action==='approve'),false);
}
console.log(checks+' manual review DOM checks passed; only synthetic requests.');
