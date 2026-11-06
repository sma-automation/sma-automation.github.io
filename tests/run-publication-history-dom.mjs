import assert from 'node:assert/strict';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountPublicationHistory} from '../app/assets/publication-history-dashboard.mjs';
const uid='ab660000-0000-4000-8000-000000000091',tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const entry=(n=1,extra={})=>({id:'ab660000-0000-4000-9000-'+String(n).padStart(12,'0'),platform:'youtube',title:'Fixture title',target_name:'Fixture channel',status:'blocked',created_at:'2026-11-06T12:00:00Z',updated_at:'2026-11-06T12:01:00Z',...extra});
const result=(entries=[entry()],next=null,extra={})=>({ok:true,version:2,month:'2026-11',timezone:'Europe/Vienna',summary:{orders:next?21:entries.length,public_confirmed:0,platforms:entries.length?['youtube']:[]},months:entries.length?[{month:'2026-11',orders:next?21:entries.length}]:[],entries,has_more:!!next,next,...extra});
function fixture({active=true,request=()=>result(),getOwnerId}={}){
 const {document:doc,window}=parseHTML('<html><head></head><body><section id="page-history" class="'+(active?'active':'')+'"><div class="grid">'+Array.from({length:3},()=>'<div class="card"><div class="card-title">Old metric</div><div class="big-value">–</div><div class="muted">Old detail</div></div>').join('')+'</div><div class="card"><div class="card-title">Aktivitätsverlauf</div><p>Old intro</p><div id="historyActivitySlot" class="empty-state"></div></div><div class="card"><div class="card-title">Monatsarchiv</div><p>Old archive</p><div id="historyMonthSlot" style="display:flex"></div></div></section></body></html>');
 Object.defineProperty(doc,'visibilityState',{value:'visible',writable:true});let owner=uid,callback,unsubscribed=0;const calls=[];
 const view=mountPublicationHistory({doc,ownerWindow:window,expectedOwnerId:uid,stylesheetUrl:'/history.css',getOwnerId:getOwnerId||(async()=>owner),watchOwner:cb=>{callback=cb;return {unsubscribe(){unsubscribed++;}};},request:input=>{calls.push(input);return request(input);}});
 const page=doc.getElementById('page-history');
 return {doc,window,page,view,calls,$:s=>page.querySelector(s),owner(id,notify=true){owner=id;if(notify)callback(id);},focus(){window.dispatchEvent(new window.Event('focus'));},visibility(value){doc.visibilityState=value;doc.dispatchEvent(new window.Event('visibilitychange'));},get unsubscribed(){return unsubscribed;}};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
await test('renders saved status with text-only untrusted title and no action links',async()=>{
 const f=fixture({request:()=>result([entry(1,{title:'<img src=x onerror=alert(1)>',target_name:'<script>bad</script>'})])});await tick();
 assert.match(f.$('ol').textContent,/Blockiert/);assert.match(f.$('ol').textContent,/<img/);assert.equal(f.$('img'),null);assert.equal(f.$('script'),null);assert.equal(f.$('a'),null);assert.deepEqual(f.calls,[{}]);assert.equal(f.$('#historyActivitySlot').querySelectorAll('button').length,2);f.view.destroy();
});
await test('hidden History is silent and opening it loads; leaving clears results',async()=>{
 const f=fixture({active:false});await tick();assert.equal(f.calls.length,0);f.page.classList.add('active');await tick();assert.equal(f.calls.length,1);assert.equal(f.page.querySelectorAll('li').length,1);
 f.page.classList.remove('active');await tick();assert.equal(f.page.querySelectorAll('li').length,0);f.focus();await tick();assert.equal(f.calls.length,1);f.view.destroy();
});
await test('pagination appends uniquely and refresh returns to newest page',async()=>{
 const entries=Array.from({length:20},(_,i)=>entry(i+10)),next={before_at:entries[19].created_at,before_id:entries[19].id};
 const f=fixture({request:input=>input.before_id?result([entry(1)],null,{summary:{orders:21,public_confirmed:0,platforms:['youtube']}}):result(entries,next)});await tick();f.$('#historyActivitySlot > button').click();await tick();assert.equal(f.page.querySelectorAll('li').length,21);assert.deepEqual(f.calls,[{},{month:'2026-11',...next}]);
 f.$('.sma-history-toolbar button').click();await tick();assert.equal(f.page.querySelectorAll('li').length,20);assert.deepEqual(f.calls[2],{month:'2026-11'});f.view.destroy();
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
await test('monthly totals describe all selected orders, not only the visible page',async()=>{
 const entries=Array.from({length:20},(_,i)=>entry(i+10)),next={before_at:entries[19].created_at,before_id:entries[19].id};
 const f=fixture({request:()=>result(entries,next,{summary:{orders:35,public_confirmed:3,platforms:['youtube','tiktok']}})});await tick();
 assert.equal(f.$('[data-history-metric=orders]').textContent,'35');assert.equal(f.$('[data-history-metric=public_confirmed]').textContent,'3');assert.equal(f.$('[data-history-metric=platforms]').textContent,'2');
 assert.match(f.$('[role=status]').textContent,/20 von 35/);assert.match(f.$('[data-history-period]').textContent,/November 2026/);assert.match(f.$('small').textContent,/13:00/);
 const cards=[...f.page.children];assert.ok(cards.indexOf(f.$('#historyMonthSlot').parentElement)<cards.indexOf(f.$('#historyActivitySlot').parentElement));f.view.destroy();
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
console.log(`${passed} history DOM scenarios passed.`);
