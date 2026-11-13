import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
const source=(await readFile(new URL('../app/assets/publication-order.mjs',import.meta.url),'utf8')).replaceAll('export function','function').replaceAll('export const','const');
const keys=['full_playback','visual_clear','speech_text_checked','claims_match'];let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
function fixture({option=true,platform='youtube',post={title:'Synthetic title',caption:'Synthetic caption'},verifySavedDraft=async()=>{},onOutdatedDraft,accountResponse,approvalResponse,storedResponse,prepareResponse,cancelResponse,readTransferStatus,refresh=async()=>{}}={}){
 const {document:doc}=parseHTML('<html><head></head><body></body></html>'),requests=[],reads=[],create=doc.createElement.bind(doc);
 doc.createElement=tag=>{const e=create(tag);e.handlers={};e.addEventListener=(name,fn)=>{e.handlers[name]=fn;};
  if(tag==='dialog'){e.showModal=()=>e.open=true;e.close=()=>e.open=false;}
  if(tag==='form')e.reportValidity=()=>true;
  if(tag==='select')Object.defineProperty(e,'value',{get(){return this.selectedValue||'';},set(v){this.selectedValue=v;}});
  if(tag==='input')e.checked=false;
  return e;
 };
 const binding={asset_id:'synthetic-asset',asset_revision:'sha256:'+'a'.repeat(64)+':2',platform,preview_id:'synthetic-preview',preview_revision:1,assignment_revision:1};let currentBinding={...binding},reloadPatch={},dirty=false;
 let sequence=8,clock=Date.now(),timer,savedPreparation;class TestDate extends Date{static now(){return clock;}}
 const scope={Date:TestDate,setTimeout:f=>{timer=f;return 1;},clearTimeout:()=>{timer=null;},AbortSignal,crypto:{randomUUID:()=> 'ab660000-0000-4000-9000-'+String(++sequence).padStart(12,'0')},fetch:async(_url,opts)=>{
  const req=JSON.parse(opts.body);requests.push(req);const common={ok:true,id:req.input.id,can_publish:false,can_upload:false,target:{id:'synthetic-channel',platform},account_check:{version:1,platform,target_id:'synthetic-channel',display_name:'Synthetic',permissions:platform==='youtube'?['youtube.upload']:['video.publish','user.info.basic'],
   policy:platform==='youtube'?{}:{privacy_levels:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_duration_sec:60},
   checked_at:new Date(clock).toISOString(),expires_at:new Date(clock+300000).toISOString()}};
  if(req.action==='approve'&&approvalResponse)return approvalResponse(req);
  if(req.action==='account'){
   const account={...common,stage:'account'};
   return {ok:true,json:async()=>accountResponse?accountResponse(account):account};
  }
  const response={ok:true,json:async()=>({...common,binding,choices:req.input.choices||{visibility:'private'},state:req.action==='approve'?'approved':'prepared',approved_at:req.action==='approve'?new Date(clock).toISOString():null,draft:{...post},approval_policy:'media-consent-2026-11-03.1',approval_token:'synthetic-token',approval_window:{status:'active',expires_at:new Date(clock+1800000).toISOString()},human_review_option:option?{policy_version:'human-video-2026-11-06.1',source_fingerprint:'b'.repeat(64)}:null,...(req.action==='get'?reloadPatch:{})})};
  if(req.action==='prepare'){
   savedPreparation=await response.json();
   if(prepareResponse)return prepareResponse(req,response);
  }
  return response;
 }};
 vm.runInNewContext(source+';this.install=installOrderReview;this.confirm=reviewConfirmation;',scope);
 const cancellations=[];
 const view=scope.install(doc,{host:doc.body,portalName:platform,readTransferStatus,cancelStoredOrder:async id=>{
  cancellations.push(id);
  return cancelResponse(id,savedPreparation);
 },readStoredOrder:async id=>{
  reads.push(id);
  if(!storedResponse)return {...savedPreparation,...reloadPatch};
  return storedResponse(id,{ok:true,id,binding,draft:{...post},can_publish:false,can_upload:false,state:'approved',
   approved_at:new Date(clock).toISOString(),target:{id:'synthetic-channel',platform},account_check:{target_id:'synthetic-channel'},choices:{visibility:platform==='youtube'?'private':'SELF_ONLY'},approval_policy:'media-consent-2026-11-03.1'});
 },session:async()=>({access_token:'synthetic'}),getContext:()=>{
  if(dirty)throw Error('Bitte speichere zuerst deine Änderungen.');
  return {binding:currentBinding,name:'Synthetic.mp4',post:{...post}};
 },verifySavedDraft,onOutdatedDraft,refresh});
 const $=id=>doc.getElementById(id),dialog=$('publicationOrderDialog'),buttons=[...dialog.querySelectorAll('button')],approve=buttons.find(e=>e.textContent==='Veröffentlichung freigeben'),status=buttons.find(e=>e.textContent==='Status erneut laden');
 const change=(id,value=true)=>{const e=$(id);e.checked=value;e.handlers.change();};
 const ready=()=>{for(const key of ['content_checked','media_rights','music_rights',...(platform==='tiktok'?['tiktok_music_terms']:[])])change('order-review-'+key);for(const key of keys)change('order-human-'+key);change('order-final-consent');};
 const open=async()=>{await $('preparePublicationOrder').handlers.click();$('order-visibility').value=platform==='youtube'?'private':'SELF_ONLY';if(platform==='youtube'){$('order-made_for_kids').value='false';$('order-contains_synthetic_media').value='false';}await dialog.querySelector('form').handlers.submit({preventDefault(){}});};
 return {$,doc,view,binding,requests,reads,cancellations,approve,status,change,ready,open,advance:ms=>{clock+=ms;timer?.();},patch:v=>reloadPatch=v,setDirty:value=>dirty=value,changeBinding:()=>currentBinding={...binding,asset_revision:'changed'}};
}
{
 const t=fixture();await t.open();
 t.patch({approval_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()}});
 await t.status.handlers.click();t.change('order-human-enabled');t.ready();eq(t.approve.disabled,false);
 t.advance(61000);eq(t.approve.hidden,true);eq(t.approve.disabled,true);eq(t.$('order-final-consent').checked,false);
 eq(t.$('order-human-review').hidden,true);
 const restart=[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Vorbereitung neu starten');
 eq(restart.hidden,false);await t.approve.handlers.click();eq(t.requests.some(r=>r.action==='approve'),false);
 await restart.handlers.click();eq(t.requests.map(r=>r.action),['account','prepare','account']);eq(t.reads,[t.requests[1].input.id]);
 eq(t.$('order-visibility').value,'');eq(t.$('order-final-consent').checked,false);
}
// The read-only return from History uses the saved ID, target and choices.
for(const platform of ['youtube','tiktok']){
 const t=fixture({platform,post:{title:'Saved title',caption:'Saved caption'}}),expiry=new Date(Date.now()+60000).toISOString();
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
 let finishRead;
 const opened=fixture({platform,post:{title:'Saved title',caption:'Saved caption'},
  readTransferStatus:()=>new Promise(resolve=>{finishRead=resolve;})});
 const checked={...saved,state:'checked',approval_token:null,approval_window:null,
  approved_at:new Date().toISOString(),approval_review:{media_rights:true}};
 eq(opened.view.resumePrepared(checked),true);eq(opened.requests.length,0);
 eq(opened.approve.hidden,true);eq(opened.status.textContent,'Auftrag prüfen und fortsetzen');
 eq(opened.status.hidden,true);await opened.status.handlers.click();eq(opened.requests.length,0);
 finishRead({message:'Ergebnis unklar.',canContinue:false});await new Promise(resolve=>setImmediate(resolve));
 eq(opened.status.hidden,true);await opened.status.handlers.click();eq(opened.requests.length,0);
 const refresh=[...opened.doc.querySelectorAll('button')].find(b=>b.textContent==='Übertragungsstand aktualisieren');
 const updated=refresh.handlers.click();finishRead({message:'Bestehender Vorgang kann abgeglichen werden.',canContinue:true});
 await updated;eq(opened.status.hidden,false);eq(opened.requests.length,0);
 await opened.status.handlers.click();
 eq(opened.requests.map(req=>[req.action,req.input.id]),[['get',checked.id]]);
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
 const restart=[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Vorbereitung neu starten');
 eq(restart.hidden,false);await restart.handlers.click();
 eq(t.$('order-contains_synthetic_media').children[0].textContent,'Bisher Nein · bitte wählen');
 t.view.clear(); // Start a fresh preview for the independent history-suggestion cases.
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
 let readCount=0,finish;
 const t=fixture({platform,approvalResponse:timeout,storedResponse:(_,row)=>({...row,state:'checked'}),
  readTransferStatus:async(id,target)=>{
   eq(id,savedId);eq(target,platform);readCount++;
   if(readCount===1)return {message:'Für diesen Auftrag ist noch kein Übertragungsversuch gespeichert.',canContinue:true};
   if(readCount===2)throw Error('unavailable');
   return new Promise(resolve=>{finish=resolve;});
  }});
 await authorize(t);
 const reload=[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Übertragungsstand aktualisieren');
 assert.match(t.doc.body.textContent,/noch kein Übertragungsversuch gespeichert/);
 eq(t.status.textContent,'Auftrag prüfen und fortsetzen');
 await reload.handlers.click();
 eq(t.status.hidden,true);await t.status.handlers.click();
 assert.match(t.doc.body.textContent,/Übertragungsstand konnte nicht geladen werden/);
 assert.doesNotMatch(t.doc.body.textContent,/noch kein Übertragungsversuch gespeichert/);
 const pending=reload.handlers.click();await reload.handlers.click();eq(readCount,3);
 t.view.clear();finish({message:'Veraltete Rückmeldung',canContinue:true});await pending;
 assert.doesNotMatch(t.doc.body.textContent,/Veraltete Rückmeldung/);
 eq(t.requests.map(r=>r.action),['account','prepare','approve']);
}
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
// A new tab has no previous request ID or form state. Only an explicit target check may write.
function unfinishedHistory(platform='youtube',cancelResponse){
 const id='ab660000-0000-4000-9000-000000000088',expires_at=new Date(Date.now()+60000).toISOString();
 const choices=platform==='youtube'?{visibility:'private',made_for_kids:false,contains_synthetic_media:true}:
  {visibility:'SELF_ONLY',disable_comment:true,disable_duet:true,disable_stitch:true,brand_organic_toggle:false,brand_content_toggle:false};
 let stored,loseReply=false;
 const t=fixture({post:{title:'History',caption:'Saved caption'},platform,cancelResponse,storedResponse:()=>stored,prepareResponse:async(req,response)=>{
  eq(req.input.id,id);eq(req.input.choices,choices);
  stored={...await response.json(),approval_window:{status:'active',expires_at},preparation_window:null};
  if(loseReply)timeout();
  return {ok:true,json:async()=>stored};
 }});
 stored={id,ok:true,state:'preparing',approved_at:null,target:null,approval_token:null,approval_window:null,
  preparation_window:{status:'active',expires_at},choices,binding:t.binding,can_upload:false,can_publish:false,
  draft:{title:'History',caption:'Saved caption'}};
 const check=[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Zielkonto prüfen');
 return {...t,id,check,resume:()=>t.view.resumePrepared(stored),patchSaved:p=>stored={...stored,...p},lose:()=>loseReply=true};
}
for(const platform of ['youtube','tiktok']){
 const t=unfinishedHistory(platform);
 eq(t.resume(),true);eq(t.approve.hidden,true);eq(t.check.disabled,false);eq(t.requests.length,0);
 await t.status.handlers.click();eq(t.reads,[t.id]);eq(t.requests.length,0);
 t.lose();await t.check.handlers.click();
 eq(t.requests.map(r=>r.action),['prepare']);eq(t.reads,[t.id,t.id,t.id]);
 eq(t.check.hidden,true);eq(t.approve.hidden,false);eq(t.approve.disabled,true);eq(t.$('order-final-consent').checked,false);
 await reopen(t);eq(t.reads.length,4);eq(t.requests.length,1);
}
for(const patch of [{state:'cancelled'},{approved_at:'now',state:'approved'},
   {choices:{visibility:'public'}},{binding:{platform:'other'}},{id:'other'},
   {check_error:'FILE_CHANGED'},{preparation_window:{status:'expired',expires_at:new Date(0).toISOString()}}]){
 const t=unfinishedHistory();eq(t.resume(),true);t.patchSaved(patch);await t.check.handlers.click();
 eq(t.requests.length,0);eq(t.reads,[t.id]);eq(t.approve.disabled,true);
}
{
 const t=unfinishedHistory();eq(t.resume(),true);t.advance(60001);eq(t.check.hidden,true);
 await t.check.handlers.click();eq(t.requests.length,0);eq(t.reads.length,0);
}
// Account preflight and order preparation are separate requests. An order may only
// become confirmable for the target and options that were displayed to the customer.
for(const platform of ['youtube','tiktok']){
 const mismatches=[
  row=>({...row,target:{...row.target,id:'different-channel'},account_check:{...row.account_check,target_id:'different-channel'}}),
  row=>({...row,target:{...row.target,platform:'other'}}),
  row=>({...row,account_check:{...row.account_check,target_id:'different-channel'}}),
  row=>({...row,account_check:null}),
  row=>({...row,choices:{...row.choices,visibility:platform==='youtube'?'public':'PUBLIC_TO_EVERYONE'}}),
  row=>({...row,choices:{...row.choices,[platform==='youtube'?'made_for_kids':'brand_content_toggle']:true}})
 ];
 for(const change of mismatches){
  let saved,changed=true;
  const t=fixture({platform,prepareResponse:async(req,response)=>{
   const row=await response.json();saved=changed?change(row):row;return {ok:true,json:async()=>saved};
  },storedResponse:()=>saved});
  await t.open();const id=t.requests[1].input.id;
  eq(t.reads,[id]);eq(t.approve.hidden,true);eq(t.approve.disabled,true);
  assert.match(notice(t),/gespeicherte Zielkonto|gespeicherten Portaleinstellungen/);
  await t.approve.handlers.click();await t.status.handlers.click();eq(t.reads,[id,id]);
  eq(t.requests.map(r=>r.action),['account','prepare']);
  const restart=[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Vorbereitung neu starten');
  eq(restart.hidden,false);changed=false;await restart.handlers.click();
  eq(t.$('order-visibility').value,'');eq(t.$('order-final-consent').checked,false);
  t.$('order-visibility').value=platform==='youtube'?'private':'SELF_ONLY';
  if(platform==='youtube'){t.$('order-made_for_kids').value='false';t.$('order-contains_synthetic_media').value='false';}
  await submit(t);eq(t.requests.map(r=>r.action),['account','prepare','account','prepare']);
  assert.notEqual(t.requests[3].input.id,id);eq(t.approve.hidden,false);eq(t.approve.disabled,true);
 }
 // An inconsistent response is recoverable if the stored order matches the complete selection.
 const transient=fixture({platform,prepareResponse:async(_,response)=>{
  const row=await response.json();return {ok:true,json:async()=>({...row,choices:{visibility:'invalid'}})};
 }});
 await transient.open();eq(transient.reads,[transient.requests[1].input.id]);
 eq(transient.approve.hidden,false);eq(transient.approve.disabled,true);eq(transient.requests.length,2);
 const status=fixture({platform});await status.open();status.ready();eq(status.approve.disabled,false);
 status.patch({choices:{visibility:'other'}});await status.status.handlers.click();
 eq(status.approve.hidden,true);eq(status.$('order-final-consent').checked,false);
 assert.match(notice(status),/gespeicherten Portaleinstellungen/);
 status.patch({});await status.status.handlers.click();eq(status.approve.hidden,false);eq(status.approve.disabled,true);
 eq(status.reads,[status.requests[1].input.id,status.requests[1].input.id]);eq(status.requests.length,2);
}
// Closing a normally prepared order should preserve its ID and deadline, but no declarations.
for(const platform of ['youtube','tiktok']){
 const t=fixture({platform});await t.open();
 const original=t.requests[1].input;
 t.change('order-human-enabled');t.ready();eq(t.approve.disabled,false);
 await reopen(t);
 eq(t.requests.map(r=>r.action),['account','prepare']);
 eq(t.reads,[original.id]);eq(t.approve.hidden,false);eq(t.approve.disabled,true);
 for(const key of ['content_checked','media_rights','music_rights','tiktok_music_terms','tiktok_branded_terms']){
  eq(t.$('order-review-'+key).checked,false);
 }
 for(const key of keys)eq(t.$('order-human-'+key).checked,false);
 eq(t.$('order-final-consent').checked,false);eq(t.$('order-human-enabled').checked,false);
 await reopen(t);eq(t.reads,[original.id,original.id]);eq(t.requests.length,2);
 // A queued close event from the previous opening must not clear the new expiry timer.
 t.$('publicationOrderDialog').handlers.close();
 t.advance(1800001);eq(t.approve.hidden,true);
}
for(const reason of ['ORDER_NOT_PREPARED','TARGET_OPTIONS_CHANGED']){
 const t=fixture({approvalResponse:()=>({ok:true,json:async()=>({ok:false,code:reason})})});
 await authorize(t);eq(t.approve.hidden,true);
 // A late read of the former active window cannot reverse the server's rejection.
 await reopen(t);eq(t.approve.hidden,true);eq(t.approve.disabled,true);
 eq(t.reads,[savedId,savedId]);eq(t.requests.map(r=>r.action),['account','prepare','approve']);
 assert.match(notice(t),reason==='ORDER_NOT_PREPARED'?/abgelaufen/:/erneut geprüft/);
}
for(const state of ['approved','checked','blocked','cancelled']){
 const t=fixture();await t.open();
 t.patch({state,approval_token:null,approved_at:state==='cancelled'?null:new Date().toISOString(),approval_window:null});
 await reopen(t);eq(t.reads,[t.requests[1].input.id]);eq(t.requests.length,2);
 eq(t.approve.hidden,true);eq(t.approve.disabled,true);
 assert.match(notice(t),state==='cancelled'?/storniert/:/Freigabe ist gespeichert/);
}
{
 const t=fixture();await t.open();t.ready();eq(t.approve.disabled,false);
 t.setDirty(true);await reopen(t);eq(t.reads,[]);eq(t.requests.length,2);
 assert.match(notice(t),/speichere/);eq(t.approve.hidden,true);eq(t.$('order-final-consent').checked,false);
 t.setDirty(false);await reopen(t);eq(t.reads,[t.requests[1].input.id]);eq(t.approve.disabled,true);
 t.changeBinding();await reopen(t);eq(t.reads.length,1);eq(t.requests.map(r=>r.action),['account','prepare','account']);
 eq(t.$('order-visibility').value,'');eq(t.approve.hidden,true);
}
{
 let offline=true,saved;
 const t=fixture({prepareResponse:async(_,response)=>{saved=await response.json();return response;},
  storedResponse:()=>{if(offline)throw Error('Offline');return saved;}});
 await t.open();const id=saved.id;
 await reopen(t);eq(t.approve.hidden,true);assert.match(notice(t),/noch unklar/);
 await t.approve.handlers.click();offline=false;await t.status.handlers.click();
 eq(t.reads,[id,id]);eq(t.requests.length,2);eq(t.approve.hidden,false);eq(t.approve.disabled,true);
}
{
 let finish,started,saved;const reading=new Promise(resolve=>{started=resolve;});
 const t=fixture({prepareResponse:async(_,response)=>{saved=await response.json();return response;},
  storedResponse:()=>{started();return new Promise(resolve=>finish=resolve);}});
 await t.open();t.ready();const readingOrder=reopen(t);await reading;
 eq(t.approve.disabled,true);eq(t.$('order-final-consent').checked,false);
 await t.$('preparePublicationOrder').handlers.click();await t.status.handlers.click();eq(t.reads,[saved.id]);
 t.view.clear();finish(saved);await readingOrder;eq(t.$('publicationOrderDialog').open,false);
 eq(notice(t),'');eq(t.requests.length,2);
}
{
 const t=fixture();await t.open();await reopen(t);
 const restart=[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Vorbereitung neu starten');
 eq(restart.hidden,false);await restart.handlers.click();
 eq(t.requests.map(r=>r.action),['account','prepare','account']);
 t.$('order-visibility').value='unlisted';t.$('order-made_for_kids').value='false';t.$('order-contains_synthetic_media').value='false';
 await submit(t);assert.notEqual(t.requests[3].input.id,t.requests[1].input.id);
 eq(t.requests[3].input.choices.visibility,'unlisted');eq(t.approve.disabled,true);
}
// Closing the new settings form before submitting returns to the previously saved order.
for(const platform of ['youtube','tiktok']){
 const t=fixture({platform});await t.open();
 const original=t.requests[1].input;
 t.change('order-human-enabled');t.ready();
 const restart=[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Vorbereitung neu starten');
 await restart.handlers.click();
 if(platform==='youtube')t.$('order-visibility').value='unlisted';
 else {
  t.change('order-commercial',true);
  t.change('order-brand_organic_toggle',true);
 }
 await reopen(t);
 eq(t.requests.map(r=>r.action),['account','prepare','account']);eq(t.reads,[original.id]);
 eq(t.approve.hidden,false);eq(t.approve.disabled,true);
 eq(t.$('order-human-enabled').checked,false);eq(t.$('order-final-consent').checked,false);
 assert.match(t.doc.body.textContent,platform==='youtube'?/Sichtbarkeit: Privat/:/Sichtbarkeit: Nur ich/);
}
const restartOrder=t=>[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Vorbereitung neu starten').handlers.click();
for(const change of ['expired','cancelled','approved','regressed']){
 const t=fixture();await t.open();const id=t.requests[1].input.id;await restartOrder(t);
 if(change==='expired')t.advance(1800001);
 else if(change==='regressed')t.patch({state:'preparing',target:null,account_check:null,approval_token:null,approval_window:null,
  preparation_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()}});
 else t.patch({state:change,approved_at:change==='approved'?new Date().toISOString():null,approval_token:null,approval_window:null});
 await reopen(t);eq(t.reads,[id]);eq(t.requests.length,3);eq(t.approve.hidden,true);
 assert.match(notice(t),{expired:/abgelaufen/,cancelled:/storniert/,approved:/Freigabe ist gespeichert/,regressed:/noch unklar/}[change]);
}
for(const change of ['different','offline']){
 let initial=true;
 const t=fixture({accountResponse:account=>{
  if(initial)return account;
  if(change==='offline')throw Error('Offline');
  return {...account,target:{...account.target,id:'other-channel'},account_check:{...account.account_check,target_id:'other-channel'}};
 }});
 await t.open();const id=t.requests[1].input.id;initial=false;await restartOrder(t);
 await reopen(t);eq(t.reads,[id]);eq(t.requests.length,3);eq(t.approve.hidden,true);
 assert.match(notice(t),/Zielkonto muss erneut geprüft werden/);
}
{
 const t=fixture();await t.open();await restartOrder(t);t.changeBinding();await reopen(t);
 eq(t.reads,[]);eq(t.requests.map(r=>r.action),['account','prepare','account','account']);
 eq(t.$('order-visibility').value,'');eq(t.approve.hidden,true);
}
{
 const t=fixture();await t.open();await restartOrder(t);t.view.clear();
 await reopen(t);eq(t.reads,[]);eq(t.approve.hidden,true);
}
{
 const t=unfinishedHistory('tiktok');eq(t.resume(),true);await restartOrder(t);
 await reopen(t);eq(t.reads,[t.id]);eq(t.check.hidden,false);eq(t.approve.hidden,true);
 eq(t.requests.map(r=>r.action),['account']);
}
{
 const t=fixture();await t.open();const original=t.requests[1].input;
 t.patch({choices:{...original.choices,visibility:'public'}});
 await t.status.handlers.click();assert.match(notice(t),/weichen von deiner Auswahl ab/);
 await restartOrder(t);await reopen(t);
 eq(t.reads,[original.id,original.id]);eq(t.approve.hidden,true);eq(t.requests.length,3);
 assert.match(notice(t),/weichen von deiner Auswahl ab/);
}
{
 const t=fixture({refresh:async()=>{if(t.requests.length>2)throw Error('Dateistand nicht verfügbar.');}});
 await t.open();const id=t.requests[1].input.id;await restartOrder(t);
 t.$('order-visibility').value='unlisted';await submit(t);await reopen(t);
 eq(t.reads,[id]);eq(t.requests.length,3);eq(t.approve.hidden,false);
}
// Once the replacement request is sent, even a lost response must resolve against its own ID.
for(const lost of [false,true]){
 let count=0;
 const t=fixture({prepareResponse:async(_,response)=>{if(++count===2&&lost)timeout();return response;}});
 await t.open();const first=t.requests[1].input.id;await restartOrder(t);
 t.$('order-visibility').value='unlisted';t.$('order-made_for_kids').value='false';t.$('order-contains_synthetic_media').value='false';
 await submit(t);const replacement=t.requests[3].input.id;assert.notEqual(first,replacement);
 await reopen(t);eq(t.reads,lost?[replacement,replacement]:[replacement]);eq(t.requests.length,4);
 eq(t.approve.disabled,true);eq(t.approve.hidden,false);assert.match(t.doc.body.textContent,/Sichtbarkeit: Nicht gelistet/);
}
function chooseOriginal(t,platform){
 t.$('order-visibility').value=platform==='youtube'?'private':'SELF_ONLY';
 if(platform==='youtube'){
  t.$('order-made_for_kids').value='false';t.$('order-contains_synthetic_media').value='false';
 }
}
for(const platform of ['youtube','tiktok']){
 const t=fixture({platform});await t.open();const id=t.requests[1].input.id;
 t.ready();t.advance(60000);await restartOrder(t);chooseOriginal(t,platform);await submit(t);
 eq(t.requests.map(r=>r.action),['account','prepare','account']);eq(t.reads,[id]);
 eq(t.approve.hidden,false);eq(t.approve.disabled,true);eq(t.$('order-final-consent').checked,false);
 assert.match(notice(t),/ursprüngliche Frist/);
 await reopen(t);eq(t.reads,[id,id]);eq(t.requests.length,3);
 t.advance(1740001);eq(t.approve.hidden,true);
}
// A concurrent transition changes what is displayed; it never initiates a new write by itself.
for(const state of ['approved','checking','checked','blocked','cancelled']){
 const t=fixture();await t.open();const id=t.requests[1].input.id;await restartOrder(t);
 t.patch({state,approval_token:null,approval_window:null,approved_at:state==='cancelled'?null:new Date().toISOString()});
 chooseOriginal(t,'youtube');await submit(t);eq(t.reads,[id]);eq(t.requests.length,3);
 eq(t.approve.hidden,true);assert.match(notice(t),state==='cancelled'?/storniert/:/Freigabe ist gespeichert/);
}
{
 const t=fixture();await t.open();await restartOrder(t);t.patch({check_error:'FILE_CHANGED'});
 chooseOriginal(t,'youtube');await submit(t);eq(t.requests.length,3);eq(t.approve.disabled,true);
 assert.match(t.doc.body.textContent,/Datei wurde geändert/);
}
for(const windowStatus of ['expired','recheck']){
 let count=0;const t=fixture({prepareResponse:async(_,response)=>{count++;return response;}});
 await t.open();const old=t.requests[1].input.id;await restartOrder(t);
 t.patch({approval_window:{status:windowStatus,expires_at:new Date(Date.now()+60000).toISOString()}});
 chooseOriginal(t,'youtube');await submit(t);
 eq(t.reads,[old]);eq(count,2);assert.notEqual(t.requests[3].input.id,old);
 eq(t.approve.hidden,false);eq(t.approve.disabled,true);
}
for(const change of ['duration','privacy','permissions','reordered']){
 let first=true;
 const t=fixture({platform:'tiktok',accountResponse:row=>{
  if(first)return row;
  const e=row.account_check,policy={...e.policy};
  if(change==='duration')policy.max_duration_sec=30;
  if(change==='privacy')policy.privacy_levels=['SELF_ONLY','MUTUAL_FOLLOW_FRIENDS'];
  if(change==='reordered')return {...row,account_check:{...e,policy:Object.fromEntries(Object.entries(policy).reverse()),permissions:[...e.permissions].reverse()}};
  return {...row,account_check:{...e,policy,permissions:change==='permissions'?['video.publish']:e.permissions}};
 },prepareResponse:async(_,response)=>{const row=await response.json();return {ok:true,json:async()=>({...row,choices:Object.fromEntries(Object.entries(row.choices).reverse())})};}});
 await t.open();first=false;await restartOrder(t);chooseOriginal(t,'tiktok');await submit(t);
 eq(t.reads,[t.requests[1].input.id]);eq(t.requests.length,change==='reordered'?3:4);eq(t.approve.disabled,true);
}
{
 let saved,offline=true;
 const t=fixture({prepareResponse:async(_,response)=>{saved=await response.json();return response;},
  storedResponse:()=>{if(offline)throw Error('Offline');return saved;}});
 await t.open();await restartOrder(t);chooseOriginal(t,'youtube');await submit(t);
 eq(t.requests.length,3);eq(t.approve.hidden,true);eq(t.doc.querySelector('form').hidden,false);
 offline=false;await submit(t);eq(t.requests.length,3);eq(t.reads,[saved.id,saved.id]);
 eq(t.approve.disabled,true);eq(t.approve.hidden,false);
}
{
 const t=fixture();await t.open();await restartOrder(t);
 t.patch({choices:{visibility:'unlisted'},approval_window:{status:'expired',expires_at:new Date().toISOString()}});
 chooseOriginal(t,'youtube');await submit(t);eq(t.requests.length,3);eq(t.approve.hidden,true);
 assert.match(notice(t),/gespeicherten Portaleinstellungen/);
}
for(const interrupt of ['logout','edit']){
 let saved,finish,started;const reading=new Promise(resolve=>started=resolve);
 const t=fixture({prepareResponse:async(_,response)=>{saved=await response.json();return response;},
  storedResponse:()=>{started();return new Promise(resolve=>finish=resolve);}});
 await t.open();await restartOrder(t);chooseOriginal(t,'youtube');
 const pending=submit(t);await reading;await submit(t);eq(t.reads,[saved.id]);
 if(interrupt==='logout')t.view.clear();else t.changeBinding();
 finish(saved);await pending;eq(t.requests.length,3);eq(t.approve.hidden,true);
}
// The duplicate guard uses the file version and target even if the two saved captions differ.
const otherOrderId='ab660000-0000-4000-9000-000000000099';
const duplicateReply=()=>({ok:true,json:async()=>({ok:false,code:'DUPLICATE_PUBLICATION',existing_order_id:otherOrderId})});
for(const platform of ['youtube','tiktok']){
 const t=fixture({platform,approvalResponse:duplicateReply,storedResponse:(_,row)=>({...row,state:'checked',
  binding:{...row.binding,preview_id:'previous-preview',preview_revision:2,assignment_revision:3},
  approved_at:'2026-11-07T20:13:00Z',choices:{visibility:'public'},draft:{title:'Ursprünglicher Beitrag <img src=x>'}})});
 await authorize(t);const receipt=t.doc.querySelector('a[href*="#auftrag/"]');
 eq(receipt?.getAttribute('href'),'dashboard.html#auftrag/'+otherOrderId);
 eq(receipt.target,'_top');eq(t.approve.disabled,true);eq(t.approve.hidden,true);
 assert.match(t.doc.body.textContent,/Ursprünglicher Beitrag <img src=x>/);eq(t.doc.querySelector('img'),null);
 assert.match(t.doc.body.textContent,/Freigegeben am .*21:13 Uhr \(Wien\)/);
 await t.approve.handlers.click();await t.status.handlers.click();eq(t.reads,[otherOrderId,otherOrderId]);
 eq(t.requests.map(r=>r.action),['account','prepare','approve']);
}
const historyLink=t=>t.doc.querySelector('a[href*="#auftrag/"]');
for(const platform of ['youtube','tiktok']){
 let matches=true;
 const t=fixture({platform,prepareResponse:duplicateReply,storedResponse:(_,row)=>({...row,
  target:{...row.target,id:matches?row.target.id:'other-channel'},
  binding:{...row.binding,preview_revision:3},draft:{title:'Bereits freigegeben'}})});
 await t.open();
 eq(t.requests[1].input.expected_target_id,'synthetic-channel');
 eq(historyLink(t)?.getAttribute('href'),'dashboard.html#auftrag/'+otherOrderId);
 eq(t.approve.hidden,true);eq(t.approve.disabled,true);eq(t.$('order-final-consent').checked,false);
 await t.approve.handlers.click();await submit(t);
 matches=false;await t.status.handlers.click();eq(historyLink(t),null);
 matches=true;await reopen(t);eq(historyLink(t)?.getAttribute('href'),'dashboard.html#auftrag/'+otherOrderId);
 eq(t.requests.map(r=>r.action),['account','prepare']);eq(t.reads,[otherOrderId,otherOrderId,otherOrderId]);
}
{
 const t=fixture({prepareResponse:req=>({ok:true,json:async()=>({ok:false,code:'DUPLICATE_PUBLICATION',existing_order_id:req.input.id})})});
 await t.open();eq(t.reads,[]);eq(historyLink(t),null);eq(t.status.hidden,false);eq(t.approve.disabled,true);
}

{
 const t=fixture();await authorize(t);eq(historyLink(t).getAttribute('href'),'dashboard.html#auftrag/'+savedId);
 eq(t.reads.length,0);t.view.clear();eq(historyLink(t),null);
}
for(const bad of [null,'',savedId,'https://example.invalid/',[otherOrderId]]){
 const t=fixture({approvalResponse:()=>({ok:true,json:async()=>({ok:false,code:'DUPLICATE_PUBLICATION',existing_order_id:bad})})});
 await authorize(t);eq(t.reads.length,0);eq(historyLink(t),null);eq(t.approve.hidden,true);
}
{
 let change=row=>row;const t=fixture({approvalResponse:duplicateReply,storedResponse:(_,row)=>change({...row,draft:{title:'Saved receipt'}})});
 await authorize(t);eq(!!historyLink(t),true);
 for(const bad of [
  r=>({...r,id:savedId}),r=>({...r,state:'prepared'}),r=>({...r,state:'cancelled'}),r=>({...r,approved_at:null}),
  r=>({...r,approved_at:'not-a-date'}),r=>({...r,can_publish:true}),r=>({...r,binding:null}),
  r=>({...r,binding:{...r.binding,asset_id:'another'}}),r=>({...r,binding:{...r.binding,asset_revision:'other'}}),
  r=>({...r,binding:{...r.binding,platform:'tiktok'}}),r=>({...r,target:{...r.target,id:'other'}}),
  r=>({...r,target:{...r.target,platform:'tiktok'}}),()=>({ok:false,code:'ORDER_UNAVAILABLE'}),
  ()=>{throw Error('offline');}
 ]){
  change=bad;await t.status.handlers.click();
  eq(historyLink(t),null);eq(t.approve.hidden,true);assert.doesNotMatch(t.doc.body.textContent,/Saved receipt/);
 }
 change=r=>r;await reopen(t);eq(!!historyLink(t),true);eq(t.requests.length,3);
 t.view.clear();eq(historyLink(t),null);
}
{
 let finish,started;const reading=new Promise(resolve=>started=resolve);
 const t=fixture({approvalResponse:duplicateReply,storedResponse:(_,row)=>{started();return new Promise(resolve=>finish=()=>resolve(row));}});
 const done=authorize(t);await reading;await t.status.handlers.click();eq(t.reads,[otherOrderId]);
 t.view.clear();finish();await done;eq(historyLink(t),null);eq(notice(t),'');
 eq(t.requests.map(r=>r.action),['account','prepare','approve']);
}
const cancelButton=t=>[...t.doc.querySelectorAll('button')].find(b=>b.textContent==='Vorbereitung abbrechen');
const cancelled=row=>({...row,state:'cancelled',approved_at:null,approval_token:null,approval_window:null,preparation_window:null});
for(const platform of ['youtube','tiktok']){
 const t=fixture({platform,cancelResponse:(_,row)=>cancelled(row)}),button=cancelButton(t);
 eq(button.hidden,true);await t.open();eq(button.hidden,false);
 t.ready();await button.handlers.click();eq(t.cancellations,[savedId]);eq(t.reads,[]);
 eq(t.requests.map(r=>r.action),['account','prepare']);eq(button.hidden,true);
 assert.match(notice(t),/storniert/);eq(t.approve.hidden,true);eq(t.$('order-final-consent').checked,false);
 eq(historyLink(t)?.getAttribute('href'),'dashboard.html#auftrag/'+savedId);
 eq(historyLink(t)?.textContent,'Abgebrochenen Auftrag in der History öffnen');
 await button.handlers.click();await t.approve.handlers.click();eq(t.cancellations.length,1);
 const pending=unfinishedHistory(platform,()=>{throw Error('lost');});
 pending.resume();pending.patchSaved({state:'cancelled',approval_token:null,preparation_window:null});
 await cancelButton(pending).handlers.click();eq(pending.cancellations,[pending.id]);
 eq(pending.reads,[pending.id]);eq(pending.requests,[]);assert.match(notice(pending),/storniert/);
}
{
 let saved,readable=false;
 const t=fixture({prepareResponse:async(_,r)=>{saved=await r.json();return r;},
  cancelResponse:()=>{throw Error('lost');},storedResponse:()=>{if(!readable)throw Error('offline');return saved;}});
 await t.open();await cancelButton(t).handlers.click();eq(t.approve.disabled,true);eq(cancelButton(t).hidden,true);
 readable=true;await t.status.handlers.click();eq(cancelButton(t).hidden,false);eq(t.approve.disabled,true);
 assert.match(notice(t),/noch vorbereitet/);eq(t.cancellations,[savedId]);eq(t.reads,[savedId,savedId]);
}
{
 // The second tab approved first. All subsequent status reads stay off the dispatcher.
 let saved;
 const t=fixture({prepareResponse:async(_,r)=>{saved=await r.json();return r;},
  cancelResponse:()=>({ok:false,code:'ORDER_NOT_CANCELLABLE'}),
  storedResponse:()=>({...saved,state:'approved',approved_at:new Date().toISOString(),approval_token:null,approval_window:null})});
 await t.open();await cancelButton(t).handlers.click();await t.status.handlers.click();await reopen(t);
 eq(historyLink(t)?.getAttribute('href'),'dashboard.html#auftrag/'+savedId);eq(t.approve.hidden,true);eq(cancelButton(t).hidden,true);
 eq(t.cancellations,[savedId]);eq(t.reads,[savedId,savedId,savedId]);eq(t.requests.map(r=>r.action),['account','prepare']);
}
{
 let finish,entered;const writing=new Promise(resolve=>entered=resolve);
 const t=fixture({cancelResponse:(_,row)=>{entered();return new Promise(resolve=>finish=()=>resolve(cancelled(row)));}});
 await t.open();const button=cancelButton(t);
 t.setDirty(true);await button.handlers.click();eq(t.cancellations,[]);t.setDirty(false);
 const done=button.handlers.click();await writing;await button.handlers.click();await t.approve.handlers.click();
 t.view.clear();finish();await done;eq(t.cancellations,[savedId]);eq(t.reads,[]);eq(notice(t),'');eq(t.requests.length,2);
}
// Verify the saved post before account lookup and again before creating the user's order.
for(const platform of ['youtube','tiktok']){
 const post={title:'Gespeicherter <Titel>',caption:'Text\n#Aktuell\nhttps://example.test/kunde'},sequence=[];
 let stale=true;const t=fixture({platform,post,
  verifySavedDraft:async ctx=>{sequence.push('read');eq(ctx.post.title,post.title);if(stale)throw Object.assign(Error('Entwurf geändert'),{code:'ASSIGNMENT_CHANGED'});},
  onOutdatedDraft:()=>sequence.push('editor'),accountResponse:account=>{sequence.push('account');return account;}});
 const entry=t.$('preparePublicationOrder'),dialog=t.$('publicationOrderDialog');
 await entry.handlers.click();eq(t.requests.length,0);eq(sequence,['read','editor']);eq(!!dialog.open,false);
 stale=false;await entry.handlers.click();eq(sequence,['read','editor','read','account']);
 eq(dialog.querySelector('h3').textContent,post.title);eq(dialog.querySelector('pre').textContent,post.caption);
 eq(dialog.querySelector('pre a'),null);eq(dialog.querySelector('details').hasAttribute('open'),false);
 assert.match(dialog.textContent,/Synthetic.mp4/);assert.match(dialog.textContent,/Synthetic · synthetic-channel/);
 eq(t.requests.map(r=>r.action),['account']);eq(t.reads,[]);
 t.$('order-visibility').value=platform==='youtube'?'private':'SELF_ONLY';stale=true;
 await submit(t);eq(sequence.at(-1),'editor');eq(t.requests.map(r=>r.action),['account']);eq(!!dialog.open,false);
}
for(const field of ['title','caption']){
 let stored;const t=fixture({prepareResponse:async(_,response)=>{stored=await response.json();
  return {ok:true,json:async()=>({...stored,draft:{...stored.draft,[field]:'Fremder Inhalt'}})};},
  storedResponse:()=>({...stored,draft:{...stored.draft,[field]:'Fremder Inhalt'}})});
 await t.open();eq(t.requests.map(r=>r.action),['account','prepare']);eq(t.reads,[stored.id]);
 eq(t.approve.disabled,true);eq(t.$('order-final-consent').checked,false);
 assert.doesNotMatch(t.doc.body.textContent,/Fremder Inhalt/);assert.match(t.doc.body.textContent,/anderen Beitragstext oder Titel/);
}
{
 let release;const t=fixture({verifySavedDraft:()=>new Promise(resolve=>{release=resolve;})});
 const pending=t.$('preparePublicationOrder').handlers.click();t.view.clear();release();await pending;
 eq(t.requests.length,0);eq(!!t.$('publicationOrderDialog').open,false);eq(t.doc.querySelector('.order-caption'),null);
}
// A customer can leave an initial read, without abandoning a previously prepared order.
const actionButton=(t,text)=>[...t.$('publicationOrderDialog').querySelectorAll('button')].find(b=>b.textContent===text);
for(const platform of ['youtube','tiktok']){
 let finishRead,readCount=0,repairs=0;
 const t=fixture({platform,verifySavedDraft:()=>++readCount===1?new Promise((_,reject)=>{finishRead=reject;}):Promise.resolve(),onOutdatedDraft:()=>repairs++});
 const dialog=t.$('publicationOrderDialog'),entry=t.$('preparePublicationOrder'),close=actionButton(t,'Schließen');
 const old=entry.handlers.click();eq(close.disabled,false);close.handlers.click();eq(dialog.open,false);
 await entry.handlers.click();finishRead(Object.assign(Error('Alte Antwort'),{code:'ASSIGNMENT_CHANGED'}));await old;
 eq(dialog.open,true);eq(repairs,0);eq(readCount,2);eq(t.requests.map(r=>r.action),['account']);
 eq(dialog.querySelector('form').hidden,false);
}
for(const platform of ['youtube','tiktok']){
 let began,finishAccount,readCount=0;const sent=new Promise(resolve=>{began=resolve;});
 const t=fixture({platform,verifySavedDraft:async()=>{readCount++;},accountResponse:account=>new Promise(resolve=>{finishAccount=()=>resolve(account);began();})});
 const entry=t.$('preparePublicationOrder'),dialog=t.$('publicationOrderDialog'),old=entry.handlers.click();
 await sent;eq(actionButton(t,'Schließen').disabled,false);let prevented=false;
 dialog.handlers.cancel({preventDefault(){prevented=true;}});if(!prevented)dialog.close();
 eq(dialog.open,false);const next=entry.handlers.click();finishAccount();await Promise.all([next,old]);
 eq(dialog.open,true);eq(readCount,2);eq(t.requests.map(r=>r.action),['account']);
 eq(dialog.querySelector('form').hidden,false);eq(t.approve.disabled,true);
}
for(const platform of ['youtube','tiktok']){
 let fail=true,reads=0;
 const t=fixture({platform,verifySavedDraft:async()=>{reads++;},accountResponse:account=>{
  if(fail)throw new TypeError('Failed to fetch');return account;
 }});
 const dialog=t.$('publicationOrderDialog');await t.$('preparePublicationOrder').handlers.click();
 const retry=actionButton(t,'Zielkonto erneut prüfen');
 eq(dialog.open,true);eq(retry.hidden,false);eq(dialog.querySelector('form').hidden,true);
 await submit(t);eq(t.requests.map(r=>r.action),['account']);fail=false;
 await Promise.all([retry.handlers.click(),retry.handlers.click()]);
 eq(reads,2);eq(t.requests.map(r=>r.action),['account','account']);
 eq(dialog.querySelector('form').hidden,false);eq(retry.hidden,true);eq(t.$('order-visibility').value,'');eq(t.approve.disabled,true);
}
for(const code of ['TARGET_REFRESH_UNCERTAIN','TARGET_RECONNECT_REQUIRED','TARGET_PERMISSIONS_REQUIRED','TARGET_RATE_LIMITED']){
 const t=fixture({accountResponse:()=>({ok:false,code})});await t.$('preparePublicationOrder').handlers.click();
 eq(actionButton(t,'Zielkonto erneut prüfen').hidden,true);eq(t.$('publicationOrderDialog').querySelector('form').hidden,true);
 await actionButton(t,'Zielkonto erneut prüfen').handlers.click();await submit(t);eq(t.requests.map(r=>r.action),['account']);
}
{
 let entered,finish;const writing=new Promise(resolve=>{entered=resolve;});
 const t=fixture({prepareResponse:async(_,response)=>{entered();await new Promise(resolve=>{finish=resolve;});return response;}});
 const opening=t.open();await writing;const dialog=t.$('publicationOrderDialog'),close=actionButton(t,'Schließen');
 eq(close.disabled,true);close.handlers.click();let cancelled=false;dialog.handlers.cancel({preventDefault(){cancelled=true;}});
 eq(cancelled,true);eq(dialog.open,true);finish();await opening;eq(t.requests.map(r=>r.action),['account','prepare']);eq(close.disabled,false);
}
{
 let hold=false,entered,release;const checking=new Promise(resolve=>{entered=resolve;});
 const t=fixture({accountResponse:async account=>{if(hold){entered();await new Promise(resolve=>{release=resolve;});}return account;}});
 await t.open();const id=t.requests[1].input.id;hold=true;const restart=restartOrder(t);await checking;
 actionButton(t,'Schließen').handlers.click();await t.$('preparePublicationOrder').handlers.click();release();await restart;
 eq(t.reads,[id]);eq(t.approve.hidden,true);assert.match(notice(t),/Zielkonto muss erneut geprüft/);
 eq(t.requests.map(r=>r.action),['account','prepare','account']);
}
console.log(checks+' manual review DOM checks passed; only synthetic requests.');
