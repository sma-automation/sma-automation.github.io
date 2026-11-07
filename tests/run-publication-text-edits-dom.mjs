import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {parseHashtags,addHashtagField,hashtagMessage} from '../app/assets/publication-hashtags.mjs';
import {draftDestination} from '../app/assets/publication-destination.mjs';
const source=await readFile(new URL('../app/assets/publication-preview.js',import.meta.url),'utf8'),html=await readFile(new URL('../app/publication-preview.html',import.meta.url),'utf8');
const render=source.slice(source.indexOf('function caption('),source.indexOf('async function waitForResult('));
const save=source.slice(source.indexOf("$('save').addEventListener('click',async()=>{"),source.indexOf("window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.top&&event.data?.type==='sma-publication-order-viewport')"));
const shop='https://sma-automation.com/app/shop.html?shop=fixture',draft=platform=>({platform,title:'Synthetischer Test',body:'Ein roter Gegenstand wird gezeigt.',hashtags:['Alt','Hotel'],caption:'Ein roter Gegenstand wird gezeigt.\n\n#Alt #Hotel\n\n🛒 Zum Shop: '+shop,review_notes:[]});
const initial={ok:true,status:'completed',id:'fixture',revision:1,assignment_revision:1,preview:{can_publish:false,language:'de',shop_url:shop,drafts:[draft('youtube'),draft('tiktok')]}};
function fixture({assigned=true}={}){
 const {document,window}=parseHTML(html),$=id=>document.getElementById(id),calls=[];let submit,fail=false,changed=0;
 window.HTMLInputElement.prototype.setCustomValidity=function(message){this.validationMessage=message;};
 $('save').addEventListener=(type,fn)=>{submit=fn;};
 const context=vm.createContext({document,draftDestination,parseHashtags,addHashtagField,hashtagMessage,$,names:{youtube:'YouTube',tiktok:'TikTok'},messages:{AUTH_REQUIRED:'Anmelden',INVALID_EDIT:'Ungültiger Text'},signedOut:false,current:null,busy:false,dirty:false,selectedPortal:assigned?'youtube':null,selectedAsset:assigned?{id:'file',assignments:[]}:null,assignmentRevision:1,workspace:{textAvailable(){},selection(){}},renderFilePicker(){},status:(t,e)=>{$('status').textContent=t;},errorText:()=>'',fileContext:()=>({asset_id:'file',asset_revision:'r1',platform:'youtube',assignment_revision:1}),lock(){},syncMedia(){},fileChanged(){changed++;},ensureFreshFile:async()=>{},withFreshFile:async(c,fn)=>fn(),fileRpc:async(action,input)=>{calls.push({action,input});if(fail)throw Error('Versionskonflikt');return { ...initial,revision:2,assignment_revision:2,preview:{...initial.preview,drafts:[{...draft('youtube'),...input,caption:input.body+'\n\n'+input.hashtags.map(t=>'#'+t).join(' ')+'\n\n🛒 Zum Shop: '+shop}]}};},rpc:async(action,input)=>{calls.push({action,input});return {...initial,revision:2,preview:{...initial.preview,drafts:input.drafts.map(d=>({...draft(d.platform),...d}))}};}});
 vm.runInContext(render+save,context);context.render(structuredClone(initial));
 const input=(key,value)=>{$(key).value=value;$(key).dispatchEvent(new window.Event('input',{bubbles:true}));};
 return {$,context,calls,submit,input,fail(){fail=true;},get changed(){return changed;}};
}
let n=0;
{
 const f=fixture();assert.equal(f.$('youtube-hashtags').value,'#Alt #Hotel');f.input('youtube-hashtags','#Tür #Gadget');assert.equal(f.context.dirty,true);assert.match(f.$('drafts').querySelector('.caption').textContent,/#Tür #Gadget/);assert.doesNotMatch(f.$('drafts').querySelector('.caption').textContent,/#Hotel/);await f.submit();assert.deepEqual(f.calls[0].input.hashtags,['Tür','Gadget']);assert.equal(f.$('youtube-hashtags').value,'#Tür #Gadget');assert.equal(f.context.dirty,false);assert.equal(f.changed,1);n++;
}
{
 const f=fixture();f.input('youtube-hashtags','');await f.submit();assert.deepEqual(f.calls[0].input.hashtags,[]);assert.equal(f.$('youtube-hashtags').value,'');n++;
}
{
 const f=fixture();f.input('youtube-hashtags','a b c d');assert.ok(f.$('youtube-hashtags').validationMessage);await f.submit();assert.equal(f.calls.length,0);assert.equal(f.context.dirty,true);assert.match(f.$('status').textContent,/höchstens drei/);n++;
}
{
 const f=fixture();f.input('youtube-hashtags','#Neu');f.fail();await f.submit();assert.equal(f.$('youtube-hashtags').value,'#Neu');assert.equal(f.context.dirty,true);assert.match(f.$('saveStatus').textContent,/noch nicht gespeichert/);n++;
}
{
 const f=fixture({assigned:false});f.input('youtube-hashtags','#Tür');await f.submit();assert.deepEqual(f.calls[0].input.drafts.map(d=>d.hashtags),[['Tür'],['Alt','Hotel']]);n++;
}
{
 const f=fixture();f.input('youtube-hashtags','#Neu');f.context.signedOut=true;await f.submit();assert.equal(f.calls.length,0);assert.throws(()=>f.context.render(initial),/Anmelden/);n++;
}
{
 const f=fixture();
 const d={...draft('youtube'),product_id:'Artikel_01'};
 const url=shop+'&produkt=Artikel_01';
 d.caption=d.caption.replace('Zum Shop: '+shop,'Zum Produkt: '+url);
 f.context.render({...initial,preview:{...initial.preview,drafts:[d]}});
 assert.equal(f.$('shopLink').href,url);
 f.input('youtube-body','Eine neue Beschreibung für das Video.');
 assert.equal(f.$('drafts').querySelector('.caption').textContent,'Eine neue Beschreibung für das Video.\n\n#Alt #Hotel\n\n🛒 Zum Produkt: '+url);
 n++;
}
console.log(n+' publication text edit DOM scenarios passed.');
