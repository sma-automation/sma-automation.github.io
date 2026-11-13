import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountPublicationHistory} from '../app/assets/publication-history-dashboard.mjs';
const uid='ab660000-0000-4000-8000-000000000091',tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const entry=(n=1,extra={})=>({id:'ab660000-0000-4000-9000-'+String(n).padStart(12,'0'),platform:'youtube',title:'Fixture title',target_name:'Fixture channel',status:'blocked',created_at:'2026-11-06T12:00:00Z',updated_at:'2026-11-06T12:01:00Z',cover:{status:'not_recorded',updated_at:null},...extra});
const result=(entries=[entry()],next=null,extra={})=>({ok:true,version:3,month:'2026-11',timezone:'Europe/Vienna',summary:{orders:next?21:entries.length,public_confirmed:0,platforms:entries.length?['youtube']:[]},months:entries.length?[{month:'2026-11',orders:next?21:entries.length}]:[],entries,has_more:!!next,next,...extra});
function fixture({active=true,hash='',requestOrderPage,requestFind,request=()=>result(),getOwnerId,requestTexts,requestAssignments,requestEditors,requestAnalyses}={}){
 const {document:doc,window}=parseHTML('<html><head></head><body><section id="page-history" class="'+(active?'active':'')+'"><div class="grid">'+Array.from({length:3},()=>'<div class="card"><div class="card-title">Old metric</div><div class="big-value">–</div><div class="muted">Old detail</div></div>').join('')+'</div><div class="card"><div class="card-title">Aktivitätsverlauf</div><p>Old intro</p><div id="historyActivitySlot" class="empty-state"></div></div><div class="card"><div class="card-title">Monatsarchiv</div><p>Old archive</p><div id="historyMonthSlot" style="display:flex"></div></div></section></body></html>');
 Object.defineProperty(doc,'visibilityState',{value:'visible',writable:true});let owner=uid,callback,unsubscribed=0;const calls=[];
 const route={hash,pathname:'/app/dashboard.html',search:''};
 Object.defineProperty(window,'location',{value:route,configurable:true});
 Object.defineProperty(window,'history',{value:{replaceState(){route.hash='';}},configurable:true});
 const historyNav=doc.createElement('button');historyNav.dataset.page='history';
 historyNav.addEventListener('click',()=>doc.getElementById('page-history').classList.add('active'));
 doc.body.prepend(historyNav);
 const view=mountPublicationHistory({doc,requestOrderPage,requestFind,ownerWindow:window,expectedOwnerId:uid,stylesheetUrl:'/history.css',requestTexts,requestAssignments,requestEditors,requestAnalyses,getOwnerId:getOwnerId||(async()=>owner),watchOwner:cb=>{callback=cb;return {unsubscribe(){unsubscribed++;}};},request:input=>{calls.push(input);return request(input);}});
 const page=doc.getElementById('page-history');
 return {doc,window,page,view,calls,$:s=>page.querySelector(s),owner(id,notify=true){owner=id;if(notify)callback(id);},focus(){window.dispatchEvent(new window.Event('focus'));},visibility(value){doc.visibilityState=value;doc.dispatchEvent(new window.Event('visibilitychange'));},get unsubscribed(){return unsubscribed;}};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
await test('renders saved status with text-only untrusted title and no action links',async()=>{
 const f=fixture({request:()=>result([entry(1,{title:'<img src=x onerror=alert(1)>',target_name:'<script>bad</script>'})])});await tick();
 assert.match(f.$('ol').textContent,/Blockiert/);assert.match(f.$('ol').textContent,/<img/);assert.equal(f.$('img'),null);assert.equal(f.$('script'),null);assert.equal(f.$('a'),null);assert.deepEqual(f.calls,[{}]);assert.equal(f.$('#historyActivitySlot').querySelectorAll('button').length,3);f.view.destroy();
});
await test('expanded orders show their own saved caption as plain multiline text, with no further request',async()=>{
 const caption='Historischer Text 🛒\n\n#Video\nhttps://example.test/?produkt=alt\n<img src=x>';
 const f=fixture({request:()=>result([entry(1,{status:'cancelled',order_caption:caption}),entry(2,{status:'prepared',order_caption:'Text des zweiten Auftrags.'}),entry(3)])});await tick();
 const [first,second,legacy]=f.doc.querySelectorAll('ol li details');
 assert.equal(first.hasAttribute('open'),false);first.setAttribute('open','');
 assert.equal(first.querySelector('.sma-history-saved-text').textContent,caption);
 assert.equal(first.querySelector('summary').textContent.includes(caption),false);
 assert.equal(first.querySelector('.sma-history-saved-text a, img, button'),null);
 assert.equal(second.querySelector('.sma-history-saved-text').textContent,'Text des zweiten Auftrags.');
 assert.match(legacy.textContent,/kein vollständiger Beitragstext/);
 assert.deepEqual(f.calls,[{}]);f.owner('other');assert.equal(f.$('.sma-history-saved-text'),null);f.view.destroy();
});
await test('a cancelled YouTube or TikTok order links only to the current post for that order',async()=>{
 const entries=['youtube','tiktok','instagram','facebook','unknown'].map((platform,i)=>entry(i+1,{platform,status:'cancelled'}));
 const f=fixture({request:()=>({...result(entries),summary:{orders:5,public_confirmed:0,platforms:['youtube','tiktok','instagram','facebook']}})});await tick();
 const rows=[...f.doc.querySelectorAll('ol li')];assert.equal(rows.length,5);
 for(const [i,row] of rows.entries()){
  const a=row.querySelector('a');
  if(i>1){assert.equal(a,null);continue;}
  assert.equal(a.textContent,'Aktuellen Beitrag öffnen');assert.equal(a.target,'_top');
  assert.equal(a.getAttribute('href'),'/app/publication-preview.html?wide=1&portal='+entries[i].platform+'&order='+entries[i].id+'&view=current');
  assert.match(row.querySelector('summary').textContent,/Abgebrochen/);
 }
 assert.deepEqual(f.calls,[{}]);f.view.destroy();
});
await test('hidden History is silent and opening it loads; leaving clears results',async()=>{
 const f=fixture({active:false});await tick();assert.equal(f.calls.length,0);f.page.classList.add('active');await tick();assert.equal(f.calls.length,1);assert.equal(f.page.querySelectorAll('li').length,1);
 f.page.classList.remove('active');await tick();assert.equal(f.page.querySelectorAll('li').length,0);f.focus();await tick();assert.equal(f.calls.length,1);f.view.destroy();
});
await test('five-row pages reach the next server batch without growing the list',async()=>{
 const entries=Array.from({length:20},(_,i)=>entry(i+10)),next={before_at:entries[19].created_at,before_id:entries[19].id};
 const f=fixture({request:input=>input.before_id?result([entry(1)],null,{summary:{orders:21,public_confirmed:0,platforms:['youtube']}}):result(entries,next)});await tick();
 assert.equal(f.$('ol').children.length,5);assert.equal(f.$('[aria-label="Vorherige Aufträge"]').disabled,true);
 for(let page=2;page<=5;page++){f.$('[aria-label="Weitere Aufträge"]').click();await tick();assert.equal(f.$('ol').children.length,page===5?1:5);assert.match(f.$('[role=status]').textContent,new RegExp('Seite '+page+' von 5'));}
 assert.deepEqual(f.calls,[{},{month:'2026-11',...next}]);assert.equal(f.$('[aria-label="Weitere Aufträge"]').disabled,true);
 f.$('[aria-label="Vorherige Aufträge"]').click();await tick();assert.equal(f.$('ol').children.length,5);assert.match(f.$('[role=status]').textContent,/16–20/);assert.equal(f.calls.length,2);
 f.$('.sma-history-toolbar button').click();await tick();assert.equal(f.$('ol').children.length,5);assert.match(f.$('[role=status]').textContent,/1–5/);assert.deepEqual(f.calls[2],{month:'2026-11'});f.view.destroy();
});
await test('network or malformed result clears previous data and allows retry',async()=>{
 let response=result();const f=fixture({request:()=>{if(response instanceof Error)throw response;return response;}});await tick();
 for(const invalid of [Error('offline'),{ok:false,code:'ACCESS_INACTIVE'},result([entry(1,{status:'published'})])]){response=invalid;f.focus();await tick();assert.equal(f.page.querySelectorAll('li').length,0);assert.match(f.$('[role=status]').textContent,/nicht geladen/);assert.equal(f.$('.sma-history-toolbar button').disabled,false);}
 response=result([]);f.$('.sma-history-toolbar button').click();await tick();assert.match(f.$('[role=status]').textContent,/Keine Veröffentlichungsaufträge/);f.view.destroy();
});
await test('owner event immediately clears and ignores late former-owner response',async()=>{
 let response=result();const f=fixture({request:()=>response});await tick();const gate=deferred();response=gate.promise;f.focus();await tick();f.owner('other');assert.equal(f.page.querySelectorAll('li').length,0);gate.resolve(result());await tick();assert.equal(f.page.querySelectorAll('li').length,0);assert.equal(f.$('.sma-history-toolbar button').disabled,true);f.view.destroy();assert.equal(f.unsubscribed,1);
});
await test('owner is checked before and after reads even without notification',async()=>{
 const f=fixture();await tick();f.owner('other',false);f.focus();await tick();assert.equal(f.calls.length,1);assert.equal(f.page.querySelectorAll('li').length,0);f.view.destroy();
 const gate=deferred(),g=fixture({request:()=>gate.promise});await tick();g.owner('other',false);gate.resolve(result());await tick();assert.equal(g.page.querySelectorAll('li').length,0);g.view.destroy();
});
await test('late hidden response cannot overwrite a newer result',async()=>{
 const gate=deferred();let n=0;const f=fixture({request:()=>++n===1?gate.promise:result([entry(2,{title:'Newer'})])});await tick();f.visibility('hidden');f.focus();await tick();assert.equal(n,1);f.visibility('visible');await tick();gate.resolve(result([entry(1,{title:'Older'})]));await tick();assert.match(f.$('ol').textContent,/Newer/);assert.doesNotMatch(f.$('ol').textContent,/Older/);f.view.destroy();
});
await test('rapid refreshes coalesce and destruction ignores pending results',async()=>{
 const gate=deferred(),f=fixture({request:()=>gate.promise});await tick();f.focus();f.focus();await tick();assert.equal(f.calls.length,1);f.view.destroy();gate.resolve(result());await tick();assert.equal(f.$('#historyActivitySlot').textContent,'');assert.equal(f.doc.querySelector('link'),null);f.focus();await tick();assert.equal(f.calls.length,1);
});
const button=(f,text)=>[...f.page.querySelectorAll('button')].find(b=>b.textContent===text);
async function openChapter(f,label){button(f,label).click();await tick();}
async function openEditHistory(f,key){
 if(f.$('#sma-history-tab-edits').getAttribute('aria-selected')!=='true')button(f,'Bearbeiten').click();
 const picker=f.$('#historyEditType');
 if(picker){
  const option=[...picker.querySelectorAll('option')].find(o=>o.value===key);
  assert.ok(option);option.selected=true;
  picker.dispatchEvent(new f.window.Event('change',{bubbles:true}));
 }
 await tick();
}
await test('monthly totals describe all selected orders, not only the visible page',async()=>{
 const entries=Array.from({length:20},(_,i)=>entry(i+10)),next={before_at:entries[19].created_at,before_id:entries[19].id};
 const f=fixture({request:()=>result(entries,next,{summary:{orders:35,public_confirmed:3,platforms:['youtube','tiktok']}})});await tick();
 assert.equal(f.$('[data-history-metric=orders]').textContent,'35');assert.equal(f.$('[data-history-metric=public_confirmed]').textContent,'3');assert.equal(f.$('[data-history-metric=platforms]').textContent,'2');
 assert.match(f.$('[role=status]').textContent,/1–5 von 35/);assert.match(f.$('[data-history-period]').textContent,/November 2026/);assert.match(f.$('small').textContent,/13:00/);
 const cards=[...f.page.children];assert.ok(cards.indexOf(f.$('#historyMonthSlot').closest('.card'))<cards.indexOf(f.$('#historyActivitySlot').parentElement));f.view.destroy();
});
await test('empty month, all months and current month use explicit bounded read filters',async()=>{
 const f=fixture({request:input=>input.month==='2026-10'?result([],null,{month:'2026-10'}):result([entry()],null,{month:input.month===null?null:'2026-11'})});await tick();
 f.$('input[type=month]').value='2026-10';button(f,'Monat anzeigen').click();await tick();assert.equal(f.$('[data-history-metric=orders]').textContent,'0');assert.match(f.$('[role=status]').textContent,/Oktober 2026/);assert.equal(f.$('ol').children.length,0);
 button(f,'Alle Monate').click();await tick();assert.match(f.$('[data-history-period]').textContent,/Alle Monate/);assert.equal(f.$('ol').children.length,1);
 button(f,'Aktueller Monat').click();await tick();assert.equal(f.$('input[type=month]').value,'2026-11');
 assert.deepEqual(f.calls,[{},{month:'2026-10'},{month:null},{}]);f.view.destroy();
});
await test('older-month input and server-derived shortcuts contain no fixed sample months',async()=>{
 const f=fixture({request:input=>result([],null,{month:input.month||'2026-11',months:[{month:'2026-11',orders:9},{month:'2025-02',orders:2}]})});await tick();
 button(f,'Februar 2025 · 2').click();await tick();assert.equal(f.calls[1].month,'2025-02');assert.equal(f.$('input[type=month]').value,'2025-02');
 f.$('input[type=month]').value='2024-01';button(f,'Monat anzeigen').click();await tick();assert.equal(f.calls[2].month,'2024-01');
 f.$('input[type=month]').value='2026-99';button(f,'Monat anzeigen').click();await tick();assert.equal(f.calls.length,3);assert.match(f.$('[role=status]').textContent,/gültigen Monat/);f.view.destroy();
});
await test('month switches discard late old-month pages and counters',async()=>{
 const gate=deferred();const f=fixture({request:input=>input.month==='2026-10'?result([],null,{month:'2026-10'}):gate.promise});await tick();
 f.$('input[type=month]').value='2026-10';button(f,'Monat anzeigen').click();await tick();gate.resolve(result());await tick();
 assert.equal(f.$('[data-history-metric=orders]').textContent,'0');assert.match(f.$('[data-history-period]').textContent,/Oktober/);assert.equal(f.$('ol').children.length,0);f.view.destroy();
});
await test('owner loss clears counters and archives together with the list',async()=>{
 const f=fixture();await tick();assert.equal(f.$('[data-history-metric=orders]').textContent,'1');assert.equal(f.$('.sma-history-month-links').children.length,1);
 f.owner('other');assert.equal(f.$('[data-history-metric=orders]').textContent,'–');assert.equal(f.$('[data-history-metric=public_confirmed]').textContent,'–');assert.equal(f.$('.sma-history-month-links').children.length,0);assert.equal(f.$('input').value,'');assert.equal(f.$('input').disabled,true);f.view.destroy();
});
await test('wrong-month responses clear both summary and rows',async()=>{
 const f=fixture({request:()=>result()});await tick();f.$('input[type=month]').value='2026-10';button(f,'Monat anzeigen').click();await tick();
 assert.equal(f.$('[data-history-metric=orders]').textContent,'–');assert.equal(f.$('ol').children.length,0);assert.match(f.$('[role=status]').textContent,/nicht geladen/);f.view.destroy();
});


const textEntry=(n=1,extra={})=>({preview_id:entry(n).id,revision:1,platform:'tiktok',body:'Saved text with enough detail',recorded_at:'2026-11-06T12:00:00Z',...extra});
const texts=(entries=[textEntry()],extra={})=>({ok:true,version:1,month:'2026-11',timezone:'Europe/Vienna',total:entries.length,entries,has_more:false,next:null,...extra});
await test('historical tags show only inside details and distinguish unknown from explicitly empty snapshots',async()=>{
 const f=fixture({requestTexts:()=>texts([textEntry(1,{hashtags:['Café','Welt_1','界']}),textEntry(2,{hashtags:[]}),textEntry(3,{hashtags:null}),textEntry(4)])});await openEditHistory(f,'texts');
 const rows=[...f.$('#historyTextCard ol').children];assert.equal(rows.length,4);
 assert.match(rows[0].textContent,/Hashtags: #Café #Welt_1 #界/);assert.match(rows[1].textContent,/Hashtags: Keine gespeichert/);
 for(const row of rows.slice(2))assert.match(row.textContent,/Hashtags: Für diesen Textstand nicht erfasst/);
 for(const row of rows){assert.equal(row.querySelector('details').hasAttribute('open'),false);assert.doesNotMatch(row.querySelector('summary').textContent,/Hashtags:/);}
 assert.equal(f.$('[data-history-metric=orders]').textContent,'1');f.view.destroy();
});
await test('invalid historical tags clear the text page without injecting markup; valid refresh recovers',async()=>{
 let response=texts([textEntry(1,{hashtags:['Good']})]);const f=fixture({requestTexts:()=>response});await openEditHistory(f,'texts');
 response=texts([textEntry(1,{hashtags:['<img src=x onerror=bad()>']})]);button(f,'Textverlauf aktualisieren').click();await tick();
 assert.equal(f.$('#historyTextCard ol').children.length,0);assert.equal(f.$('#historyTextCard img'),null);assert.match(f.$('#historyTextCard [role=status]').textContent,/nicht geladen/);
 response=texts([textEntry(1,{hashtags:[]})]);button(f,'Textverlauf aktualisieren').click();await tick();assert.match(f.$('#historyTextCard ol').textContent,/Keine gespeichert/);f.view.destroy();
});
await test('saved texts are expandable text-only values, independent of order totals',async()=>{
 const f=fixture({requestTexts:()=>texts([textEntry(1,{body:'<img src=x onerror=alert(1)> A saved body'})])});await openEditHistory(f,'texts');
 assert.match(f.$('#historyTextCard').textContent,/TikTok/);assert.match(f.$('#historyTextCard').textContent,/Version 1/);assert.equal(f.$('#historyTextCard img'),null);assert.equal(f.$('#historyTextCard details').hasAttribute('open'),false);assert.equal(f.$('#historyTextCard a'),null);assert.match(f.$('#historyTextCard .sma-history-saved-text').textContent,/<img/);assert.equal(f.$('[data-history-metric=orders]').textContent,'1');f.view.destroy();assert.equal(f.$('#historyTextCard'),null);
});
await test('text month follows the selected order month, including all and empty periods',async()=>{
 const calls=[],f=fixture({request:i=>result(i.month==='2026-10'?[]:[entry()],null,{month:i.month===undefined?'2026-11':i.month}),requestTexts:i=>{calls.push(i);return texts(i.month==='2026-10'?[]:[textEntry()],{month:i.month});}});await openEditHistory(f,'texts');
 f.$('input[type=month]').value='2026-10';button(f,'Monat anzeigen').click();await tick();assert.match(f.$('#historyTextCard [role=status]').textContent,/Keine.*Oktober/);
 button(f,'Alle Monate').click();await tick();assert.match(f.$('#historyTextCard [role=status]').textContent,/Alle Monate/);assert.deepEqual(calls,[{month:'2026-11'},{month:'2026-10'},{month:null}]);f.view.destroy();
});
await test('text pagination keeps five visible rows across composite-key server pages',async()=>{
 const entries=Array.from({length:20},(_,i)=>textEntry(1,{revision:i+1})),last=entries.at(-1),next={before_at:last.recorded_at,before_id:last.preview_id,before_revision:20,before_platform:'tiktok'},calls=[];
 const f=fixture({requestTexts:i=>{calls.push(i);return i.before_id?texts([textEntry(1,{platform:'youtube'})],{total:21}):texts(entries,{total:21,has_more:true,next});}});await openEditHistory(f,'texts');assert.equal(f.$('#historyTextCard ol').children.length,5);
 for(let page=2;page<=5;page++){f.$('[aria-label="Weitere Textstände"]').click();await tick();assert.equal(f.$('#historyTextCard ol').children.length,page===5?1:5);}
 assert.deepEqual(calls[1],{month:'2026-11',...next});assert.equal(f.$('#historyActivitySlot ol').children.length,1);assert.equal(f.$('[aria-label="Weitere Textstände"]').disabled,true);
 f.$('[aria-label="Vorherige Textstände"]').click();await tick();assert.equal(f.$('#historyTextCard ol').children.length,5);assert.match(f.$('#historyTextCard [role=status]').textContent,/16–20/);assert.equal(calls.length,2);f.view.destroy();
});
await test('late text results cannot repopulate another month, hidden page or lost owner',async()=>{
 for(const change of ['month','hidden','owner','destroy']){
  const gate=deferred(),f=fixture({request:i=>result([],null,{month:i.month||'2026-11'}),requestTexts:i=>i.month==='2026-10'?texts([],{month:i.month}):gate.promise});await openEditHistory(f,'texts');
  if(change==='month'){f.$('input[type=month]').value='2026-10';button(f,'Monat anzeigen').click();}
  if(change==='hidden')f.page.classList.remove('active');if(change==='owner')f.owner('other');if(change==='destroy')f.view.destroy();await tick();gate.resolve(texts());await tick();assert.equal(f.page.querySelectorAll('#historyTextCard li').length,0);if(change==='month')assert.match(f.$('#historyTextCard').textContent,/Oktober/);f.view.destroy();
 }
});
await test('text read owner checks also catch unannounced account switches',async()=>{
 const gate=deferred(),f=fixture({requestTexts:()=>gate.promise});await openEditHistory(f,'texts');f.owner('other',false);gate.resolve(texts());await tick();assert.equal(f.$('#historyTextCard ol').children.length,0);assert.equal(f.$('[data-history-metric=orders]').textContent,'–');assert.equal(button(f,'Textverlauf aktualisieren').disabled,true);f.view.destroy();
});
await test('text errors clear rows, preserve the chosen month and permit a read-only retry',async()=>{
 let response=texts(),f=fixture({requestTexts:()=>response});await openEditHistory(f,'texts');
 for(const invalid of [{ok:false},texts([textEntry()],{month:'2026-10'})]){response=invalid;button(f,'Textverlauf aktualisieren').click();await tick();assert.equal(f.$('#historyTextCard ol').children.length,0);assert.match(f.$('#historyTextCard [role=status]').textContent,/nicht geladen/);assert.equal(button(f,'Textverlauf aktualisieren').disabled,false);}
 response=texts();button(f,'Textverlauf aktualisieren').click();await tick();assert.equal(f.$('#historyTextCard ol').children.length,1);f.view.destroy();
});
await test('history switches show one list, retain its page, and reset pages on month changes',async()=>{
 const f=fixture({request:i=>result(Array.from({length:9},(_,n)=>entry(n)),null,{month:i.month===undefined?'2026-11':i.month}),requestTexts:i=>texts(Array.from({length:14},(_,n)=>textEntry(n)),{month:i.month})});await tick();
 assert.ok(f.$('#historyTextCard').closest('[hidden]'));assert.equal(f.$('#historyOrderCard').hidden,false);
 f.$('[aria-label="Weitere Aufträge"]').click();assert.equal(f.$('#historyActivitySlot ol').children.length,4);
 await openEditHistory(f,'texts');assert.equal(f.$('#historyTextCard').hidden,false);assert.equal(f.$('#historyOrderCard').hidden,true);
 f.$('[aria-label="Weitere Textstände"]').click();assert.match(f.$('#historyTextCard [role=status]').textContent,/6–10/);
 button(f,'Aufträge').click();assert.equal(f.$('#historyOrderCard').hidden,false);assert.ok(f.$('#historyTextCard').closest('[hidden]'));assert.match(f.$('#historyActivitySlot [role=status]').textContent,/6–9/);
 button(f,'Alle Monate').click();await tick();assert.match(f.$('#historyActivitySlot [role=status]').textContent,/1–5/);assert.equal(f.$('#historyTextCard ol').children.length,0);await openEditHistory(f,'texts');assert.match(f.$('#historyTextCard [role=status]').textContent,/1–5/);f.view.destroy();
});
const assignmentEntry=(n=1,extra={})=>({id:entry(n).id,asset_id:entry(91).id,preview_id:entry(92).id,preview_revision:2,assignment_revision:3,asset_revision:'r1',platform:'youtube',file_name:'Original filename.mp4',title:'Saved title',body:'Saved body',event_kind:'baseline',recorded_at:'2026-11-06T12:00:00Z',source_updated_at:'2026-10-04T09:00:00Z',...extra});
const assignments=(entries=[assignmentEntry()],extra={})=>({ok:true,version:1,month:'2026-11',timezone:'Europe/Vienna',total:entries.length,entries,has_more:false,next:null,...extra});
await test('file assignments in Edit show truthful baseline, literal saved text and independent totals',async()=>{
 const f=fixture({requestTexts:()=>texts(),requestAssignments:()=>assignments([assignmentEntry(1,{file_name:'<img src=x onerror=alert(1)>',body:'<script>alert(1)</script>'})])});await tick();
 assert.equal(f.page.querySelectorAll('[role=tab]').length,2);await openEditHistory(f,'assignments');const card=f.$('#historyAssignmentCard');assert.equal(card.hidden,false);assert.ok(f.$('#historyTextCard').closest('[hidden]'));assert.equal(f.$('#historyOrderCard').hidden,true);
 assert.match(card.textContent,/Übernommener Stand/);assert.match(card.textContent,/Frühere Änderungen sind nicht enthalten/);assert.match(card.textContent,/Zuletzt gespeichert: 04.10.2026/);assert.match(card.textContent,/<script>/);assert.equal(card.querySelector('script,img'),null);const link=card.querySelector('a.sma-history-preview-link');assert.equal(link?.getAttribute('href'),'/app/publication-preview.html?wide=1&portal=youtube&asset='+assignmentEntry().asset_id);assert.equal(link?.getAttribute('target'),'_top');assert.match(link.textContent,/Aktuellen Beitrag bearbeiten/);assert.equal(f.$('[data-history-metric=orders]').textContent,'1');f.view.destroy();assert.equal(f.$('#historyAssignmentCard'),null);
});
await test('all four portal history rows link to the selected CURRENT file in the guarded editor',async()=>{
 const platforms=['youtube','tiktok','instagram','facebook'];
 const rows=platforms.map((platform,i)=>assignmentEntry(i+1,{platform,asset_id:entry(i+100).id,file_name:platform+' clip.mp4',event_kind:'assigned'}));
 const f=fixture({requestAssignments:()=>assignments(rows)});await openEditHistory(f,'assignments');
 const links=[...f.$('#historyAssignmentCard').querySelectorAll('a.sma-history-preview-link')];
 assert.equal(links.length,4);
 for(let i=0;i<links.length;i++){
  const href='/app/publication-preview.html?wide=1&portal='+platforms[i]+'&asset='+rows[i].asset_id;
  assert.equal(links[i].getAttribute('href'),href);
  assert.equal(links[i].getAttribute('target'),'_top');
  assert.match(links[i].textContent,/Aktuellen Beitrag bearbeiten/);
 }
 assert.equal(f.$('#historyAssignmentCard').querySelector('script,img'),null);
 f.owner('other');assert.equal(f.$('#historyAssignmentCard a'),null);
 f.view.destroy();
});
await test('file pages buffer twenty, display five and preserve their page when switching chapters',async()=>{
 const rows=Array.from({length:20},(_,i)=>assignmentEntry(i)),next={before_at:rows.at(-1).recorded_at,before_id:rows.at(-1).id},calls=[];
 const f=fixture({request:i=>result([] ,null,{month:i.month===undefined?'2026-11':i.month}),requestAssignments:i=>{calls.push(i);return i.month===null?assignments([],{month:null}):i.before_id?assignments([assignmentEntry(21)],{total:21}):assignments(rows,{total:21,has_more:true,next});}});await tick();await openEditHistory(f,'assignments');
 for(let page=1;page<=5;page++){assert.equal(f.$('#historyAssignmentCard ol').children.length,page===5?1:5);assert.match(f.$('#historyAssignmentCard [role=status]').textContent,new RegExp('Seite '+page+' von 5'));if(page<5){f.$('[aria-label="Weitere Dateistände"]').click();await tick();}}
 assert.deepEqual(calls,[{month:'2026-11'},{month:'2026-11',...next}]);f.$('[aria-label="Vorherige Dateistände"]').click();button(f,'Aufträge').click();await openEditHistory(f,'assignments');assert.match(f.$('#historyAssignmentCard [role=status]').textContent,/16–20/);
 button(f,'Alle Monate').click();await tick();assert.equal(f.$('#historyAssignmentCard ol').children.length,0);assert.match(f.$('#historyAssignmentCard [role=status]').textContent,/Alle Monate/);f.view.destroy();
});
await test('file history discards old-month responses and clears on leaving, visibility loss and owner loss',async()=>{
 const gate=deferred(),f=fixture({request:i=>result([] ,null,{month:i.month||'2026-11'}),requestAssignments:i=>i.month==='2026-10'?assignments([],{month:'2026-10'}):gate.promise});await openEditHistory(f,'assignments');
 f.$('input[type=month]').value='2026-10';button(f,'Monat anzeigen').click();await tick();gate.resolve(assignments());await tick();assert.match(f.$('#historyAssignmentCard [role=status]').textContent,/Oktober/);assert.equal(f.$('#historyAssignmentCard ol').children.length,0);f.view.destroy();
 for(const change of ['leave','hidden','owner']){const g=fixture({requestAssignments:()=>assignments()});await openEditHistory(g,'assignments');assert.equal(g.$('#historyAssignmentCard ol').children.length,1);if(change==='leave')g.page.classList.remove('active');if(change==='hidden')g.visibility('hidden');if(change==='owner')g.owner('other');await tick();assert.equal(g.$('#historyAssignmentCard ol').children.length,0);assert.equal(button(g,'Dateiverlauf aktualisieren').disabled,true);g.view.destroy();}
});
await test('file history verifies the owner after an async read and rejects a late response after teardown',async()=>{
 for(const action of ['owner','destroy']){const gate=deferred(),f=fixture({requestAssignments:()=>gate.promise});await openEditHistory(f,'assignments');if(action==='owner')f.owner('other',false);else f.view.destroy();gate.resolve(assignments());await tick();assert.equal(f.$('#historyAssignmentCard ol')?.children.length||0,0);f.view.destroy();}
});
await test('file history errors, wrong-month replies and duplicate next batches clear data with retry available',async()=>{
 let response=assignments();const f=fixture({requestAssignments:()=>{if(response instanceof Error)throw response;return response;}});await openEditHistory(f,'assignments');
 for(const bad of [Error('offline'),{ok:false,code:'ACCESS_INACTIVE'},assignments([],{month:'2026-10'})]){response=bad;button(f,'Dateiverlauf aktualisieren').click();await tick();assert.equal(f.$('#historyAssignmentCard ol').children.length,0);assert.match(f.$('#historyAssignmentCard [role=status]').textContent,/nicht geladen/);assert.equal(button(f,'Dateiverlauf aktualisieren').disabled,false);}
 response=assignments();button(f,'Dateiverlauf aktualisieren').click();await tick();assert.equal(f.$('#historyAssignmentCard ol').children.length,1);f.view.destroy();
 const rows=Array.from({length:20},(_,i)=>assignmentEntry(i)),next={before_at:rows.at(-1).recorded_at,before_id:rows.at(-1).id};const g=fixture({requestAssignments:i=>i.before_id?assignments([rows[0]],{total:21}):assignments(rows,{total:21,has_more:true,next})});await openEditHistory(g,'assignments');for(let n=0;n<4;n++){g.$('[aria-label="Weitere Dateistände"]').click();await tick();}assert.equal(g.$('#historyAssignmentCard ol').children.length,0);assert.match(g.$('#historyAssignmentCard [role=status]').textContent,/nicht geladen/);g.view.destroy();
});

const editorDefaults={format:'original',fit:'contain',position_x:50,position_y:50,start_ms:0,end_ms:null,cover_ms:null,overlay_text:'',overlay_position:'bottom',audio_volume:100};
const editEntry=(n=1,extra={})=>({id:'ab660000-0000-4000-9000-'+String(n).padStart(12,'0'),asset_id:uid,asset_revision:'r1',file_name:'Example.mp4',media_kind:'video',revision:n+1,recorded_at:'2026-11-06T12:00:00Z',previous_settings:editorDefaults,settings:{...editorDefaults,overlay_text:'<img src=x onerror=bad()>'},changed_fields:['overlay_text'],...extra});
const edits=(entries=[editEntry()],extra={})=>({ok:true,version:1,month:'2026-11',timezone:'Europe/Vienna',total:entries.length,entries,has_more:false,next:null,...extra});
await test('editing snapshots show literal differences and paginate five rows across cursor batches',async()=>{
 const rows=Array.from({length:20},(_,n)=>editEntry(n)),next={before_at:rows.at(-1).recorded_at,before_id:rows.at(-1).id},calls=[];
 const f=fixture({requestTexts:()=>texts(),requestAssignments:()=>assignments(),requestEditors:i=>{calls.push(i);return i.before_id?edits([editEntry(21)],{total:21}):edits(rows,{total:21,has_more:true,next});}});await tick();
 assert.equal(f.page.querySelectorAll('[role=tab]').length,2);await openEditHistory(f,'edits');assert.equal(f.$('#historyEditorCard').hidden,false);assert.equal(f.$('#historyAssignmentCard').hidden,true);assert.equal(f.$('#historyEditorCard ol').children.length,5);assert.equal(f.$('#historyEditorCard img'),null);assert.match(f.$('#historyEditorCard').textContent,/Texteinblendung: Keine → <img/);assert.match(f.$('#historyEditorCard').textContent,/Noch kein Medienexport/);
 for(let n=0;n<4;n++){f.$('[aria-label="Weitere Bearbeitungsstände"]').click();await tick();}assert.equal(f.$('#historyEditorCard ol').children.length,1);assert.deepEqual(calls,[{month:'2026-11'},{month:'2026-11',...next}]);f.$('[aria-label="Vorherige Bearbeitungsstände"]').click();button(f,'Aufträge').click();await openEditHistory(f,'edits');assert.match(f.$('#historyEditorCard [role=status]').textContent,/16–20/);f.view.destroy();
});
await test('editing history clears on owner loss, leaving and visibility loss; late replies cannot restore private data',async()=>{
 for(const change of ['owner','leave','hidden','destroy']){const gate=deferred(),f=fixture({requestEditors:()=>gate.promise});await openEditHistory(f,'edits');if(change==='owner')f.owner('other',false);if(change==='leave')f.page.classList.remove('active');if(change==='hidden')f.visibility('hidden');if(change==='destroy')f.view.destroy();await tick();gate.resolve(edits());await tick();assert.equal(f.$('#historyEditorCard ol')?.children.length||0,0);f.view.destroy();}
});
await test('editing history rejects wrong-month results and duplicate cursor batches, then supports retry',async()=>{
 let response=edits();const f=fixture({requestEditors:()=>response});await openEditHistory(f,'edits');response=edits([],{month:'2026-10'});button(f,'Bearbeitungsverlauf aktualisieren').click();await tick();assert.equal(f.$('#historyEditorCard ol').children.length,0);assert.match(f.$('#historyEditorCard [role=status]').textContent,/nicht geladen/);response=edits();button(f,'Bearbeitungsverlauf aktualisieren').click();await tick();assert.equal(f.$('#historyEditorCard ol').children.length,1);f.view.destroy();
 const rows=Array.from({length:20},(_,n)=>editEntry(n)),next={before_at:rows.at(-1).recorded_at,before_id:rows.at(-1).id};const g=fixture({requestEditors:i=>i.before_id?edits([rows[0]],{total:21}):edits(rows,{total:21,has_more:true,next})});await openEditHistory(g,'edits');for(let n=0;n<4;n++){g.$('[aria-label="Weitere Bearbeitungsstände"]').click();await tick();}assert.equal(g.$('#historyEditorCard ol').children.length,0);assert.match(g.$('#historyEditorCard [role=status]').textContent,/nicht geladen/);g.view.destroy();
});

await test('cover status stays visible on compact rows; detail is collapsed and no publishing action exists',async()=>{
 const f=fixture({request:()=>result([entry(1,{status:'private_complete',cover:{status:'complete',updated_at:'2026-11-06T12:02:00Z'}})])});await tick();
 assert.match(f.$('summary .sma-history-cover-status').textContent,/Cover: Übertragung bestätigt/);assert.equal(f.$('ol details').hasAttribute('open'),false);
 assert.match(f.$('.sma-history-cover-detail').textContent,/nicht die öffentliche Sichtbarkeit/);assert.match(f.$('ol').textContent,/Cover-Stand: 06.11.2026, 13:02/);
 assert.equal(f.$('ol button,ol a'),null);assert.equal(f.$('[data-history-metric=public_confirmed]').textContent,'0');f.view.destroy();
});
await test('uncertain cover never promotes the completed video or offers a retry',async()=>{
 const f=fixture({request:()=>result([entry(1,{status:'private_complete',cover:{status:'uncertain',updated_at:'2026-11-06T12:02:00Z'}})])});await tick();
 assert.match(f.$('.sma-history-status').textContent,/Privat abgeschlossen/);assert.match(f.$('.sma-history-cover-status').textContent,/Ergebnis unklar/);assert.match(f.$('.sma-history-cover-detail').textContent,/nicht automatisch erneut/);assert.equal(f.$('ol button'),null);f.view.destroy();
});
await test('missing or forged cover status fails closed and owner loss removes the cover together with its order',async()=>{
 for(const cover of [null,{status:'complete',updated_at:null},{status:'<img src=x>',updated_at:'2026-11-06T12:02:00Z'}]){const f=fixture({request:()=>result([entry(1,{cover})])});await tick();assert.equal(f.$('ol').children.length,0);assert.match(f.$('[role=status]').textContent,/nicht geladen/);f.view.destroy();}
 const f=fixture();await tick();assert.match(f.$('.sma-history-cover-status').textContent,/Noch nicht festgehalten/);f.owner('other');assert.equal(f.$('.sma-history-cover-status'),null);f.view.destroy();
});
const analysisEntry=(n=1,extra={})=>({id:'ab115000-0000-4000-9000-'+String(n).padStart(12,'0'),file_name:'<img src=x onerror=bad()>.mp4',media_kind:'video',started_at:'2026-11-06T12:00:00Z',finished_at:'2026-11-06T12:01:00Z',status:'completed',error_code:null,...extra});
const analyses=(entries=[analysisEntry()],extra={})=>({ok:true,version:1,month:'2026-11',timezone:'Europe/Vienna',can_publish:false,total:entries.length,entries,has_more:false,next:null,...extra});
await test('analysis chapter renders literal names, separate statuses, five rows and no analysis or publication action',async()=>{
 const rows=Array.from({length:20},(_,n)=>analysisEntry(n)),next={before_at:rows.at(-1).started_at,before_id:rows.at(-1).id},calls=[];
 const f=fixture({requestTexts:()=>texts(),requestAssignments:()=>assignments(),requestEditors:()=>edits(),requestAnalyses:i=>{calls.push(i);return i.before_id?analyses([analysisEntry(21)],{total:21}):analyses(rows,{total:21,has_more:true,next});}});await tick();
 assert.equal(f.page.querySelectorAll('[role=tab]').length,3);await openChapter(f,'Analyse');assert.equal(f.$('#historyAnalysisCard').hidden,false);assert.equal(f.$('#historyOrderCard').hidden,true);assert.equal(f.$('#historyAnalysisCard ol').children.length,5);assert.equal(f.$('#historyAnalysisCard img'),null);assert.equal(f.$('#historyAnalysisCard ol button,#historyAnalysisCard ol a'),null);assert.match(f.$('#historyAnalysisCard').textContent,/Keine Sicherheitsprüfung oder Veröffentlichungsfreigabe/);assert.equal(f.$('[data-history-metric=orders]').textContent,'1');
 for(let n=0;n<4;n++){f.$('[aria-label="Weitere Analyseversuche"]').click();await tick();}assert.equal(f.$('#historyAnalysisCard ol').children.length,1);assert.deepEqual(calls,[{month:'2026-11'},{month:'2026-11',...next}]);f.$('[aria-label="Vorherige Analyseversuche"]').click();button(f,'Aufträge').click();await openChapter(f,'Analyse');assert.match(f.$('#historyAnalysisCard [role=status]').textContent,/16–20/);f.view.destroy();assert.equal(f.$('#historyAnalysisCard'),null);
});
await test('analysis history drops late replies after owner, month, page or visibility change and teardown',async()=>{
 for(const change of ['owner','leave','hidden','destroy','month']){const gate=deferred(),f=fixture({requestAnalyses:()=>gate.promise});await openChapter(f,'Analyse');if(change==='owner')f.owner('other',false);if(change==='leave')f.page.classList.remove('active');if(change==='hidden')f.visibility('hidden');if(change==='destroy')f.view.destroy();if(change==='month')button(f,'Alle Monate').click();await tick();gate.resolve(analyses());await tick();assert.equal(f.$('#historyAnalysisCard ol')?.children.length||0,0);f.view.destroy();}
});
await test('analysis history rejects wrong month, invalid statuses and duplicate cursor pages then permits read-only retry',async()=>{
 let value=analyses();const f=fixture({requestAnalyses:()=>value});await openChapter(f,'Analyse');for(const invalid of [analyses([],{month:'2026-10'}),analyses([analysisEntry(1,{status:'published'})]),analyses([],{can_publish:true})]){value=invalid;button(f,'Analyseverlauf aktualisieren').click();await tick();assert.equal(f.$('#historyAnalysisCard ol').children.length,0);assert.match(f.$('#historyAnalysisCard [role=status]').textContent,/nicht geladen/);}value=analyses();button(f,'Analyseverlauf aktualisieren').click();await tick();assert.equal(f.$('#historyAnalysisCard ol').children.length,1);f.view.destroy();
 const rows=Array.from({length:20},(_,n)=>analysisEntry(n)),next={before_at:rows.at(-1).started_at,before_id:rows.at(-1).id};const g=fixture({requestAnalyses:i=>i.before_id?analyses([rows[0]],{total:21}):analyses(rows,{total:21,has_more:true,next})});await openChapter(g,'Analyse');for(let n=0;n<4;n++){g.$('[aria-label="Weitere Analyseversuche"]').click();await tick();}assert.equal(g.$('#historyAnalysisCard ol').children.length,0);g.view.destroy();
});
await test('analysis history distinguishes empty periods, failures and expired unfinished attempts',async()=>{
 const f=fixture({requestAnalyses:()=>analyses([analysisEntry(1,{status:'failed',error_code:'FILE_CHANGED'}),analysisEntry(2,{status:'timed_out',finished_at:null}),analysisEntry(3,{status:'processing',finished_at:null})])});await openChapter(f,'Analyse');assert.match(f.$('#historyAnalysisCard').textContent,/Analyse fehlgeschlagen/);assert.match(f.$('#historyAnalysisCard').textContent,/Zeit abgelaufen/);assert.match(f.$('#historyAnalysisCard').textContent,/Analyse läuft/);assert.match(f.$('#historyAnalysisCard').textContent,/kein automatischer Neustart/);f.view.destroy();
 const g=fixture({requestAnalyses:()=>analyses([])});await openChapter(g,'Analyse');assert.match(g.$('#historyAnalysisCard').textContent,/Frühere Versuche wurden nicht nachträglich erfasst/);assert.equal(g.$('#historyAnalysisCard nav').hidden,true);g.view.destroy();
});
await test('opening History reads only orders, then each chosen chapter once per period',async()=>{
 const reads=[];
 const reader=(name,response)=>input=>{reads.push([name,input.month]);return response([],{month:input.month});};
 const f=fixture({
  request:input=>result([],null,{month:input.month===undefined?'2026-11':input.month}),
  requestTexts:reader('texts',texts),requestAssignments:reader('files',assignments),
  requestEditors:reader('edits',edits),requestAnalyses:reader('analyses',analyses)
 });
 await tick();
 assert.deepEqual(f.calls,[{}]);assert.deepEqual(reads,[]);
 assert.deepEqual([...f.page.querySelectorAll('[role=tab]')].map(b=>b.textContent),['Aufträge','Bearbeiten','Analyse']);
 assert.deepEqual([...f.page.querySelectorAll('#historyEditType option')].map(o=>o.textContent),['Bild und Video','Beitragstexte','Dateizuordnungen']);
 await openChapter(f,'Bearbeiten');
 assert.equal(f.$('#historyEditorCard').closest('[hidden]'),null);
 await openEditHistory(f,'assignments');await openChapter(f,'Aufträge');await openChapter(f,'Bearbeiten');
 assert.equal(f.$('#historyAssignmentCard').closest('[hidden]'),null);
 await openEditHistory(f,'texts');await openChapter(f,'Analyse');await openChapter(f,'Bearbeiten');
 assert.deepEqual(reads,[['edits','2026-11'],['files','2026-11'],['texts','2026-11'],['analyses','2026-11']]);
 assert.equal(f.calls.length,1);
 button(f,'Alle Monate').click();await tick();
 assert.deepEqual(f.calls,[{},{month:null}]);assert.deepEqual(reads.slice(4),[['texts',null]]);
 await openEditHistory(f,'assignments');await openEditHistory(f,'texts');
 assert.deepEqual(reads.slice(4),[['texts',null],['files',null]]);
 f.visibility('hidden');await tick();f.visibility('visible');await tick();
 assert.deepEqual(reads.slice(6),[['texts',null]]);f.view.destroy();
});
await test('selection while the period loads and repeat visits during an outstanding read do not fan out',async()=>{
 const period=deferred(),pending=deferred(),reads=[];
 const f=fixture({request:()=>period.promise,
  requestTexts:i=>{reads.push(['texts',i.month]);return texts();},
  requestAnalyses:i=>{reads.push(['analyses',i.month]);return pending.promise;}
 });
 await openEditHistory(f,'texts');await openChapter(f,'Analyse');assert.deepEqual(reads,[]);
 period.resolve(result());await tick();
 await openChapter(f,'Aufträge');await openChapter(f,'Analyse');await openChapter(f,'Analyse');
 assert.deepEqual(reads,[['analyses','2026-11']]);assert.equal(f.calls.length,1);
 pending.resolve(analyses());await tick();assert.equal(f.$('#historyAnalysisCard ol').children.length,1);f.view.destroy();
});
await test('a failed period read exposes the orders retry and a new chapter selection can recover',async()=>{
 const period=deferred();let reads=0;
 const f=fixture({request:()=>f.calls.length===1?period.promise:result(),requestTexts:()=>{reads++;return texts();}});
 await openEditHistory(f,'texts');period.resolve({ok:false});await tick();
 assert.equal(f.$('#historyOrderCard').hidden,false);assert.match(f.$('#historyActivitySlot [role=status]').textContent,/nicht geladen/);
 assert.equal(reads,0);await openEditHistory(f,'texts');assert.equal(f.calls.length,2);assert.equal(reads,1);
 assert.equal(f.$('#historyTextCard ol').children.length,1);f.view.destroy();
});
await test('return targets the saved row on page six and crosses batches in both directions',async()=>{
 const rows=Array.from({length:28},(_,i)=>entry(i+1)),id=rows[26].id,calls=[];
 const first=rows.slice(0,20),next={before_at:first[19].created_at,before_id:first[19].id};
 const fetchPage=(order,page)=>{
  calls.push([order,page]);const target=page??6;
  return {...result(target>4?rows.slice(20):first,target>4?null:next,{summary:{orders:28,platforms:['youtube'],public_confirmed:0}}),order_page:target};
 };
 const f=fixture({active:false,hash:'#auftrag/'+id,requestOrderPage:fetchPage});await tick();
 assert.deepEqual(calls,[[id,null]]);assert.deepEqual(f.calls,[]);assert.equal(f.page.classList.contains('active'),true);
 assert.match(f.$('#historyActivitySlot [role=status]').textContent,/26–28.*Seite 6/);
 const details=Array.from(f.doc.querySelectorAll('ol li details'));assert.equal(details.filter(e=>e.open).length,1);assert.equal(details[1].open,true);
 const prev=f.$('[aria-label="Vorherige Aufträge"]'),more=f.$('[aria-label="Weitere Aufträge"]');
 prev.click();await tick();prev.click();await tick();assert.match(f.$('#historyActivitySlot [role=status]').textContent,/16–20.*Seite 4/);
 more.click();await tick();assert.match(f.$('#historyActivitySlot [role=status]').textContent,/21–25.*Seite 5/);
 assert.deepEqual(calls,[[id,null],[id,4],[id,5]]);
 button(f,'Aktueller Monat').click();await tick();assert.deepEqual(f.calls,[{}]);assert.equal(f.window.location.hash,'');f.view.destroy();
});
await test('unknown, mismatched and late order returns never open a different row',async()=>{
 const id=entry().id;
 for(const response of [{ok:false,code:'ORDER_UNAVAILABLE'},{...result([entry(2)]),order_page:1},{...result(),order_page:7}]){
  const f=fixture({hash:'#auftrag/'+id,requestOrderPage:()=>response});await tick();assert.equal(f.$('ol').children.length,0);
  assert.match(f.$('#historyActivitySlot [role=status]').textContent,/nicht verfügbar|nicht geladen/);f.view.destroy();
 }
 const gate=deferred(),f=fixture({hash:'#auftrag/'+id,requestOrderPage:()=>gate.promise});await tick();f.owner('other');
 gate.resolve({...result(),order_page:1});await tick();assert.equal(f.$('ol').children.length,0);f.view.destroy();
});
await test('expired preparation shows the next step without exposing approval controls',async()=>{
 const f=fixture({request:()=>result([entry(1,{status:'prepared',approval_window:{status:'expired',expires_at:'2026-11-07T11:02:26Z'}})])});
 await tick();assert.equal(f.$('.sma-history-status').textContent,'Vorbereitung abgelaufen');
 const link=f.$('ol a');
 assert.equal(link.textContent,'Aktuellen Beitrag öffnen');assert.equal(link.hidden,false);
 assert.equal(link.getAttribute('href'),'/app/publication-preview.html?wide=1&portal=youtube&order='+entry(1).id);
 assert.equal(link.getAttribute('target'),'_top');assert.equal(f.$('ol button'),null);f.view.destroy();
});
await test('active preparation links to the same order and falls back to preview at expiry',async()=>{
 const now=Date.now();
 mock.timers.enable({apis:['Date','setTimeout'],now});
 const expires=new Date(now+60000).toISOString();
 const f=fixture({request:()=>result([entry(1,{status:'prepared',approval_window:{status:'active',expires_at:expires}})])});
 try{
  await tick();
  const link=f.$('ol a'),preview='/app/publication-preview.html?wide=1&portal=youtube&order='+entry(1).id;
  assert.equal(link.hidden,false);assert.equal(link.textContent,'Vorbereitung fortsetzen');
  assert.equal(link.getAttribute('href'),preview+'&resume=1');
  mock.timers.tick(60001);
  assert.equal(link.textContent,'Aktuellen Beitrag öffnen');assert.equal(link.getAttribute('href'),preview);
  assert.deepEqual(f.calls,[{}]);
 }finally{f.view.destroy();mock.timers.reset();}
});
await test('checked orders link to their recorded order without dispatching on open',async()=>{
 const row=entry(1,{status:'checked',platform:'youtube'});
 const f=fixture({request:()=>result([row])});
 try{
  await tick();const link=f.$('ol a');
  assert.equal(link.textContent,'Geprüften Auftrag öffnen');
  assert.equal(link.getAttribute('href'),'/app/publication-preview.html?wide=1&portal=youtube&order='+row.id+'&view=transfer&resume=1');
  assert.deepEqual(f.calls,[{}]);
 }finally{f.view.destroy();}
});
await test('a TikTok account recheck switches to the current post link when its deadline passes',async()=>{
 const now=Date.now();mock.timers.enable({apis:['Date','setTimeout'],now});
 const row=entry(1,{platform:'tiktok',status:'prepared',approval_window:{status:'recheck',expires_at:new Date(now+1000).toISOString()}});
 const f=fixture({request:()=>result([row],null,{summary:{orders:1,public_confirmed:0,platforms:['tiktok']}})});
 try{
  await tick();const link=f.$('ol a');
  assert.match(f.$('.sma-history-status').textContent,/Kontoprüfung/);
  mock.timers.tick(1001);assert.equal(link.textContent,'Aktuellen Beitrag öffnen');assert.match(f.$('.sma-history-status').textContent,/abgelaufen/);
  assert.equal(link.getAttribute('href'),'/app/publication-preview.html?wide=1&portal=tiktok&order='+entry(1).id);assert.deepEqual(f.calls,[{}]);
 }finally{f.view.destroy();mock.timers.reset();}
});
await test('unfinished order links to its saved preparation until the server deadline',async()=>{
 const now=Date.now();mock.timers.enable({apis:['Date','setTimeout'],now});
 const expires_at=new Date(now+60000).toISOString();
 const f=fixture({request:()=>result([entry(1,{status:'preparing',target_name:'',preparation_window:{status:'active',expires_at}})])});
 try{
  await tick();
  const link=f.$('ol a'),url='/app/publication-preview.html?wide=1&portal=youtube&order='+entry(1).id;
  assert.equal(link.getAttribute('href'),url+'&resume=1');assert.match(f.$('ol').textContent,/Zielkonto ist noch offen/);
  mock.timers.tick(60001);assert.equal(link.getAttribute('href'),url);assert.match(f.$('ol').textContent,/Vorbereitung abgelaufen/);
  assert.deepEqual(f.calls,[{}]);
 }finally{f.view.destroy();mock.timers.reset();}
});
await test('History searches the full owner archive and opens the saved order without a new tab',async()=>{
 const selected=entry(3,{title:'Hotel-Türgriff Demo',status:'uncertain'});
 const found={ok:true,version:1,entries:[{id:selected.id,title:selected.title,platform:'youtube',status:selected.status,created_at:selected.created_at}],has_more:false,can_upload:false,can_publish:false};
 const terms=[],lookups=[];
 mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
 const f=fixture({
  requestFind:async term=>{terms.push(term);return found;},
  requestOrderPage:async(id,page)=>{lookups.push([id,page]);return result([selected],null,{order_page:1});}
 });
 try{
  await tick();
  const input=f.$('#smaHistorySearch');assert(input);
  input.value='Hotel';input.dispatchEvent(new f.window.Event('input',{bubbles:true}));
  assert.equal(f.$('.sma-history-list').hidden,true);
  mock.timers.tick(351);await tick();await tick();
  assert.deepEqual(terms,['Hotel']);
  const buttons=[...f.$('.sma-history-find-results').querySelectorAll('button')];
  assert.equal(buttons.length,1);
  assert.match(buttons[0].textContent,/Hotel-Türgriff Demo/);
  const description=f.doc.getElementById(buttons[0].getAttribute('aria-describedby'));
  assert.match(description.textContent,/YouTube · Ergebnis unklar/);
  buttons[0].click();await tick();await tick();
  assert.deepEqual(lookups,[[selected.id,null]]);
  assert.equal(input.value,'');
  assert.equal(f.$('.sma-history-list').hidden,false);
  assert.match(f.$('.sma-history-list').textContent,/Hotel-Türgriff Demo/);
  assert.match(f.$('.sma-history-list').textContent,/Ergebnis unklar/);
  assert.equal(f.doc.querySelectorAll('a[target="_blank"]').length,0);
 }finally{f.view.destroy();mock.timers.reset();}
});
await test('History search rejects late results after losing the current owner',async()=>{
 const pending=deferred(),calls=[];
 mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});
 const f=fixture({requestFind:term=>{calls.push(term);return pending.promise;}});
 try{
  await tick();const input=f.$('#smaHistorySearch');input.value='Hotel';
  input.dispatchEvent(new f.window.Event('input',{bubbles:true}));
  mock.timers.tick(351);await tick();
  assert.deepEqual(calls,['Hotel']);
  f.owner('other');pending.resolve({ok:true,version:1,entries:[{id:entry().id,title:'INTERNAL_OTHER_ORDER',platform:'youtube',status:'prepared',created_at:entry().created_at}],has_more:false,can_upload:false,can_publish:false});
  await tick();await tick();
  assert.equal(f.$('.sma-history-find-results').children.length,0);
  assert.equal(input.disabled,true);
  assert.doesNotMatch(f.page.textContent,/INTERNAL_OTHER_ORDER/);
 }finally{f.view.destroy();mock.timers.reset();}
});

console.log(`${passed} history DOM scenarios passed.`);
