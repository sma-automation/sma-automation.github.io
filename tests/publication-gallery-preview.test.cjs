const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Replay the actual gallery renderer from the customer-facing page without
// network requests, an account session, a new file, or any provider posting.
const source=fs.readFileSync('app/assets/publication-preview.js','utf8');
const start=source.indexOf('function renderFilePicker(){');
const end=source.indexOf('function openFilePicker(trigger){',start);
assert.ok(start>0&&end>start);
const renderer=source.slice(start,end);

function gallery(wide){
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.className='';this.classes=new Set();
   this.classList={toggle:(s,v)=>v?this.classes.add(s):this.classes.delete(s)};
   this.attrs={};this.textContent='';this.hidden=false;this.disabled=false;this.value='';this.open=false;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  setAttribute(name,value){this.attrs[name]=value;}
  addEventListener(name,handler){(this.events??={})[name]=handler;}
 }
 const names=['fileSearch','workspaceFiles','filePickerList','filePickerCount',
  'filePicker','filePickerPages','filePageCount','filePrevious','fileNext'];
 const nodes=Object.fromEntries(names.map(n=>[n,new Element(n)]));
 const assets=[
  {id:'synthetic-video',name:'SMA_STUMMER_GALERIE_TEST_10S.mp4',media_kind:'video',mime_type:'video/mp4',size_bytes:1951847},
  {id:'synthetic-image',name:'Titelbild.png',media_kind:'image',mime_type:'image/png',size_bytes:60000}
 ];
 let observed=0;
 const ctx={
  document:{createElement:tag=>new Element(tag)},
  $:id=>{assert.ok(nodes[id],id);return nodes[id];},
  workspace:wide?{galleryVisible:()=>true}:null,
  assets,selectedAsset:{id:'synthetic-video'},selectedPortal:'youtube',filePickerPage:0,busy:false,
  describeFile:file=>({title:file.name.replace(/\\.mp4$/,'').replaceAll('_',' '),version:file.media_kind==='video'?'Video · 10 Sek.':'Bild'}),
  fileFitsPortal:file=>file.media_kind==='video',
  pickerThumbnails:{reset(){},observe(){observed++;}},
  requestFileSelection(){throw Error('Unexpected click in static gallery test');},
  names:{youtube:'YouTube'}
 };
 vm.runInNewContext(renderer+'\\nrenderFilePicker();',ctx);
 return {rows:nodes.filePickerList.children,observed,nodes};
}

test('wide gallery shows preview, title and variant, never Dateidetails beneath titles',()=>{
 const {rows,observed,nodes}=gallery(true);
 assert.equal(rows.length,2);assert.equal(observed,2);
 assert.equal(nodes.workspaceFiles.classes.has('has-files'),true);
 for(const row of rows){
  assert.equal(row.children.some(n=>n.tag==='details'),false);
  assert.equal(row.children.length,2);
  assert.equal(row.children[0].tag,'button');
  assert.equal(row.children[1].className,'gallery-caption');
  assert.equal(row.children[1].children[0].tag,'strong');
  assert.ok(row.children[1].children[0].textContent.length>3);
  assert.equal(row.children.some(n=>n.textContent==='Dateidetails'),false);
 }
 assert.equal(rows[0].children[0].attrs['aria-pressed'],'true');
 assert.match(rows[0].children[0].attrs['aria-label'],/Beitragsvorschau öffnen/);
 assert.equal(rows[1].children[0].disabled,true,'YouTube still requires a video');
});
test('legacy file picker retains file-details disclosure outside wide dashboard',()=>{
 const {rows}=gallery(false);
 assert.equal(rows.length,2);
 for(const row of rows){
  const details=row.children.find(n=>n.tag==='details');
  assert.ok(details);
  assert.equal(details.children[0].tag,'summary');
  assert.equal(details.children[0].textContent,'Dateidetails');
 }
});
