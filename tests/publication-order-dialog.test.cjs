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
  return {ok:true,json:async()=>({...base,binding,choices:{visibility:'private'},draft:{title:'Test',caption:'Synthetic text'},state:b.action==='get'?'cancelled':'prepared',approval_policy:'media-consent-2026-11-03.1',approval_token:b.action==='get'?null:'synthetic-token',approved_at:null,blockers:[]})};
 }};
 const source=fs.readFileSync('app/assets/publication-order.mjs','utf8').replaceAll('export function','function').replaceAll('export const','const');
 vm.runInNewContext(source+';this.install=installOrderReview;',context);
 context.install(doc,{host:doc.body,portalName:'YouTube',session:async()=>({access_token:'synthetic-session'}),getContext:()=>({binding,name:'Synthetic.mp4'}),refresh:async()=>{}});
 const dialog=byId.get('publicationOrderDialog'),form=dialog.children.find(e=>e.tag==='form');
 const open=byId.get('preparePublicationOrder'),buttons=dialog.querySelectorAll('button');
 const approve=buttons.find(e=>e.textContent==='Veröffentlichung freigeben'),status=buttons.find(e=>e.textContent==='Status erneut laden');
 const consent=byId.get('order-final-consent'),notice=dialog.children.find(e=>e.attrs.role==='status');
 const prepare=async()=>{
  byId.get('order-visibility').value='private';byId.get('order-made_for_kids').value='false';byId.get('order-contains_synthetic_media').value='false';
  await form.events.submit({preventDefault(){}});
 };
 await open.events.click();await prepare();
 const firstId=preparedId;
 assert.equal(consent.parentElement.hidden,false);assert.equal(approve.disabled,true);
 consent.checked=true;consent.events.change();assert.equal(approve.disabled,true);
 for(const key of ['content_checked','media_rights','music_rights']){const e=byId.get('order-review-'+key);e.checked=true;e.events.change();}
 assert.equal(approve.disabled,false);
 await status.events.click();
 assert.match(notice.textContent,/wurde storniert/);assert.equal(consent.checked,false);assert.equal(consent.parentElement.hidden,true);
 assert.equal(approve.hidden,true);assert.equal(approve.disabled,true);assert.equal(status.hidden,true);
 buttons.find(e=>e.textContent==='Schließen').events.click();assert.equal(dialog.open,false);
 await open.events.click();await prepare();
 assert.notEqual(preparedId,firstId);assert.equal(consent.checked,false);assert.equal(approve.disabled,true);assert.equal(status.hidden,false);
 assert.deepEqual(requests.map(r=>r.action),['account','prepare','get','account','prepare']);
});

function tiktokDialog({checkError=null}={}) {
 const byId=new Map(),requests=[];
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.dataset={};this.hidden=false;this.disabled=false;this.checked=false;this.value='';}
  set id(v){this._id=v;byId.set(v,this)}get id(){return this._id}
  append(...nodes){for(const n of nodes){n.parentElement=this;this.children.push(n)}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes)}
  setAttribute(k,v){this.attrs[k]=v}addEventListener(k,fn){this.events[k]=fn}
  querySelectorAll(s){return this.children.flatMap(n=>[...(s.split(',').includes(n.tag)?[n]:[]),...n.querySelectorAll(s)])}
  reportValidity(){return this.querySelectorAll('select').every(e=>!e.required||e.value!=='')}
  showModal(){this.open=true}close(){this.open=false}
 }
 const doc={head:new Element('head'),body:new Element('body'),createElement:tag=>new Element(tag),createTextNode:text=>Object.assign(new Element('#text'),{textContent:text})};
 const binding={asset_id:'asset',asset_revision:'version:1',platform:'tiktok'};
 const policy={privacy_levels:['SELF_ONLY','MUTUAL_FOLLOW_FRIENDS'],comment_disabled:false,duet_disabled:true,stitch_disabled:true,max_duration_sec:60};
 let counter=0;
 const scope={AbortSignal,crypto:{randomUUID:()=>`fa660000-0000-4000-8000-${String(++counter).padStart(12,'0')}`},fetch:async(_url,opts)=>{
  const req=JSON.parse(opts.body);requests.push(req);
  const base={ok:true,id:req.input.id,can_upload:false,can_publish:false,target:{id:'synthetic-tiktok',platform:'tiktok'},account_check:{target_id:'synthetic-tiktok',display_name:'Synthetic TikTok',policy}};
  if(req.action==='account')return {ok:true,json:async()=>({...base,stage:'account'})};
  assert.equal(req.action,'prepare','This UI test must never submit an approval');
  return {ok:true,json:async()=>({...base,binding,choices:req.input.choices,state:'prepared',approval_policy:'media-consent-2026-11-03.1',approval_token:'synthetic',check_error:checkError,draft:{caption:'Synthetic caption'},media_check:{asset_id:'asset',asset_revision:'version:1',checks:[{code:'CONTENT_REVIEW_PENDING',status:'pending',message:'Visuelle Prüfung offen.'}]}})};
 }};
 vm.runInNewContext(fs.readFileSync('app/assets/publication-order.mjs','utf8').replaceAll('export function','function').replaceAll('export const','const')+';this.install=installOrderReview;',scope);
 scope.install(doc,{host:doc.body,portalName:'TikTok',session:async()=>({access_token:'synthetic'}),getContext:()=>({binding,name:'Synthetic.mp4'}),refresh:async()=>{}});
 const dialog=byId.get('publicationOrderDialog'),form=dialog.querySelectorAll('form')[0];
 const get=id=>byId.get(id),change=(id,value)=>{const el=get(id);if(el.type==='checkbox')el.checked=value;else el.value=value;el.events.change?.();};
 const submit=()=>form.events.submit({preventDefault(){}});
 const approve=dialog.querySelectorAll('button').find(e=>e.textContent==='Veröffentlichung freigeben');
 return {doc,dialog,get,change,submit,approve,requests,open:()=>get('preparePublicationOrder').events.click()};
}

