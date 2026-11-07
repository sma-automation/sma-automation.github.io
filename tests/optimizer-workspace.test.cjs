const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app/assets/publication-destination.mjs','utf8').replace('export function','function')+fs.readFileSync('app/assets/optimizer-workspace.mjs','utf8').replace(/^import .*;$/gm,'').replace('export function','function');
function setup(previewData={}){
 const byId=new Map();
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.dataset={};this.hidden=false;this.classes=new Set();this.style={setProperty(k,v){this[k]=v},removeProperty(k){delete this[k]}};this.classList={contains:n=>this.classes.has(n),add:n=>this.classes.add(n),toggle:(n,v)=>v?this.classes.add(n):this.classes.delete(n)};}
  set id(value){this._id=value;byId.set(value,this)}get id(){return this._id}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(n=>n!==node);node.parentElement=this;this.children.push(node)}}
  prepend(...nodes){this.append(...nodes);this.children=[...nodes,...this.children.filter(n=>!nodes.includes(n))]}
  setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}
  addEventListener(k,f){this.events[k]=f}click(){this.events.click?.()}
  querySelectorAll(tag){if(tag.startsWith(':scope'))return this.children.filter(n=>n.className==='checks'||n.className==='note'||n.className==='notice');return this.children.flatMap(n=>[...(n.tag===tag?[n]:[]),...n.querySelectorAll(tag)])}
  querySelector(sel){return sel==='.file-picker-body'?pickerBody:null}
  focus(){this.focused=true}
  replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes)}
  pause(){this.paused=true}
 }
 const el=(tag,id)=>{const node=new Element(tag);if(id)node.id=id;return node};
 const main=el('main'),body=el('body'),pickerBody=el('div'),searchLabel=el('label');
 body.append(main);const header=el('header');header.append(el('a','back'));main.append(header);
 const ids=['assetPanel','deviceBrowse','browseFiles','refreshFiles','filePicker','filePickerHelp','pickerRefresh','chooseGeneralTemplate','fileSearch','fileSwitchNotice','assetPreview','fileDetails','mediaPanel','magicPanel','sourcePanel','catalogLookup','portalNote','result','resultFileActions','uploadPanel','portalStatus','magicActionsSource','magicActionsText','magicReplaceNotice','exampleFiles','sourceSummary','generate','loadLatest','language','resultHeading','save'];
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
 let loads=0;const workspace=ctx.create(doc,'Instagram',()=>loads++,{getPreview:()=>previewData});
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
 assert.equal(p.get('exampleFiles').hidden,true);assert.equal(p.get('workspaceViewFile').disabled,true);
});
test('combined content and text preserve edits, disclosure state and original language control',()=>{
 const p=setup();p.workspace.selection({id:'own',name:'Mein Video',media_kind:'video'});
 p.get('workspaceTab-source').click();assert.equal(p.get('sourcePanel').open,false);
 p.get('sourcePanel').open=true;p.form.value='Überarbeitete eigene Angaben';
 p.get('workspaceTab-files').click();assert.equal(p.workspace.galleryVisible(),true);assert.equal(p.loads(),1);
 p.get('workspaceViewFile').click();assert.equal(p.get('workspacePreview').hidden,false);
 p.get('workspacePreviewBack').click();p.get('workspaceTab-source').click();assert.equal(p.get('workspaceSource').hidden,false);
 p.workspace.show('text');assert.equal(p.get('workspaceTab-source').attrs['aria-pressed'],'true');
 assert.equal(p.get('sourcePanel').open,true);assert.equal(p.form.value,'Überarbeitete eigene Angaben');
 assert.ok(p.get('sourcePanel').children.includes(p.form));
 assert.equal(p.get('catalogLookup').parentElement,p.get('workspaceEditor'));
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
 p.get('workspaceViewFile').click();assert.equal(p.get('workspacePreview').hidden,false);
 assert.equal(p.get('mediaPanel').parentElement,p.get('workspaceDetailView'));
 const notes=p.get('workspaceResultDetails').children.filter(n=>n.textContent==='Pending verification');assert.equal(notes.length,3);
 p.video.paused=false;p.get('workspaceTab-source').click();assert.equal(p.video.paused,true);
 p.workspace.selection(null);assert.equal(p.get('workspacePreview').hidden,true);assert.equal(p.get('workspaceViewFile').disabled,true);
 assert.equal(p.get('workspaceSelectedName').textContent,'Noch keine Datei ausgewählt');assert.equal(p.get('workspaceSelectedKind').textContent,'');
});
test('legacy folder and text actions use the two existing sections without starting work',()=>{
 const p=setup();p.workspace.show('text');p.workspace.show('folder');
 assert.equal(p.workspace.galleryVisible(),true);assert.equal(p.get('workspaceSearch').open,true);assert.equal(p.loads(),1);
 assert.equal(p.get('workspaceTab-files').attrs['aria-pressed'],'true');
 p.workspace.show('media');p.workspace.show('examples');assert.equal(p.workspace.galleryVisible(),true);
 assert.equal(p.get('exampleFiles').hidden,true);assert.equal(p.loads(),1);
});
test('post preview replaces the editor, retains the real media and shows current text safely',()=>{
 const data={draft:{title:'Aktueller Titel',body:'Noch nicht gespeicherter Text <script>nein</script>',hashtags:['Details'],shop_url:'https://sma-automation.com/app/shop.html?shop=mein-shop',review_notes:['Angabe prüfen']},source:'Gesicherte Quelle',facts:{width_px:1920,height_px:1080,size_bytes:1230000,duration_ms:20000},draftStatus:'Ungespeichert'};
 const p=setup(data);p.workspace.selection({name:'Eigenes Video.mp4',media_kind:'video'});p.get('workspaceViewFile').click();
 assert.equal(p.get('workspaceFiles').hidden,true);assert.equal(p.get('workspaceSource').hidden,true);assert.equal(p.get('optimizerToolbar').hidden,true);
 assert.equal(p.get('assetPreview').parentElement,p.get('workspacePost'));
 assert.equal(p.get('workspacePostTitle').textContent,data.draft.title);assert.equal(p.get('workspacePostCaption').textContent,data.draft.body);
 assert.equal(p.get('workspacePostShop').href,data.draft.shop_url);assert.equal(p.get('workspacePreviewNotes').children[0].textContent,'Angabe prüfen');
 p.get('workspaceDetailTab').click();assert.equal(p.get('workspacePostView').hidden,true);assert.equal(p.get('workspaceDetailView').hidden,false);assert.equal(p.video.paused,true);
 assert.ok(p.get('workspacePreviewFacts').children.some(n=>n.textContent==='1920 × 1080 Pixel'));
 p.get('workspacePreviewBack').click();assert.equal(p.get('workspaceFiles').hidden,false);assert.equal(p.get('optimizerToolbar').hidden,false);
 assert.equal(p.get('workspaceViewFile').focused,true);assert.equal(p.get('workspaceChangeFile'),undefined);
});
test('clearing or changing selected files clears the separate preview and cannot retain a foreign link',()=>{
 const p=setup({draft:{title:'Vorheriger Entwurf',body:'Vorheriger Text',shop_url:'javascript:alert(1)'}});
 p.workspace.show('preview');assert.equal(p.get('workspacePreview').hidden,true);
 p.workspace.selection({name:'Datei.mp4',media_kind:'video'});p.get('workspaceViewFile').click();
 assert.equal(p.get('workspacePostShop').hidden,true);assert.equal(p.get('workspacePostShop').attrs.href,undefined);
 p.get('workspacePreviewBack').click();p.workspace.selection(null);
 for(const id of ['workspacePostTitle','workspacePostCaption','workspacePreviewSource','workspacePreviewName'])assert.equal(p.get(id).textContent,'');
 assert.equal(p.get('workspaceViewFile').disabled,true);assert.equal(p.get('workspacePreviewFacts').children.length,0);
});

