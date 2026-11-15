const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const html=fs.readFileSync('app/dashboard.html','utf8');
const code=html.slice(html.indexOf('let optimizerFrames='),html.indexOf('// Extend the existing portal cards'));
function setup(){
 const events={},stack=[null];let index=0;
 const history={state:null,pushState(state){stack.splice(++index);stack.push(state);this.state=state;},replaceState(state){stack[index]=this.state=state;},back(){if(index>0)this.state=stack[--index];events.popstate({state:this.state});},forward(){if(index+1<stack.length)this.state=stack[++index];events.popstate({state:this.state});}};
 const doc={createElement:tag=>new Element(tag),head:{append(){}}};
 class Element{constructor(tag){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.events={};this.hidden=false;this.classes=new Set();this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v)};}setAttribute(k,v){this[k]=v}append(...e){this.children.push(...e)}replaceChildren(...e){this.children=e}addEventListener(k,f){this.events[k]=f}focus(){this.focused=true}scrollIntoView(){this.scrolled=true}}
 const observed=new Set();
 let resize;
 class ResizeObserver{constructor(callback){resize=callback;}observe(el){observed.add(el);}disconnect(){observed.clear();}}
 const context={crypto:require('node:crypto').webcrypto,ResizeObserver,window:{addEventListener:(name,fn)=>events[name]=fn,location:{href:'https://sma-automation.com/app/dashboard.html'}},history,location:{pathname:'/app/dashboard.html',search:''},URL,portalNames:{instagram:'Instagram',youtube:'YouTube'},api:null};
 vm.runInNewContext(code+';api={attachOptimizerPage,openSearchFile,openOptimizer,closeOptimizer,clearOptimizer,optimizerWorkspaceView,select(id){selectedFileId=id},view(){return {optimizerFrames,optimizerPage,optimizerHeader,publishingPage}}};',context);
 const page=new Element('section'),original=new Element('div');page.append(original);context.api.attachOptimizerPage(doc,page);return {...context.api,history,page,original,observed,resize,trigger:new Element('button')};
}
test('Optimieren replaces the publishing content with a full page while retaining the dashboard shell',()=>{
 const p=setup();p.select('own-asset');p.openOptimizer('instagram',p.trigger);const v=p.view();
 assert.equal(v.optimizerPage.hidden,false);assert.equal(p.original.classes.has('sma-publishing-hidden'),true);assert.equal(p.page.children.includes(v.optimizerPage),true);
 const url=new URL(v.optimizerFrames.children[0].src);assert.equal(url.searchParams.get('wide'),'1');assert.equal(url.searchParams.get('asset'),'own-asset');assert.equal(url.searchParams.get('portal'),'instagram');assert.equal(p.history.state.smaOptimization,true);
});
test('back and forward restore the same editor frame instead of discarding edits or uploads',()=>{
 const p=setup();p.openOptimizer('instagram',p.trigger);const frame=p.view().optimizerFrames.children[0];frame.unsaved='customer draft';
 p.closeOptimizer();assert.equal(p.view().optimizerPage.hidden,true);assert.equal(p.original.classes.has('sma-publishing-hidden'),false);assert.equal(p.trigger.focused,true);
 p.history.forward();assert.equal(p.view().optimizerPage.hidden,false);assert.equal(p.view().optimizerFrames.children[0],frame);assert.equal(frame.unsaved,'customer draft');
 p.closeOptimizer();p.openOptimizer('instagram',p.trigger);assert.equal(p.view().optimizerFrames.children.length,1);
});
test('different portals retain separate editor frames and logout clears all of them',()=>{
 const p=setup();p.openOptimizer('instagram',p.trigger);p.closeOptimizer();p.openOptimizer('youtube',p.trigger);let frames=p.view().optimizerFrames.children;assert.equal(frames.length,2);assert.equal(frames[0].hidden,true);assert.equal(frames[1].hidden,false);
 p.clearOptimizer();assert.equal(p.view().optimizerFrames.children.length,0);assert.equal(p.history.state,null);assert.equal(p.view().optimizerPage.hidden,true);
});
test('post preview has its own history entry and browser back restores the same editor',()=>{
 const p=setup();p.openOptimizer('instagram',p.trigger);const frame=p.view().optimizerFrames.children[0];const sent=[];frame.contentWindow={postMessage:m=>sent.push(m)};frame.unsaved='Eigene Angaben';
 p.optimizerWorkspaceView(frame,'preview');assert.equal(p.history.state.view,'preview');assert.equal(p.view().optimizerHeader.hidden,true);
 p.history.back();assert.equal(p.view().optimizerPage.hidden,false);assert.equal(p.view().optimizerHeader.hidden,false);assert.equal(sent.at(-1).view,'files');assert.equal(frame.unsaved,'Eigene Angaben');
 p.history.forward();assert.equal(sent.at(-1).view,'preview');assert.equal(p.view().optimizerHeader.hidden,true);
 p.optimizerWorkspaceView(frame,'files');assert.notEqual(p.history.state?.view,'preview');assert.equal(p.view().optimizerHeader.hidden,false);
});
test('hidden portal frames cannot navigate the active workspace',()=>{
 const p=setup();p.openOptimizer('instagram',p.trigger);const old=p.view().optimizerFrames.children[0];p.closeOptimizer();p.openOptimizer('youtube',p.trigger);
 p.optimizerWorkspaceView(old,'preview');assert.equal(p.history.state.portal,'youtube');assert.notEqual(p.history.state.view,'preview');assert.equal(p.view().optimizerHeader.hidden,false);
});
test('editing a post from the embedded preview keeps the requested editor and its focus',()=>{
 const p=setup();p.select('video');p.openOptimizer('youtube',p.trigger);
 const frame=p.view().optimizerFrames.children[0],sent=[];frame.contentWindow={postMessage:m=>sent.push(m.view)};
 p.optimizerWorkspaceView(frame,'preview');p.optimizerWorkspaceView(frame,'source');
 assert.equal(p.history.state.view,'source');assert.equal(p.view().optimizerHeader.hidden,false);
 assert.deepEqual(sent,[],'the iframe is already showing the focused editor');
 p.optimizerWorkspaceView(frame,'preview');p.history.back();
 assert.deepEqual(sent,['source']);p.history.forward();assert.equal(sent.at(-1),'preview');
 p.optimizerWorkspaceView(frame,'files');assert.equal(p.history.state.view,'files');
 p.closeOptimizer();assert.equal(p.view().optimizerPage.hidden,true);
});

