const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('status refresh replaces a consented preview with a terminal cancellation and reopening starts a new order',async()=>{
 const byId=new Map(),requests=[];
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.dataset={};this.hidden=false;this.disabled=false;this.checked=false;this.value='';}
  set id(value){this._id=value;byId.set(value,this)}get id(){return this._id}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node)}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes)}
  setAttribute(key,value){this.attrs[key]=value}
  addEventListener(name,fn){this.events[name]=fn}
  querySelectorAll(selector){const tags=selector.split(',');return this.children.flatMap(n=>[...(tags.includes(n.tag)?[n]:[]),...n.querySelectorAll(selector)])}
  reportValidity(){return this.querySelectorAll('select').every(e=>!e.required||e.value!=='')}
  showModal(){this.open=true}close(){this.open=false}
 }
 const doc={head:new Element('head'),body:new Element('body'),createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})};
 const binding={asset_id:'synthetic-asset',asset_revision:'revision:1',platform:'youtube',assignment_revision:1,preview_id:'synthetic-preview',preview_revision:1};
 let sequence=0,preparedId;
 const context={document:doc,AbortSignal,crypto:{randomUUID:()=>`fa660000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`},fetch:async(_url,options)=>{
  const b=JSON.parse(options.body);requests.push(b);
  const base={ok:true,id:b.input.id,can_upload:false,can_publish:false,target:{id:'synthetic-channel',platform:'youtube'},account_check:{target_id:'synthetic-channel',display_name:'Test channel'}};
  if(b.action==='account')return {ok:true,json:async()=>({...base,stage:'account'})};
  if(b.action==='prepare')preparedId=b.input.id;
  assert.ok(['prepare','get'].includes(b.action),'No approval request may leave the cancelled dialog');
  return {ok:true,json:async()=>({...base,binding,choices:{visibility:'private'},draft:{title:'Test',caption:'Synthetic text'},state:b.action==='get'?'cancelled':'prepared',approval_token:b.action==='get'?null:'synthetic-token',approved_at:null,blockers:[]})};
 }};
 const source=fs.readFileSync('app/assets/publication-order.mjs','utf8').replaceAll('export function','function');
 vm.runInNewContext(source+';this.install=installOrderReview;',context);
 context.install(doc,{host:doc.body,portalName:'YouTube',session:async()=>({access_token:'synthetic-session'}),getContext:()=>({binding,name:'Synthetic.mp4'}),refresh:async()=>{}});
 const dialog=byId.get('publicationOrderDialog'),form=dialog.children.find(e=>e.tag==='form');
 const open=byId.get('preparePublicationOrder'),buttons=dialog.querySelectorAll('button');
 const approve=buttons.find(e=>e.textContent==='Veröffentlichung freigeben'),status=buttons.find(e=>e.textContent==='Status erneut laden');
 const consent=dialog.querySelectorAll('input')[0],notice=dialog.children.find(e=>e.attrs.role==='status');
 const prepare=async()=>{
  byId.get('order-visibility').value='private';byId.get('order-made_for_kids').value='false';byId.get('order-contains_synthetic_media').value='false';
  await form.events.submit({preventDefault(){}});
 };
 await open.events.click();await prepare();
 const firstId=preparedId;
 assert.equal(consent.parentElement.hidden,false);assert.equal(approve.disabled,true);
 consent.checked=true;consent.events.change();assert.equal(approve.disabled,false);
 await status.events.click();
 assert.match(notice.textContent,/wurde storniert/);assert.equal(consent.checked,false);assert.equal(consent.parentElement.hidden,true);
 assert.equal(approve.hidden,true);assert.equal(approve.disabled,true);assert.equal(status.hidden,true);
 buttons.find(e=>e.textContent==='Schließen').events.click();assert.equal(dialog.open,false);
 await open.events.click();await prepare();
 assert.notEqual(preparedId,firstId);assert.equal(consent.checked,false);assert.equal(approve.disabled,true);assert.equal(status.hidden,false);
 assert.deepEqual(requests.map(r=>r.action),['account','prepare','get','account','prepare']);
});
