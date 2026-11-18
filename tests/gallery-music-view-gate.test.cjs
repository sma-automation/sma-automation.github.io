const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

async function gateFixture(){
 const {createMusicViewGate}=await import('../app/assets/gallery-music-view-gate.mjs');
 const outerListeners=new Map(),innerListeners=new Map();
 const doc=(events)=>({
  hidden:false,
  addEventListener:(event,fn)=>events.set(event,fn),
  removeEventListener:(event,fn)=>{if(events.get(event)===fn)events.delete(event);}
 });
 const outer=doc(outerListeners),inner=doc(innerListeners);
 let active=false,chapter='portals',optimizing=false,observed=null,observerDisconnected=false,mutate;
 class Observer{
  constructor(fn){mutate=fn;}
  observe(node,options){observed={node,options};}
  disconnect(){observerDisconnected=true;}
 }
 const root={ownerDocument:{defaultView:{MutationObserver:Observer}}};
 const visible=()=>!outer.hidden&&!inner.hidden&&active&&(chapter==='files'||optimizing);
 const gate=createMusicViewGate({root,documents:[outer,inner],visible});
 return {
  gate,root,outer,inner,outerListeners,innerListeners,
  setActive:value=>{active=value;},setChapter:value=>{chapter=value;},
  setOptimizer:value=>{optimizing=value;},
  mutate:()=>mutate?.(),
  observed:()=>observed,
  observerDisconnected:()=>observerDisconnected
 };
}

test('gallery visibility is event-driven and ignores unrelated DOM mutations',async()=>{
 const f=await gateFixture(),states=[];
 const stop=f.gate.subscribeVisibility(()=>states.push(f.gate.isVisible()));
 assert.equal(f.gate.isVisible(),false);
 assert.deepEqual(f.observed().options.attributeFilter,['hidden','class','style']);
 assert.equal(f.observed().options.childList,true);
 f.mutate();f.mutate();assert.equal(states.length,0);
 f.setActive(true);f.setChapter('files');f.mutate();
 assert.deepEqual(states,[true]);
 f.mutate();assert.equal(states.length,1,'unrelated DOM writes must not re-trigger a claim');
 f.setChapter('portals');f.mutate();assert.deepEqual(states,[true,false]);
 f.setOptimizer(true);f.mutate();assert.deepEqual(states,[true,false,true]);
 f.outer.hidden=true;f.outerListeners.get('visibilitychange')();
 assert.deepEqual(states,[true,false,true,false]);
 f.outer.hidden=false;f.outerListeners.get('visibilitychange')();
 assert.deepEqual(states,[true,false,true,false,true]);
 stop();assert.equal(f.observerDisconnected(),true);
 assert.equal(f.outerListeners.size,0);assert.equal(f.innerListeners.size,0);
 f.setActive(false);f.mutate();assert.equal(states.length,5);
});

test('worker does not claim a music job outside the visible publishing chapter',async()=>{
 const f=await gateFixture();
 const {createGalleryMusicWorker}=await import('../app/assets/gallery-music-worker.mjs');
 const calls=[],timers=new Map();let seq=0;
 const worker=createGalleryMusicWorker({
  rpc:async action=>{calls.push(action);return {ok:true,state:'idle'};},
  source:()=>assert.fail('No eligible job'),loadTrack:()=>assert.fail('No track'),
  render:()=>assert.fail('No render'),upload:()=>assert.fail('No upload'),
  onComplete:()=>{},onStatus:()=>{},
  isVisible:f.gate.isVisible,subscribeVisibility:f.gate.subscribeVisibility,
  setTimer:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;},
  cancelTimer:id=>timers.delete(id)
 });
 try{
  await worker.wake();assert.deepEqual(calls,[]);
  f.setActive(true);f.setChapter('files');f.mutate();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['claim']);assert.equal(timers.size,1);
  f.mutate();assert.deepEqual(calls,['claim']);
  f.setChapter('portals');f.mutate();assert.equal(timers.size,0);
  await worker.wake();assert.deepEqual(calls,['claim']);
  f.setOptimizer(true);f.mutate();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['claim','claim']);
  f.setActive(false);f.mutate();assert.equal(timers.size,0);
 }finally{worker.destroy();}
 assert.equal(f.observerDisconnected(),true);
});

test('dashboard and standalone optimizer both reference the updated worker safely',()=>{
 const read=p=>fs.readFileSync(path.join(__dirname,'../',p),'utf8');
 const dashboard=read('app/dashboard.html');
 const worker=read('app/assets/gallery-music-worker.mjs');
 const standalone=read('app/assets/publication-preview.js');
 const page=read('app/publication-preview.html');
 assert.match(dashboard,/gallery-music-view-gate\.mjs\?v=1/);
 assert.match(dashboard,/gallery-music-worker\.mjs\?v=8/);
 assert.match(dashboard,/isVisible:musicGate\.isVisible/);
 assert.match(dashboard,/subscribeVisibility:notify=>musicGate\.subscribeVisibility/);
 assert.match(dashboard,/musicGate\.isVisible\(\)\&\&\(loading\|\|retryStep\|\|scanRunning\)/);
 assert.match(dashboard,/dashboardChapters\?\.controllers\.get\('publishing'\)\?\.selected==='files'/);
 assert.match(dashboard,/page\.classList\.contains\('sma-optimizing'\)/);
 assert.match(dashboard,/onComplete:\(\)=>load\(false,\{wakeMusicAfter:false\}\)/);
 assert.match(dashboard,/if\(!retryingCatalog&&!checkingStatus&&wakeMusicAfter\)wakeMusic\(\);/);
 assert.match(standalone,/gallery-music-worker\.mjs\?v=8/);
 assert.match(page,/publication-preview\.js\?v=111/);
 assert.match(worker,/isVisible,subscribeVisibility\}\)\{/);
});
