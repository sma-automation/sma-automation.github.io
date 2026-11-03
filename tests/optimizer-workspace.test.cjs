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
  querySelectorAll(tag){if(tag.startsWith(':scope'))return this.children.filter(n=>n.className==='checks'||n.className==='note'||n.className==='notice');return this.children.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)])}
  querySelector(sel){return sel==='.file-picker-body'?pickerBody:null}
  pause(){this.paused=true}
 }
 const el=(tag,id)=>{const node=new Element(tag);if(id)node.id=id;return node};
 const main=el('main'),body=el('body'),pickerBody=el('div'),searchLabel=el('label');
 body.append(main);
 const ids=['assetPanel','deviceBrowse','browseFiles','refreshFiles','filePicker','filePickerHelp','pickerRefresh','chooseGeneralTemplate','fileSearch','fileSwitchNotice','assetPreview','fileDetails','mediaPanel','magicPanel','sourcePanel','portalNote','result','resultFileActions','uploadPanel','portalStatus','magicActionsSource','magicActionsText','magicReplaceNotice','exampleFiles','sourceSummary','generate','loadLatest','language','resultHeading','save'];
 for(const id of ids)main.append(el('div',id));
 byId.get('filePicker').append(pickerBody);pickerBody.append(searchLabel,byId.get('fileSearch'),byId.get('fileSwitchNotice'));
 for(const id of ['pickerRefresh','chooseGeneralTemplate']){const parent=el('div');parent.append(byId.get(id));pickerBody.append(parent)}
 byId.get('assetPanel').append(byId.get('deviceBrowse'),byId.get('browseFiles'),byId.get('refreshFiles'),byId.get('magicPanel'));
 const languageField=el('div');languageField.append(byId.get('language'));byId.get('sourcePanel').append(languageField);
 const form=el('form');form.value='Noch nicht gespeicherte Kundeneingabe';byId.get('sourcePanel').append(form);
 for(const name of ['checks','note','notice']){const node=el('div');node.className=name;node.textContent='Pending verification';byId.get('result').append(node);}
 const video=el('video');byId.get('assetPreview').append(video);
 byId.get('result').hidden=true;
 const doc={body,createElement:t=>el(t),getElementById:id=>{const node=byId.get(id);let root=node;while(root?.parentElement)root=root.parentElement;return root===body?node:null},querySelector:s=>s==='main'?main:searchLabel};
 const ctx={};vm.runInNewContext(source+';this.create=createOptimizerWorkspace',ctx);
 let loads=0;const workspace=ctx.create(doc,'Instagram',()=>loads++);
 return {workspace,main,form,video,pickerBody,get:id=>byId.get(id),loads:()=>loads};
}
test('two-section editor retains original gallery, upload controls and form nodes',()=>{
 const p=setup();assert.equal(p.get('workspaceFiles').hidden,false);assert.equal(p.get('workspaceSource').hidden,true);
 assert.equal(p.pickerBody.parentElement,p.get('workspaceFiles'));assert.equal(p.get('filePicker').hidden,true);
 assert.deepEqual(p.get('optimizerToolbar').children.map(n=>n.textContent),['Datei','Inhalt und Ziel']);
 assert.equal(p.get('deviceBrowse').parentElement,p.get('workspaceGalleryActions'));
 assert.equal(p.get('refreshFiles').parentElement,p.get('workspaceGalleryActions'));
 assert.equal(p.get('magicActionsSource').hidden,true);assert.equal(p.get('magicActionsText').hidden,false);
 assert.equal(p.get('assetPanel').hidden,true);assert.equal(p.get('resultFileActions').hidden,true);
 assert.equal(p.get('exampleFiles').hidden,true);assert.equal(p.get('workspaceContinue').disabled,true);
});
test('combined content and text preserve edits, disclosure state and original language control',()=>{
 const p=setup();p.workspace.selection({id:'own',name:'Mein Video',media_kind:'video'});
 p.get('workspaceTab-source').click();assert.equal(p.get('sourcePanel').open,false);
 p.get('sourcePanel').open=true;p.form.value='Überarbeitete eigene Angaben';
 p.get('workspaceChangeFile').click();assert.equal(p.workspace.galleryVisible(),true);assert.equal(p.loads(),1);
 p.get('workspaceContinue').click();assert.equal(p.get('workspaceSource').hidden,false);
 p.workspace.show('text');assert.equal(p.get('workspaceTab-source').attrs['aria-pressed'],'true');
 assert.equal(p.get('sourcePanel').open,true);assert.equal(p.form.value,'Überarbeitete eigene Angaben');
 assert.ok(p.get('sourcePanel').children.includes(p.form));
 assert.equal(p.get('language').attrs.form,'previewForm');assert.equal(p.get('language').parentElement.parentElement,p.get('workspaceTextHeader'));
 assert.equal(p.get('workspaceSelectedName').textContent,'Mein Video');
});
test('text completion and clearing switch placeholders without moving the edit form',()=>{
 const p=setup();p.workspace.show('text');assert.equal(p.get('workspaceTextEmpty').hidden,false);
 p.get('result').hidden=false;p.workspace.textAvailable(true);assert.equal(p.get('workspaceTextEmpty').hidden,true);
 p.workspace.show('files');p.workspace.show('text');assert.equal(p.get('workspaceTextEmpty').hidden,true);
 p.get('result').hidden=true;p.workspace.textAvailable(false);assert.equal(p.get('workspaceTextEmpty').hidden,false);
 assert.equal(p.get('result').parentElement,p.get('workspaceText'));
});
test('media checks remain accessible and videos pause when leaving the gallery',()=>{
 const p=setup();p.workspace.selection({id:'own',name:'Video.mp4',media_kind:'video'});
 assert.equal(p.get('workspaceSelectedPreview').hidden,false);assert.equal(p.get('workspaceSelectedPreview').open,false);
 assert.equal(p.get('mediaPanel').parentElement,p.get('workspaceSelectedPreview'));
 const notes=p.get('workspaceResultDetails').children.filter(n=>n.textContent==='Pending verification');assert.equal(notes.length,3);
 p.video.paused=false;p.get('workspaceTab-source').click();assert.equal(p.video.paused,true);
 p.workspace.selection(null);assert.equal(p.get('workspaceSelectedPreview').hidden,true);assert.equal(p.get('workspaceContinue').disabled,true);
 assert.equal(p.get('workspaceSelectedName').textContent,'Noch keine Datei ausgewählt');assert.equal(p.get('workspaceSelectedKind').textContent,'');
});
test('legacy folder and text actions use the two existing sections without starting work',()=>{
 const p=setup();p.workspace.show('text');p.workspace.show('folder');
 assert.equal(p.workspace.galleryVisible(),true);assert.equal(p.get('workspaceSearch').open,true);assert.equal(p.loads(),1);
 assert.equal(p.get('workspaceTab-files').attrs['aria-pressed'],'true');
 p.workspace.show('media');p.workspace.show('examples');assert.equal(p.workspace.galleryVisible(),true);
 assert.equal(p.get('exampleFiles').hidden,true);assert.equal(p.loads(),1);
});
