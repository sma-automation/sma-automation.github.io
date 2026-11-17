import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountDashboardChapters} from '../app/assets/dashboard-chapters.mjs';

const require=createRequire(import.meta.url);
const {installDashboardOAuthRefresh}=require('../n8n/consolidation/dashboard-oauth-refresh.cjs');
const {platforms,origin,endpoint,owner,otherOwner,customer,otherCustomer,shell,dashboardReadSource,controlledClock}=require('./fixtures/oauth-return-fixture.cjs');
const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));};

// The actual self-contained renderer block runs in its own VM with a real DOM.
// Its default parent callback is the actual dashboardHtml/smaDashboardResponse
// implementation. Only sessions, clock and dashboard HTTP responses are faked.
function setup(t,{connected=[],language='de',chapters=true}={}){
 const {document,window:events}=parseHTML(shell({connected}));
 const {document:topDocument}=parseHTML('<html><body><a id="regularDashboard"></a></body></html>');
 Object.defineProperty(document,'hidden',{configurable:true,value:false,writable:true});
 const clock=controlledClock(),posts=[],responses=[],redirects=[],authHolds=[];
 let sessionOwner=owner,holdSession=false;
 const parentWindow={location:{replace:url=>redirects.push(url)}};
 const parent={AbortController,AbortSignal,URLSearchParams,Response,document:topDocument,
  location:{search:''},window:parentWindow,endpoint,dashboardOwnerId:owner,signedOut:false,
  setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,
  supabase:{auth:{getSession:()=>{
   const result={data:{session:sessionOwner?{user:{id:sessionOwner},access_token:'synthetic-'+sessionOwner}:null},error:null};
   if(holdSession){holdSession=false;return new Promise(resolve=>authHolds.push(()=>resolve(result)));}
   return Promise.resolve(result);
  }},rpc(){throw Error('Unexpected RPC in synthetic OAuth dashboard read');}},
  fetch:async(url,options)=>{
   assert.equal(url,endpoint);assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');
   assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,'Bearer synthetic-'+sessionOwner);
   const reply=responses.shift()||{},row={url,options,reply};posts.push(row);
   // Capture at dispatch: a late reply remains the snapshot of its old request.
   const html=reply.html??shell(reply),status=reply.status??200;
   if(reply.hold)await new Promise(resolve=>{row.release=resolve;});
   if(reply.error)throw Error('Synthetic transport failure');
   return {ok:status>=200&&status<300,status,json:async()=>({html})};
  },
  leaveDashboard(){parent.signedOut=true;parent.dashboardOwnerId=null;parent.cancelDashboardReads();redirects.push('index.html');}
 };
 vm.createContext(parent);vm.runInContext(dashboardReadSource(),parent,{filename:'actual-dashboard-read-wrapper.js'});
 const host={document,parent:parentWindow,DOMParser:events.DOMParser,
  setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,
  addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 let applied=0;
 const context={window:host,document,now:clock.now,currentLanguage:()=>language,setLanguage:()=>{applied++;}};
 const controller=vm.runInNewContext('('+installDashboardOAuthRefresh.toString()+')({window,document,now,currentLanguage,setLanguage})',context,{filename:'actual-dashboard-oauth-refresh.js'});
 const mounted=chapters?mountDashboardChapters({doc:document,stylesheetUrl:'/synthetic-chapters.css'}):null;
 const event=(target,type,values={})=>{const e=new events.Event(type,{bubbles:true,cancelable:true});Object.assign(e,values);target.dispatchEvent(e);return e;};
 const f={document,clock,posts,responses,redirects,controller,chapters:mounted,parent,
  get applied(){return applied;},
  query:selector=>document.querySelector(selector),
  connected:platform=>document.querySelector('#page-social .platform-card[data-sma-platform="'+platform+'"]').classList.contains('connected'),
  click(platform='YouTube'){
   const link=document.querySelector('#page-social .platform-card[data-sma-platform="'+platform+'"] .platform-action a');
   assert.ok(link);event(link.firstElementChild||link,'click',{button:0});
  },
  manual(){const button=document.querySelector('.sma-oauth-status-check');assert.ok(button);event(button,'click',{button:0});},
  focus:()=>event(events,'focus'),
  visibility(hidden){document.hidden=hidden;event(document,'visibilitychange');},
  returned(){document.hidden=false;event(events,'focus');event(document,'visibilitychange');},
  success(platform='YouTube',zeit=clock.now(),eventOrigin=origin){event(events,'message',{origin:eventOrigin,data:{type:'sma-oauth-success',platform,zeit}});},
  message:data=>event(events,'message',{origin,...data}),
  storage(value,key='sma_oauth_success'){event(events,'storage',{key,newValue:typeof value==='string'?value:JSON.stringify(value)});},
  hide(persisted=false){event(events,'pagehide',{persisted});},
  show(persisted=true){event(events,'pageshow',{persisted});},
  owner(value){sessionOwner=value;},
  logout(){sessionOwner=null;parent.signedOut=true;parent.cancelDashboardReads();event(events,'pagehide');},
  holdSession(){holdSession=true;},
  async releaseSession(){assert.ok(authHolds.length);authHolds.shift()();await settle();},
  advance:ms=>clock.advance(ms,settle),
  async release(index=0){assert.equal(typeof posts[index]?.release,'function');posts[index].release();await settle();},
  async close(){controller.destroy();mounted?.destroy();parent.cancelDashboardReads();for(const row of posts)row.release?.();for(const release of authHolds)release();await settle();}
 };
 t.after(()=>f.close());return f;
}

