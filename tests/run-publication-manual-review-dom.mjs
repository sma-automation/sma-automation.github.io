import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
const source=(await readFile(new URL('../app/assets/publication-order.mjs',import.meta.url),'utf8')).replaceAll('export function','function').replaceAll('export const','const');
const keys=['full_playback','visual_clear','speech_text_checked','claims_match'];let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
function fixture({option=true,platform='youtube',approvalResponse,storedResponse,prepareResponse,refresh=async()=>{}}={}){
 const {document:doc}=parseHTML('<html><head></head><body></body></html>'),requests=[],reads=[],create=doc.createElement.bind(doc);
 doc.createElement=tag=>{const e=create(tag);e.handlers={};e.addEventListener=(name,fn)=>{e.handlers[name]=fn;};
  if(tag==='dialog'){e.showModal=()=>e.open=true;e.close=()=>e.open=false;}
  if(tag==='form')e.reportValidity=()=>true;
  if(tag==='select')Object.defineProperty(e,'value',{get(){return this.selectedValue||'';},set(v){this.selectedValue=v;}});
  if(tag==='input')e.checked=false;
  return e;
 };
 const binding={asset_id:'synthetic-asset',asset_revision:'sha256:'+'a'.repeat(64)+':2',platform,preview_id:'synthetic-preview',preview_revision:1,assignment_revision:1};let currentBinding={...binding},reloadPatch={};
 let sequence=8,clock=Date.now(),timer;class TestDate extends Date{static now(){return clock;}}
 const scope={Date:TestDate,setTimeout:f=>{timer=f;return 1;},clearTimeout:()=>{timer=null;},AbortSignal,crypto:{randomUUID:()=> 'ab660000-0000-4000-9000-'+String(++sequence).padStart(12,'0')},fetch:async(_url,opts)=>{
  const req=JSON.parse(opts.body);requests.push(req);const common={ok:true,id:req.input.id,can_publish:false,can_upload:false,target:{id:'synthetic-channel',platform},account_check:{target_id:'synthetic-channel',display_name:'Synthetic',policy:{privacy_levels:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_duration_sec:60}}};
  if(req.action==='approve'&&approvalResponse)return approvalResponse(req);
  if(req.action==='account')return {ok:true,json:async()=>({...common,stage:'account'})};
  const response={ok:true,json:async()=>({...common,binding,choices:req.input.choices||{visibility:'private'},state:req.action==='approve'?'approved':'prepared',approved_at:req.action==='approve'?new Date(clock).toISOString():null,draft:{title:'Synthetic title',caption:'Synthetic caption'},approval_policy:'media-consent-2026-11-03.1',approval_token:'synthetic-token',human_review_option:option?{policy_version:'human-video-2026-11-06.1',source_fingerprint:'b'.repeat(64)}:null,...(req.action==='get'?reloadPatch:{})})};
  return req.action==='prepare'&&prepareResponse?prepareResponse(req,response):response;
 }};
 vm.runInNewContext(source+';this.install=installOrderReview;this.confirm=reviewConfirmation;',scope);
 const view=scope.install(doc,{host:doc.body,portalName:platform,readStoredOrder:async id=>{
  reads.push(id);
  return storedResponse(id,{ok:true,id,binding,can_publish:false,can_upload:false,state:'approved',
   approved_at:new Date(clock).toISOString(),target:{id:'synthetic-channel',platform},choices:{visibility:platform==='youtube'?'private':'SELF_ONLY'},approval_policy:'media-consent-2026-11-03.1'});
 },session:async()=>({access_token:'synthetic'}),getContext:()=>({binding:currentBinding,name:'Synthetic.mp4'}),refresh});
 const $=id=>doc.getElementById(id),dialog=$('publicationOrderDialog'),buttons=[...dialog.querySelectorAll('button')],approve=buttons.find(e=>e.textContent==='Veröffentlichung freigeben'),status=buttons.find(e=>e.textContent==='Status erneut laden');
 const change=(id,value=true)=>{const e=$(id);e.checked=value;e.handlers.change();};
 const ready=()=>{for(const key of ['content_checked','media_rights','music_rights',...(platform==='tiktok'?['tiktok_music_terms']:[])])change('order-review-'+key);for(const key of keys)change('order-human-'+key);change('order-final-consent');};
 const open=async()=>{await $('preparePublicationOrder').handlers.click();$('order-visibility').value=platform==='youtube'?'private':'SELF_ONLY';if(platform==='youtube'){$('order-made_for_kids').value='false';$('order-contains_synthetic_media').value='false';}await dialog.querySelector('form').handlers.submit({preventDefault(){}});};
 return {$,doc,view,binding,requests,reads,approve,status,change,ready,open,advance:ms=>{clock+=ms;timer?.();},patch:v=>reloadPatch=v,changeBinding:()=>currentBinding={...binding,asset_revision:'changed'}};
}
{
 const t=fixture();await t.open();
 t.patch({approval_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()}});
 await t.status.handlers.click();t.change('order-human-enabled');t.ready();eq(t.approve.disabled,false);
 t.advance(61000);eq(t.approve.hidden,true);eq(t.approve.disabled,true);eq(t.$('order-final-consent').checked,false);
 eq(t.$('order-human-review').hidden,true);
 const restart=[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Vorbereitung neu starten');
 eq(restart.hidden,false);await t.approve.handlers.click();eq(t.requests.some(r=>r.action==='approve'),false);
 await restart.handlers.click();eq(t.requests.map(r=>r.action),['account','prepare','get','account']);
 eq(t.$('order-visibility').value,'');eq(t.$('order-final-consent').checked,false);
}
// The read-only return from History uses the saved ID, target and choices.
for(const platform of ['youtube','tiktok']){
 const t=fixture({platform}),expiry=new Date(Date.now()+60000).toISOString();
 const saved={ok:true,id:'ab660000-0000-4000-9000-000000000099',binding:t.binding,state:'prepared',approved_at:null,
  approval_window:{status:'active',expires_at:expiry},approval_policy:'media-consent-2026-11-03.1',
  approval_token:'saved-token',can_upload:false,can_publish:false,target:{id:'saved-channel',platform},
  choices:{visibility:platform==='youtube'?'private':'SELF_ONLY'},draft:{title:'Saved title',caption:'Saved caption'}};
 for(const patch of [{approval_window:null},{approval_window:{status:'recheck',expires_at:expiry}},
  {approval_window:{status:'active',expires_at:new Date(0).toISOString()}},{state:'cancelled'},
  {approved_at:expiry},{check_error:'FILE_CHANGED'},{approval_token:null},{can_upload:true},
  {target:{id:'foreign',platform:'other'}}]){
  eq(t.view.resumePrepared({...saved,...patch}),false);eq(!!t.$('publicationOrderDialog').open,false);
 }
 eq(t.view.resumePrepared(saved),true);
 eq(t.$('publicationOrderDialog').open,true);eq(t.approve.disabled,true);
 eq(t.$('order-final-consent').checked,false);eq(t.$('order-review-media_rights').checked,false);
 eq(t.requests.length,0);assert.match(t.doc.body.textContent,/Saved caption/);assert.match(t.doc.body.textContent,/saved-channel/);
 for(const key of ['content_checked','media_rights','music_rights',...(platform==='tiktok'?['tiktok_music_terms']:[])])t.change('order-review-'+key);
 t.change('order-final-consent');eq(t.requests.length,0);eq(t.approve.disabled,false);
 await t.approve.handlers.click();
 eq(t.requests.map(r=>r.action),['approve']);eq(t.requests[0].input.id,saved.id);eq(t.requests[0].input.approval_token,'saved-token');
}
// A historical declaration is a suggested choice for the identical file, text and channel.
{
 const t=fixture(),saved={state:'prepared',binding:t.binding,target:{id:'synthetic-channel'},
  choices:{made_for_kids:false,contains_synthetic_media:true,visibility:'public'}};
 const show=()=>t.$('preparePublicationOrder').handlers.click();
 t.view.rememberVideoChoices(saved);await show();
 const reuse=t.$('order-reuse-video'),kids=t.$('order-made_for_kids'),synthetic=t.$('order-contains_synthetic_media');
 eq(reuse.hidden,false);eq(kids.value,'');eq(synthetic.value,'');
 eq(kids.children[0].textContent,'Bisher Nein · bitte wählen');eq(synthetic.children[0].textContent,'Bisher Ja · bitte wählen');
 eq(t.$('order-visibility').value,'');eq(t.$('order-visibility').children[0].textContent,'Bitte auswählen');
 kids.value='true';kids.handlers.change();eq(reuse.hidden,true);reuse.handlers.click();eq(kids.value,'true');
 kids.value='';kids.handlers.change();reuse.handlers.click();
 eq(kids.value,'false');eq(synthetic.value,'true');eq(reuse.hidden,true);eq(t.$('order-visibility').value,'');
 eq(t.$('order-final-consent').checked,false);eq(t.requests.map(r=>r.action),['account']);
 t.$('order-visibility').value='private';synthetic.value='false';await t.doc.querySelector('form').handlers.submit({preventDefault(){}});
 eq(t.requests.at(-1).input.choices,{made_for_kids:false,contains_synthetic_media:false,visibility:'private'});
 await show();eq(t.$('order-contains_synthetic_media').children[0].textContent,'Bisher Nein · bitte wählen');
 for(const patch of [{state:'cancelled'},{approved_at:'today'},{target:{id:'elsewhere'}},{choices:{contains_synthetic_media:'true',made_for_kids:false}},{check_error:'FILE_CHANGED'},...['asset_id','asset_revision','assignment_revision','preview_id','preview_revision','platform'].map(key=>({binding:{...t.binding,[key]:'different'}}))]){
  t.view.rememberVideoChoices({...saved,...patch});await show();eq(reuse.hidden,true);
 }
 t.view.rememberVideoChoices(saved);await show();t.changeBinding();reuse.handlers.click();
 eq(reuse.hidden,true);eq(t.$('order-made_for_kids').value,'');eq(t.$('order-contains_synthetic_media').value,'');
 t.view.clear();await show();eq(reuse.hidden,true);
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
const timeout=()=>{throw Object.assign(new Error('timed out'),{code:23});};
const savedId='ab660000-0000-4000-9000-000000000010';
const authorize=async t=>{await t.open();t.ready();await t.approve.handlers.click();};
const notice=t=>t.doc.querySelector('[aria-live="polite"]').textContent;
for(const platform of ['youtube','tiktok']){
 for(const approvalResponse of [timeout,()=>({ok:true,json:async()=>{throw Error('Truncated JSON');}}),
  ()=>({ok:true,json:async()=>({ok:true,id:'wrong',state:'approved'})}),
  ()=>({ok:true,json:async()=>({ok:false,code:'ORDER_RUNNING'})}),
  ()=>({ok:false,json:async()=>({ok:false,code:'ORDER_NOT_PREPARED'})})]){
  const t=fixture({platform,approvalResponse,storedResponse:(_,row)=>row});
  await authorize(t);
  eq(t.reads,[savedId]);eq(t.requests.map(r=>r.action),['account','prepare','approve']);
  eq(t.approve.hidden,true);eq(t.$('order-final-consent').checked,false);
  assert.match(notice(t),/Freigabe ist gespeichert/);
 }
}
{
 let stored;
 const t=fixture({approvalResponse:timeout,storedResponse:(id,row)=>stored(id,row)});
 stored=()=>{throw Error('offline');};
 await authorize(t);eq(t.approve.disabled,true);eq(t.status.disabled,false);assert.match(notice(t),/noch unklar/);
 eq(t.$('order-review-media_rights').checked,false);
 await t.approve.handlers.click();eq(t.requests.length,3);
 for(const patch of [{id:'other'},{can_upload:true},{binding:{...t.binding,preview_revision:2}},{target:{id:'other'}}]){
  stored=(_,row)=>({...row,...patch});await t.status.handlers.click();assert.match(notice(t),/noch unklar/);eq(t.approve.disabled,true);
 }
 stored=(_,row)=>({...row,approved_at:null,state:'prepared',approval_token:'token',approval_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()}});
 t.$('publicationOrderDialog').close();await t.$('preparePublicationOrder').handlers.click();
 eq(t.reads.length,6);eq(t.reads.every(id=>id===savedId),true);eq(t.approve.hidden,false);eq(t.approve.disabled,true);
 for(const key of ['content_checked','music_rights','media_rights'])eq(t.$('order-review-'+key).checked,false);
 eq(t.$('order-final-consent').checked,false);eq(t.requests.length,3);
}
{
 const t=fixture({approvalResponse:()=>({ok:true,json:async()=>({ok:false,code:'TARGET_OPTIONS_CHANGED'})}),
  storedResponse:(_,row)=>({...row,state:'prepared',approved_at:null,approval_token:'token',
   approval_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()}})});
 await authorize(t);
 eq(t.reads,[savedId]);eq(t.approve.hidden,true);eq(t.approve.disabled,true);
 assert.match(notice(t),/Zielkonto muss erneut geprüft werden/);
 eq(t.requests.length,3);
}
{
 const duplicateId='ab660000-0000-4000-9000-000000000099';
 const t=fixture({approvalResponse:()=>({ok:true,json:async()=>({ok:false,code:'DUPLICATE_PUBLICATION',existing_order_id:duplicateId})}),
  storedResponse:(_,row)=>({...row,state:'checked'})});
 await authorize(t);
 eq(t.reads,[duplicateId]);eq(t.requests.map(r=>r.action),['account','prepare','approve']);
 eq(t.approve.hidden,true);assert.match(notice(t),/bereits ein freigegebener Auftrag/);
}
{
 let release,started;
 const reading=new Promise(resolve=>{started=resolve;});
 const t=fixture({approvalResponse:timeout,storedResponse:(_,row)=>{started();return new Promise(resolve=>{release=()=>resolve(row);});}});
 const pending=authorize(t);await reading;
 await t.status.handlers.click();eq(t.reads.length,1);t.view.clear();release();await pending;
 eq(notice(t),'');eq(t.$('publicationOrderDialog').open,false);eq(t.requests.length,3);
}
// Lost preparation responses only replay a write after an explicit form submission.
const submit=t=>t.doc.querySelector('form').handlers.submit({preventDefault(){}});
const reopen=async t=>{t.$('publicationOrderDialog').close();await t.$('preparePublicationOrder').handlers.click();};
function interruptedFixture(platform='youtube',options={}){
 let snapshot,read;
 const t=fixture({platform,prepareResponse:async(req,response)=>{
  snapshot={...await response.json(),approval_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()}};
  if(t.requests.filter(r=>r.action==='prepare').length===1)timeout();
  return response;
 },storedResponse:(id)=>read?read(snapshot):snapshot,...options});
 return Object.assign(t,{readAs:fn=>read=fn});
}
for(const platform of ['youtube','tiktok']){
 const t=interruptedFixture(platform);
 await t.open();eq(t.reads,[savedId]);eq(t.approve.hidden,false);eq(t.approve.disabled,true);
 await reopen(t);eq(t.reads,[savedId,savedId]);eq(t.requests.map(r=>r.action),['account','prepare']);
 eq(t.$('order-final-consent').checked,false);eq(t.$('order-review-music_rights').checked,false);
}
for(const missing of [false,true]){
 const t=interruptedFixture();const initial=s=>missing?{ok:false,code:'ORDER_UNAVAILABLE'}:{...s,state:'preparing',target:null,approval_token:null,approval_window:null};
 t.readAs(initial);await t.open();
 eq(t.doc.querySelector('form').hidden,false);eq(t.approve.hidden,true);eq(t.requests.length,2);
 t.readAs(()=>{throw Error('offline');});await reopen(t);
 eq(t.doc.querySelector('form').hidden,true);eq(t.status.hidden,false);eq(t.approve.disabled,true);
 await submit(t);eq(t.requests.length,2);assert.match(notice(t),/Stand der Vorbereitung ist noch unklar/);
 t.readAs(initial);await t.status.handlers.click();eq(t.doc.querySelector('form').hidden,false);eq(t.requests.length,2);
 await submit(t);eq(t.requests.map(r=>r.action),['account','prepare','prepare']);
 eq(t.requests[2].input,t.requests[1].input);eq(t.approve.hidden,false);eq(t.approve.disabled,true);
}
{
 const t=interruptedFixture('tiktok');
 for(const patch of [{id:'different'},{target:{id:'different'}},{can_publish:true},{choices:{visibility:'SELF_ONLY'}},
    {binding:{...t.binding,preview_revision:2}}]){
  t.readAs(s=>({...s,...patch}));
  if(!t.requests.length)await t.open();else await t.status.handlers.click();
  eq(t.approve.disabled,true);eq(t.approve.hidden,true);eq(t.doc.querySelector('form').hidden,true);
  await submit(t);eq(t.requests.length,2);
 }
 t.readAs(s=>({...s,state:'cancelled',approval_window:null,approval_token:null}));
 await t.status.handlers.click();assert.match(notice(t),/storniert/);eq(t.approve.hidden,true);eq(t.requests.length,2);
}
{
 const t=interruptedFixture();t.readAs(()=>({ok:false,code:'ORDER_UNAVAILABLE'}));
 await t.open();t.$('order-visibility').value='unlisted';await submit(t);
 eq(t.requests.length,3);assert.notEqual(t.requests[1].input.id,t.requests[2].input.id);
 eq(t.requests[2].input.choices.visibility,'unlisted');
}
{
 let release;const t=interruptedFixture('youtube',{refresh:()=>new Promise(resolve=>{release=resolve;})});
 const pending=t.open();await new Promise(resolve=>setImmediate(resolve));
 t.view.clear();release();await pending;eq(t.requests.map(r=>r.action),['account']);eq(t.reads.length,0);
}
console.log(checks+' manual review DOM checks passed; only synthetic requests.');