test('restoring a preview that is no longer available keeps the same history entry on the gallery',()=>{
 const p=setup();p.openOptimizer('youtube',p.trigger);
 const frame=p.view().optimizerFrames.children[0];
 p.optimizerWorkspaceView(frame,'preview');
 p.history.back();p.history.forward();
 p.optimizerWorkspaceView(frame,'files',true);
 assert.equal(p.history.state.view,'files');assert.equal(p.view().optimizerHeader.hidden,false);
 assert.equal(frame.dataset.view,'files');
 p.history.back();
 assert.equal(p.history.state.smaOptimization,true,'failed restoration must not navigate back an extra entry');
});

test('only media in a hidden optimizer pauses, retaining the position and releasing detached frames',()=>{
 const p=setup();p.openOptimizer('youtube',p.trigger);
 const frame=p.view().optimizerFrames.children[0];
 const media={paused:false,currentTime:1.25,pause(){this.paused=true;}};
 frame.contentDocument={querySelectorAll(selector){assert.equal(selector,'video,audio');return [media];}};
 assert(p.observed.has(frame));
 p.resize([{target:frame,contentRect:{width:320,height:300}}]);assert.equal(media.paused,false);
 p.resize([{target:frame,contentRect:{width:0,height:0}}]);assert.equal(media.paused,true);
 p.resize([{target:frame,contentRect:{width:320,height:300}}]);assert.equal(media.paused,true);assert.equal(media.currentTime,1.25);
 p.clearOptimizer();assert.equal(p.observed.size,0);
});

test('opening a search result adds one history entry and keeps its query out of browser history',()=>{
 const p=setup();p.select('own-video');
 p.openSearchFile('youtube',p.trigger,{global:true,id:'own-video',query:'privater Suchbegriff'});
 const frame=p.view().optimizerFrames.children[0];
 assert.equal(new URL(frame.src).searchParams.get('fromSearch'),'1');
 const key=p.history.state.searchKey;assert.ok(key);assert.equal(p.history.state.view,'files');
 p.optimizerWorkspaceView(frame,'preview');assert.equal(p.history.state.view,'preview');
 assert(!JSON.stringify(p.history.state).includes('privater Suchbegriff'));
 p.history.back();assert.equal(p.history.state.smaSearchResults,key);assert.equal(p.view().optimizerPage.hidden,true);
 p.history.forward();assert.equal(p.history.state.view,'preview');assert.equal(p.view().optimizerFrames.children[0],frame);
});