test('idle focus and visibility events do not read a dashboard without a connection action',async t=>{
 const f=setup(t);for(let i=0;i<6;i++){f.returned();await f.advance(1000);}
 assert.equal(f.posts.length,0);assert.equal(f.query('.sma-oauth-status').hidden,true);
 f.success();await f.advance(1000);assert.equal(f.posts.length,0);
});

for(const platform of platforms)test(platform+': one cancelled connection plus six returns costs one dashboard POST',async t=>{
 const f=setup(t);f.click(platform);assert.equal(f.posts.length,0);
 f.returned();f.focus();await f.advance(349);assert.equal(f.posts.length,0);
 await f.advance(1);assert.equal(f.posts.length,1);assert.equal(f.connected(platform),false);
 for(let i=0;i<6;i++){f.returned();await f.advance(1000);}
 await f.advance(120000);assert.equal(f.posts.length,1,'disconnected is not permission to poll again');
 assert.equal(f.query('.sma-oauth-status-check').disabled,false);
 assert.match(f.query('.sma-oauth-status-message').textContent,/Noch keine Verbindung bestätigt/);
});

test('hidden visibility events do not consume the first real return',async t=>{
 const f=setup(t);f.click();f.visibility(true);f.focus();await f.advance(1000);assert.equal(f.posts.length,0);
 f.visibility(false);f.focus();await f.advance(350);assert.equal(f.posts.length,1);
});

for(const reply of [{error:true},{status:503},{html:'<html><body>Malformed dashboard</body></html>'}])
test('failed return '+JSON.stringify(reply)+' has no background or focus retry',async t=>{
 const f=setup(t);f.responses.push(reply);f.click();f.returned();await f.advance(350);
 assert.equal(f.posts.length,1);assert.match(f.query('.sma-oauth-status-message').textContent,/nicht geprüft/);
 for(let i=0;i<6;i++){f.returned();await f.advance(4000);}
 assert.equal(f.posts.length,1);assert.equal(f.query('.sma-oauth-status-check').disabled,false);
 f.responses.push({connected:['YouTube']});f.manual();await f.advance(0);
 assert.equal(f.posts.length,2);assert.equal(f.connected('YouTube'),true);
});

