const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const html=fs.readFileSync('app/dashboard.html','utf8');
const code=html.slice(html.indexOf('let optimizerFrames='),html.indexOf('// Extend the existing portal cards'));
function setup(){
 const events={},stack=[null];let index=0;
 const history={state:null,pushState(state){stack.splice(++index);stack.push(state);this.state=state;},replaceState(state){stack[index]=this.state=state;},back(){if(index>0)this.state=stack[--index];events.popstate({state:this.state});},forward(){if(index+1<stack.length)this.state=stack[++index];events.popstate({state:this.state});}};
 const doc={createElement:tag=>new Element(tag),head:{append(){}}};
 class Element{constructor(tag){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.events={};this.hidden=false;this.classes=new Set();this.classList={add:v=>this.classes.add(v),remove:v=>this.classes.delete(v)};}setAttribute(k,v){this[k]=v}append(...e){this.children.push(...e)}replaceChildren(...e){this.children=e}addEventListener(k,f){this.events[k]=f}focus(){this.focused=true}scrollIntoView(){this.scrolled=true}}
 const context={window:{addEventListener:(name,fn)=>events[name]=fn,location:{href:'https://sma-automation.com/app/dashboard.html'}},history,location:{pathname:'/app/dashboard.html',search:''},URL,portalNames:{instagram:'Instagram',youtube:'YouTube'},api:null};
 vm.runInNewContext(code+';api={attachOptimizerPage,openOptimizer,closeOptimizer,clearOptimizer,select(id){selectedFileId=id},view(){return {optimizerFrames,optimizerPage,publishingPage}}};',context);
 const page=new Element('section'),original=new Element('div');page.append(original);context.api.attachOptimizerPage(doc,page);return {...context.api,history,page,original,trigger:new Element('button')};
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
