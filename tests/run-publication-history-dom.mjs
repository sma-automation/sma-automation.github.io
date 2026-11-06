import assert from 'node:assert/strict';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountPublicationHistory} from '../app/assets/publication-history-dashboard.mjs';
const uid='ab660000-0000-4000-8000-000000000091',tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const entry=(n=1,extra={})=>({id:'ab660000-0000-4000-9000-'+String(n).padStart(12,'0'),platform:'youtube',title:'Fixture title',target_name:'Fixture channel',status:'blocked',created_at:'2026-11-06T12:00:00Z',updated_at:'2026-11-06T12:01:00Z',...extra});
const result=(entries=[entry()],next=null)=>({ok:true,version:1,entries,has_more:!!next,next});
function fixture({active=true,request=()=>result(),getOwnerId}={}){
 const {document:doc,window}=parseHTML('<html><head></head><body><section id="page-history" class="'+(active?'active':'')+'"><div><div class="card-title">Aktivitätsverlauf</div><p>Old intro</p><div id="historyActivitySlot"></div></div></section></body></html>');
 Object.defineProperty(doc,'visibilityState',{value:'visible',writable:true});let owner=uid,callback,unsubscribed=0;const calls=[];
 const view=mountPublicationHistory({doc,ownerWindow:window,expectedOwnerId:uid,stylesheetUrl:'/history.css',getOwnerId:getOwnerId||(async()=>owner),watchOwner:cb=>{callback=cb;return {unsubscribe(){unsubscribed++;}};},request:input=>{calls.push(input);return request(input);}});
 const page=doc.getElementById('page-history');
 return {doc,window,page,view,calls,$:s=>page.querySelector(s),owner(id,notify=true){owner=id;if(notify)callback(id);},focus(){window.dispatchEvent(new window.Event('focus'));},visibility(value){doc.visibilityState=value;doc.dispatchEvent(new window.Event('visibilitychange'));},get unsubscribed(){return unsubscribed;}};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
await test('renders saved status with text-only untrusted title and no action links',async()=>{
 const f=fixture({request:()=>result([entry(1,{title:'<img src=x onerror=alert(1)>',target_name:'<script>bad</script>'})])});await tick();
 assert.match(f.$('ol').textContent,/Blockiert/);assert.match(f.$('ol').textContent,/<img/);assert.equal(f.$('img'),null);assert.equal(f.$('script'),null);assert.equal(f.$('a'),null);assert.deepEqual(f.calls,[{}]);assert.equal(f.page.querySelectorAll('button').length,2);f.view.destroy();
});
await test('hidden History is silent and opening it loads; leaving clears results',async()=>{
 const f=fixture({active:false});await tick();assert.equal(f.calls.length,0);f.page.classList.add('active');await tick();assert.equal(f.calls.length,1);assert.equal(f.page.querySelectorAll('li').length,1);
 f.page.classList.remove('active');await tick();assert.equal(f.page.querySelectorAll('li').length,0);f.focus();await tick();assert.equal(f.calls.length,1);f.view.destroy();
});
await test('pagination appends uniquely and refresh returns to newest page',async()=>{
 const entries=Array.from({length:20},(_,i)=>entry(i+10)),next={before_at:entries[19].created_at,before_id:entries[19].id};
 const f=fixture({request:input=>input.before_id?result([entry(1)]):result(entries,next)});await tick();f.$('#historyActivitySlot > button').click();await tick();assert.equal(f.page.querySelectorAll('li').length,21);assert.deepEqual(f.calls,[{},next]);
 f.$('.sma-history-toolbar button').click();await tick();assert.equal(f.page.querySelectorAll('li').length,20);assert.deepEqual(f.calls[2],{});f.view.destroy();
});
await test('network or malformed result clears previous data and allows retry',async()=>{
 let response=result();const f=fixture({request:()=>{if(response instanceof Error)throw response;return response;}});await tick();
 for(const invalid of [Error('offline'),{ok:false,code:'ACCESS_INACTIVE'},result([entry(1,{status:'published'})])]){response=invalid;f.focus();await tick();assert.equal(f.page.querySelectorAll('li').length,0);assert.match(f.$('[role=status]').textContent,/nicht geladen/);assert.equal(f.$('button').disabled,false);}
 response=result([]);f.$('button').click();await tick();assert.match(f.$('[role=status]').textContent,/Noch keine/);f.view.destroy();
});
await test('owner event immediately clears and ignores late former-owner response',async()=>{
 let response=result();const f=fixture({request:()=>response});await tick();const gate=deferred();response=gate.promise;f.focus();await tick();f.owner('other');assert.equal(f.page.querySelectorAll('li').length,0);gate.resolve(result());await tick();assert.equal(f.page.querySelectorAll('li').length,0);assert.equal(f.$('button').disabled,true);f.view.destroy();assert.equal(f.unsubscribed,1);
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
console.log(`${passed} history DOM scenarios passed.`);