test('manual status control remains visible and usable in the actual publishing chapter after both list replacements',async t=>{
 const f=setup(t),publishing=f.query('#page-publishing'),social=f.query('#page-social'),input=f.query('#unsaved');
 assert.ok(f.chapters?.connections);assert.ok(publishing.contains(social));
 assert.equal(social.classList.contains('page'),false);assert.equal(f.query('[data-page="social"]').hidden,true);
 assert.equal(f.chapters.controllers.get('publishing').selected,'portals');
 f.click();f.returned();await f.advance(350);
 const button=f.query('.sma-oauth-status-check'),panel=button.parentElement;
 assert.equal(button.type,'button');assert.equal(button.textContent,'Verbindungsstatus prüfen');
 assert.equal(button.closest('.platform-list'),null);assert.equal(button.closest('[hidden]'),null);
 assert.equal(panel.previousElementSibling,social.querySelector('.platform-list'));
 assert.equal(button.getAttribute('data-sma-platform'),'YouTube');
 f.responses.push({connected:['YouTube'],revision:'first-manual'});f.manual();f.manual();await f.advance(0);
 assert.equal(f.posts.length,2);assert.equal(f.connected('YouTube'),true);assert.equal(f.query('.sma-oauth-status-check'),button);
 assert.equal(f.query('[data-sma-social-count]').textContent,'1');
 assert.equal(f.query('#page-publishing > .sma-chapter-panel .platform-list .platform-card').dataset.fixtureRevision,'first-manual');
 assert.equal(f.query('#unsaved'),input);assert.equal(input.value,'Noch nicht gespeicherter Text');
 f.chapters.controllers.get('publishing').select('files');assert.ok(button.closest('[hidden]'));
 f.chapters.controllers.get('publishing').select('portals');assert.equal(button.closest('[hidden]'),null);
 f.responses.push({connected:['YouTube','TikTok'],revision:'second-manual'});f.manual();await f.advance(0);
 assert.equal(f.posts.length,3);assert.equal(f.connected('TikTok'),true);assert.equal(f.query('.sma-oauth-status-check'),button);
 f.returned();await f.advance(1000);assert.equal(f.posts.length,3);
});

test('a manual check before returning consumes that attempt passive allowance',async t=>{
 const f=setup(t,{language:'en'});f.click();assert.equal(f.query('.sma-oauth-status-check').textContent,'Check connection status');
 f.manual();await f.advance(0);assert.equal(f.posts.length,1);
 f.returned();await f.advance(1000);assert.equal(f.posts.length,1);
});

for(const eventOrigin of [origin,'https://johnmusic.app.n8n.cloud'])test('valid '+eventOrigin+' success and passive return coalesce and require a server snapshot',async t=>{
 const f=setup(t);f.responses.push({connected:['YouTube']});f.click();f.returned();f.success('YouTube',f.clock.now(),eventOrigin);
 assert.equal(f.connected('YouTube'),false);assert.equal(f.posts.length,0);
 await f.advance(250);assert.equal(f.posts.length,1);assert.equal(f.connected('YouTube'),true);
 f.returned();await f.advance(1000);assert.equal(f.posts.length,1);
});

test('duplicate message and storage success hints share one check, including a later reconnect click',async t=>{
 const f=setup(t);f.click();f.returned();await f.advance(350);assert.equal(f.posts.length,1);
 const zeit=f.clock.now();f.responses.push({connected:['YouTube']});f.success('YouTube',zeit);
 f.storage({type:'sma-oauth-success',platform:'YouTube',zeit});f.success('YouTube',zeit);
 await f.advance(250);assert.equal(f.posts.length,2);assert.equal(f.connected('YouTube'),true);
 f.success('YouTube',zeit);f.storage({type:'sma-oauth-success',platform:'YouTube',zeit});await f.advance(5000);assert.equal(f.posts.length,2);
 f.click();f.success('YouTube',zeit);await f.advance(1000);assert.equal(f.posts.length,2,'replayed success does not gain a new budget after a click');
 f.returned();await f.advance(350);assert.equal(f.posts.length,3,'a new deliberate connection still gets its own return check');
});

test('wrong origin, type, platform, storage key and stale or invalid timestamps cannot authorize a check',async t=>{
 const f=setup(t);f.click();const now=f.clock.now();
 f.success('YouTube',now,'https://attacker.invalid');f.success('TikTok',now);f.success('Unknown',now);
 for(const zeit of [now-120001,now+120001,'not-a-date',Infinity])f.success('YouTube',zeit);
 f.message({data:{type:'not-oauth-success',platform:'YouTube',zeit:now}});
 f.storage('{invalid json');f.storage({type:'sma-oauth-success',platform:'YouTube',zeit:now},'unrelated');
 await f.advance(500);assert.equal(f.posts.length,0);
 f.returned();await f.advance(350);assert.equal(f.posts.length,1,'invalid hints did not consume the real return');
});