test('standalone preview groups its navigation and resets the media format on selection changes',()=>{
 const p=setup(),back=p.get('back'),header=back.parentElement;
 p.workspace.selection({name:'Hochformat.mp4',media_kind:'video',width_px:720,height_px:1280});
 p.get('workspaceViewFile').click();
 assert.equal(back.parentElement,p.get('workspacePreviewNav'));
 assert.equal(p.get('workspacePost').dataset.orientation,'portrait');
 assert.equal(p.get('workspacePost').style['--media-aspect'],'720 / 1280');
 p.get('workspacePreviewBack').click();assert.equal(back.parentElement,header);
 p.workspace.selection({name:'Weitere Datei.mp4',media_kind:'video'});
 p.get('workspaceViewFile').click();
 assert.equal(p.get('workspacePost').dataset.orientation,'');
 assert.equal(p.get('workspacePost').style['--media-aspect'],undefined);
});

test('a bound product uses its direct link in the post and file details',()=>{
 const shop='https://sma-automation.com/app/shop.html?shop=fixture';
 const p=setup({draft:{shop_url:shop,product_id:'article-02'},language:'en'});
 p.workspace.selection({name:'Video.mp4',media_kind:'video'});
 p.get('workspaceViewFile').click();
 const target=shop+'&produkt=article-02';
 assert.equal(p.get('workspacePostShop').href,target);
 assert.equal(p.get('workspacePostShop').textContent,'View product: '+target);
 assert.ok(p.get('workspacePreviewFacts').children.some(node=>node.textContent===target));
});