test('TikTok interactions and advertising start off, and account-forced switches stay disabled',async()=>{
 const t=tiktokDialog();await t.open();
 assert.equal(t.get('order-visibility').value,'');
 for(const k of ['disable_comment','disable_duet','disable_stitch','commercial','brand_organic_toggle','brand_content_toggle'])assert.equal(t.get('order-'+k).checked,false);
 assert.equal(t.get('order-disable_comment').disabled,false);assert.equal(t.get('order-disable_duet').disabled,true);assert.equal(t.get('order-disable_stitch').disabled,true);
 t.change('order-visibility','SELF_ONLY');await t.submit();
 assert.deepEqual(t.requests.at(-1).input.choices,{visibility:'SELF_ONLY',disable_comment:true,disable_duet:true,disable_stitch:true,brand_organic_toggle:false,brand_content_toggle:false});
 assert.ok(t.dialog.querySelectorAll('li').some(e=>e.textContent==='Visuelle Prüfung offen.'));
 assert.equal(t.get('order-review-tiktok_music_terms').parentElement.hidden,false);assert.equal(t.get('order-review-tiktok_branded_terms').parentElement.hidden,true);
});

test('TikTok advertising requires a selection, displays the label, and blocks private third-party content',async()=>{
 const t=tiktokDialog();await t.open();t.change('order-visibility','SELF_ONLY');t.change('order-commercial',true);
 assert.equal(t.get('order-brand_content_toggle').disabled,true);await t.submit();assert.equal(t.requests.length,1);
 t.change('order-visibility','MUTUAL_FOLLOW_FRIENDS');t.change('order-brand_content_toggle',true);t.change('order-brand_organic_toggle',true);
 assert.equal(t.get('order-visibility').children.find(e=>e.value==='SELF_ONLY').disabled,true);
 assert.ok(t.dialog.querySelectorAll('p').some(e=>e.textContent?.includes('Bezahlte Partnerschaft')));
 t.change('order-visibility','SELF_ONLY');await t.submit();assert.equal(t.requests.length,1);
 t.change('order-visibility','MUTUAL_FOLLOW_FRIENDS');await t.submit();
 assert.equal(t.requests.at(-1).input.choices.brand_content_toggle,true);assert.equal(t.requests.at(-1).input.choices.brand_organic_toggle,true);
 const branded=t.get('order-review-tiktok_branded_terms');assert.equal(branded.parentElement.hidden,false);
 for(const key of ['content_checked','media_rights','music_rights','tiktok_music_terms'])t.change('order-review-'+key,true);
 t.change('order-final-consent',true);assert.equal(t.approve.disabled,true);
 t.change('order-review-tiktok_branded_terms',true);assert.equal(t.approve.disabled,false);
 const links=t.dialog.querySelectorAll('a');assert.deepEqual(links.map(e=>e.href),['https://www.tiktok.com/legal/page/global/music-usage-confirmation/en','https://www.tiktok.com/legal/page/global/bc-policy/en']);
});

test('switching commercial disclosure off clears prior brand choices',async()=>{
 const t=tiktokDialog();await t.open();t.change('order-visibility','MUTUAL_FOLLOW_FRIENDS');t.change('order-commercial',true);t.change('order-brand_organic_toggle',true);
 assert.ok(t.dialog.querySelectorAll('p').some(e=>e.textContent?.includes('Werbeinhalt')));
 t.change('order-commercial',false);assert.equal(t.get('order-brand_organic_toggle').checked,false);assert.equal(t.get('order-brand_organic_toggle').parentElement.hidden,true);
 await t.submit();assert.equal(t.requests.at(-1).input.choices.brand_organic_toggle,false);
});

test('a changed current file keeps approval disabled even when every declaration is checked',async()=>{
 const t=tiktokDialog({checkError:'FILE_CHANGED'});await t.open();t.change('order-visibility','SELF_ONLY');await t.submit();
 for(const key of ['content_checked','media_rights','music_rights','tiktok_music_terms'])t.change('order-review-'+key,true);
 t.change('order-final-consent',true);assert.equal(t.approve.disabled,true);
 assert.ok(t.dialog.querySelectorAll('p').some(e=>e.textContent?.includes('Die Datei wurde geändert')));
});