for(const offset of [-120000,120000])test('the existing 120-second success freshness boundary remains valid: '+offset,async t=>{
 const f=setup(t);f.click();f.success('YouTube',f.clock.now()+offset);await f.advance(250);assert.equal(f.posts.length,1);
});

test('a fresh response for a different customer never replaces lists, counts or input',async t=>{
 const f=setup(t),before=f.query('#page-social .platform-list').innerHTML,input=f.query('#unsaved');
 f.responses.push({customerId:otherCustomer,connected:['YouTube']});f.click();f.returned();await f.advance(350);
 assert.equal(f.posts.length,1);assert.equal(f.query('#page-social .platform-list').innerHTML,before);
 assert.equal(f.query('[data-sma-social-count]').textContent,'0');assert.equal(f.query('#unsaved'),input);assert.equal(f.applied,0);
 f.returned();await f.advance(5000);assert.equal(f.posts.length,1);
});

for(const nextPlatform of ['YouTube','TikTok'])test('a new '+nextPlatform+' click during an old read discards the old response and performs one queued check',async t=>{
 const f=setup(t);f.responses.push({hold:true,connected:['YouTube'],revision:'old'});f.click();f.returned();await f.advance(350);
 assert.equal(f.posts.length,1);f.responses.push({hold:true,connected:[nextPlatform],revision:'new'});
 f.click(nextPlatform);f.returned();f.focus();await f.advance(350);assert.equal(f.posts.length,1);
 await f.release(0);assert.equal(f.posts.length,2);assert.equal(f.applied,0,'old generation must not touch the DOM');
 assert.equal(f.query('.sma-oauth-status-check').dataset.smaPlatform,nextPlatform);
 await f.release(1);assert.equal(f.applied,1);assert.equal(f.connected(nextPlatform),true);
 assert.equal(f.query('#page-social .platform-card').dataset.fixtureRevision,'new');
 f.returned();await f.advance(1000);assert.equal(f.posts.length,2);
});

test('late success during a running return is not lost and multiple hints authorize at most one follow-up',async t=>{
 const f=setup(t,{connected:['YouTube']});f.responses.push({hold:true,connected:['YouTube'],revision:'pre-success'});
 f.click();f.returned();await f.advance(350);assert.equal(f.posts.length,1);
 f.responses.push({hold:true,connected:['YouTube'],revision:'post-success'});
 f.success();f.storage({type:'sma-oauth-success',platform:'YouTube',zeit:f.clock.now()});await f.advance(250);
 f.success('YouTube',f.clock.now());await f.advance(250);assert.equal(f.posts.length,1);
 await f.release(0);assert.equal(f.posts.length,2);assert.equal(f.applied,0);
 await f.release(1);assert.equal(f.applied,1);assert.equal(f.query('#page-social .platform-card').dataset.fixtureRevision,'post-success');
 await f.advance(5000);assert.equal(f.posts.length,2);
});

test('a superseded scheduled callback cannot consume or overwrite the next attempt',async t=>{
 const f=setup(t);f.click();f.returned();const stale=[...f.clock.callbacks.values()].at(-1);
 f.click('TikTok');stale();await settle();assert.equal(f.posts.length,0);
 f.returned();await f.advance(350);assert.equal(f.posts.length,1);assert.equal(f.query('.sma-oauth-status-check').dataset.smaPlatform,'TikTok');
});

test('pagehide cancels old timers and ignores a late response from the removed frame',async t=>{
 const scheduled=setup(t);scheduled.click();scheduled.returned();const stale=[...scheduled.clock.callbacks.values()].at(-1);
 scheduled.hide();stale();await scheduled.advance(1000);assert.equal(scheduled.posts.length,0);
 scheduled.returned();scheduled.success();await scheduled.advance(1000);assert.equal(scheduled.posts.length,0);
 const running=setup(t);running.responses.push({hold:true,connected:['YouTube']});running.click();running.returned();await running.advance(350);
 running.hide();await running.release();assert.equal(running.posts.length,1);assert.equal(running.applied,0);assert.equal(running.connected('YouTube'),false);
});

test('changing the visible customer invalidates queued timers and later hints before another POST',async t=>{
 const f=setup(t);f.click();f.returned();f.query('.app').dataset.smaCustomerId=otherCustomer;
 await f.advance(350);assert.equal(f.posts.length,0);f.success();f.returned();f.manual();await f.advance(1000);assert.equal(f.posts.length,0);
});

