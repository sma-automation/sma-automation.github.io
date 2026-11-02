const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app/assets/optimizer-workspace.mjs','utf8').replace('export function','function');
function setup(){
 const byId=new Map();
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.hidden=false;this.classes=new Set();this.classList={add:n=>this.classes.add(n),toggle:(n,v)=>v?this.classes.add(n):this.classes.delete(n)};}
  set id(value){this._id=value;byId.set(value,this)}get id(){return this._id}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(n=>n!==node);node.parentElement=this;this.children.push(node)}}
  prepend(...nodes){this.append(...nodes);this.children=[...nodes,...this.children.filter(n=>!nodes.includes(n))]}
  setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}
  addEventListener(k,f){this.events[k]=f}click(){this.events.click?.()}
  querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)])}
  querySelector(sel){return sel==='.file-picker-body'?pickerBody:null}
  pause(){this.paused=true}
 }
 const el=(tag,id)=>{const node=new Element(tag);if(id)node.id=id;return node};
 const main=el('main'),body=el('body'),pickerBody=el('div'),searchLabel=el('label');
 body.append(main);
 const ids=['assetPanel','deviceBrowse','browseFiles','refreshFiles','filePicker','filePickerHelp','pickerRefresh','chooseGeneralTemplate','fileSearch','fileSwitchNotice','assetPreview','fileDetails','mediaPanel','magicPanel','sourcePanel','portalNote','result','resultFileActions','uploadPanel','portalStatus','magicActionsSource','magicActionsText','magicReplaceNotice','exampleFiles'];
 for(const id of ids)main.append(el('div',id));
 byId.get('filePicker').append(pickerBody);pickerBody.append(searchLabel,byId.get('fileSearch'),byId.get('fileSwitchNotice'));
 for(const id of ['pickerRefresh','chooseGeneralTemplate']){const parent=el('div');parent.append(byId.get(id));pickerBody.append(parent)}
 byId.get('assetPanel').append(byId.get('deviceBrowse'),byId.get('browseFiles'),byId.get('refreshFiles'),byId.get('magicPanel'));
 const form=el('form');form.value='Noch nicht gespeicherte Kundeneingabe';byId.get('sourcePanel').append(form);
 const video=el('video');byId.get('assetPreview').append(video);
 byId.get('result').hidden=true;
 const doc={body,createElement:t=>el(t),getElementById:id=>{const node=byId.get(id);let root=node;while(root?.parentElement)root=root.parentElement;return root===body?node:null},querySelector:s=>s==='main'?main:searchLabel};
 const ctx={};vm.runInNewContext(source+';this.create=createOptimizerWorkspace',ctx);
 let loads=0;const workspace=ctx.create(doc,'Instagram',()=>loads++);
 return {workspace,main,form,video,pickerBody,get:id=>byId.get(id),loads:()=>loads};
}
test('wide editor opens an inline gallery and keeps one copy of the existing native upload controls',()=>{
 const p=setup();assert.equal(p.get('workspaceFiles').hidden,false);assert.equal(p.get('workspaceMedia').hidden,true);assert.equal(p.get('workspaceText').hidden,true);
 assert.equal(p.pickerBody.parentElement,p.get('workspaceFiles'));assert.equal(p.get('filePicker').hidden,true);
 assert.deepEqual(p.get('optimizerToolbar').children.map(n=>n.id),['workspaceTab-files','deviceBrowse','browseFiles','refreshFiles','workspaceTab-media','workspaceTab-examples','workspaceTab-source','workspaceTab-text']);
 assert.equal(p.get('assetPanel').hidden,true);assert.equal(p.get('resultFileActions').hidden,true);
});
test('section switches preserve form nodes, edits and selected media, and never generate or upload',()=>{
 const p=setup();p.workspace.selection({id:'own'});p.get('workspaceTab-source').click();assert.equal(p.get('sourcePanel').open,true);assert.equal(p.form.value,'Noch nicht gespeicherte Kundeneingabe');
 p.form.value='Überarbeitete eigene Angaben';p.get('workspaceTab-text').click();assert.equal(p.get('workspaceText').hidden,false);assert.equal(p.get('workspaceTextEmpty').hidden,false);
 p.get('result').hidden=false;p.workspace.textAvailable(true);assert.equal(p.get('workspaceTextEmpty').hidden,true);
 p.workspace.show('folder');assert.equal(p.get('workspaceFiles').hidden,false);assert.equal(p.get('workspaceSearch').hidden,false);assert.equal(p.loads(),1);
 p.get('workspaceTab-files').click();assert.equal(p.get('workspaceSearch').hidden,true);assert.equal(p.get('workspaceTab-files').attrs['aria-pressed'],'true');assert.equal(p.loads(),2);
 p.get('workspaceTab-source').click();assert.equal(p.form.value,'Überarbeitete eigene Angaben');assert.equal(p.get('sourcePanel').children[0],p.form);
});
test('media view opens checks and pauses a video when switching away; clearing selection hides preview',()=>{
 const p=setup();p.workspace.selection({id:'own'});p.get('workspaceTab-media').click();assert.equal(p.get('mediaPanel').open,true);assert.equal(p.get('workspaceSelectedPreview').hidden,false);
 p.video.paused=false;p.get('workspaceTab-files').click();assert.equal(p.video.paused,true);
 p.workspace.selection(null);assert.equal(p.get('workspaceSelectedPreview').hidden,true);p.workspace.show('unknown');assert.equal(p.workspace.galleryVisible(),true);
});
test('example gallery stays separate from customer files and preserves the edited content',()=>{
 const p=setup();p.workspace.selection({id:'own'});p.form.value='Eigene Angaben';
 p.get('workspaceTab-examples').click();
 assert.equal(p.get('exampleFiles').hidden,false);assert.equal(p.get('workspaceFiles').hidden,true);
 assert.equal(p.get('workspaceStatus').hidden,true);assert.equal(p.workspace.galleryVisible(),false);
 assert.equal(p.loads(),0);assert.equal(p.form.value,'Eigene Angaben');
 p.get('workspaceTab-media').click();assert.equal(p.get('workspaceSelectedPreview').hidden,false);
 p.get('workspaceTab-files').click();assert.equal(p.get('exampleFiles').hidden,true);
 assert.equal(p.get('workspaceStatus').hidden,false);assert.equal(p.loads(),1);
});