test('the real parent wrapper discards a late old-owner response and logout cancels a stalled read',async t=>{
 const switched=setup(t);switched.responses.push({hold:true,connected:['YouTube']});switched.click();switched.returned();await switched.advance(350);
 switched.owner(otherOwner);await switched.release();assert.equal(switched.applied,0);assert.equal(switched.connected('YouTube'),false);
 assert.deepEqual(switched.redirects,['index.html']);assert.equal(switched.posts.length,1);
 const logout=setup(t);logout.responses.push({hold:true,connected:['YouTube']});logout.click();logout.returned();await logout.advance(350);
 logout.logout();await settle();assert.equal(logout.posts[0].options.signal.aborted,true);
 await logout.release();logout.returned();await logout.advance(1000);assert.equal(logout.posts.length,1);assert.equal(logout.applied,0);
});

test('the real 45-second parent deadline releases the manual check without blind retry; old HTTP settlement is ignored',async t=>{
 const f=setup(t);f.responses.push({hold:true,connected:['YouTube'],revision:'late'});f.click();f.returned();await f.advance(350);
 await f.advance(45000);assert.equal(f.posts.length,1);assert.equal(f.posts[0].options.signal.aborted,true);
 assert.equal(f.query('.sma-oauth-status-check').disabled,false);assert.match(f.query('.sma-oauth-status-message').textContent,/nicht geprüft/);
 f.returned();await f.advance(5000);assert.equal(f.posts.length,1);
 f.responses.push({connected:['TikTok'],revision:'explicit'});f.manual();await f.advance(0);assert.equal(f.posts.length,2);
 await f.release(0);assert.equal(f.applied,1);assert.equal(f.connected('YouTube'),false);assert.equal(f.connected('TikTok'),true);
});

test('logout during an unabortable session read sends no dashboard POST even after that session resolves',async t=>{
 const f=setup(t);f.holdSession();f.click();f.returned();await f.advance(350);assert.equal(f.posts.length,0);
 f.logout();await f.releaseSession();f.returned();await f.advance(50000);assert.equal(f.posts.length,0);assert.equal(f.applied,0);
});

test('BFCache pauses a scheduled return without automatic reads and restores the explicit controls',async t=>{
 for(const scheduled of [false,true]){
  const f=setup(t);f.click();if(scheduled)f.returned();const stale=[...f.clock.callbacks.values()].at(-1);
  const button=f.query('.sma-oauth-status-check');f.hide(true);await f.advance(1000);assert.equal(f.posts.length,0);
  f.show();stale?.();f.returned();await f.advance(1000);assert.equal(f.posts.length,0);
  assert.equal(f.query('.sma-oauth-status-check'),button);assert.equal(button.disabled,false);assert.equal(button.closest('[hidden]'),null);
  f.manual();await f.advance(0);assert.equal(f.posts.length,1);
  f.click('TikTok');f.returned();await f.advance(350);assert.equal(f.posts.length,2);
  f.query('.app').dataset.smaCustomerId=otherCustomer;f.manual();f.returned();await f.advance(1000);assert.equal(f.posts.length,2);
 }
});

test('BFCache keeps an old in-flight read single, discards its result, and permits a later manual check',async t=>{
 const f=setup(t),input=f.query('#unsaved');f.responses.push({hold:true,connected:['YouTube'],revision:'before-cache'});
 f.click();f.returned();await f.advance(350);assert.equal(f.posts.length,1);
 f.hide(true);f.show();f.returned();f.manual();await f.advance(1000);assert.equal(f.posts.length,1,'restoring the page must not overlap the old read');
 await f.release(0);assert.equal(f.applied,0);assert.equal(f.connected('YouTube'),false);
 assert.equal(f.query('.sma-oauth-status-check').disabled,false);await f.advance(1000);assert.equal(f.posts.length,1);
 f.responses.push({connected:['YouTube'],revision:'after-cache'});f.manual();await f.advance(0);
 assert.equal(f.posts.length,2);assert.equal(f.applied,1);assert.equal(f.connected('YouTube'),true);
 assert.equal(f.query('#unsaved'),input);assert.equal(input.value,'Noch nicht gespeicherter Text');
});
