const {test}=require('node:test');
const assert=require('node:assert/strict');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Node {
 constructor(tag='div'){this.tag=tag;this.children=[];this.events={};this.disabled=false;this.hidden=false;this.textContent='';this.href=undefined;}
 addEventListener(type,callback){this.events[type]=callback;}
 setAttribute(name,value){this[name]=value;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;this.textContent='';}
 click(){this.events.click?.();}
}
const doc={createElement:tag=>new Node(tag)};
const video={id:'asset-fixture',revision:'sha256:'+'a'.repeat(64)+':123',media_kind:'video'};
const shop='https://sma-automation.com/app/shop.html?shop=fixture&produkt=good_01';
const ds='https://www.checkout-ds24.com/redir/123456/FixtureAffiliate/Campaign_01';
const option=(provider,url)=>({provider,url,product_id:'good_01',requires_customer_approval:true});
const receipt=(offers)=>({ok:true,state:'OFFER_OPTIONS',offers,asset_revision:video.revision,
 can_publish:false,requires_customer_selection:true});

test('provider option view is passive until customer clicks, then shows separate verified channels',async()=>{
 const {mountProviderOfferOptions}=await import('../app/assets/publication-offer-options.mjs');
 const host=new Node();let calls=[];
 const w=mountProviderOfferOptions({doc,note:host,file:video,isCurrent:()=>true,
  request:async(id,rev)=>{calls.push({id,rev});return receipt([option('shopify',shop),option('digistore24',ds)])}});
 assert.equal(host.children.length,2);assert.equal(calls.length,0);
 w.button.click();await tick();
 assert.deepEqual(calls,[{id:video.id,rev:video.revision}]);
 const links=w.details.children.filter(x=>x.tag==='a');
 assert.deepEqual(links.map(x=>x.href),[shop,ds]);
 for(const a of links){assert.equal(a.target,'_blank');assert.match(a.rel,/noopener/);assert.equal(a.referrerPolicy,'no-referrer');}
 assert.equal(w.button.disabled,false);
});

test('unverified, foreign, tampered and duplicate options never become clickable links',async()=>{
 const {mountProviderOfferOptions,allowedProviderOffer}=await import('../app/assets/publication-offer-options.mjs');
 for(const invalid of [
  option('digistore24','https://evil.invalid/redir/123456/FixtureAffiliate'),
  option('digistore24','http://www.checkout-ds24.com/redir/123456/FixtureAffiliate'),
  option('digistore24',ds+'?next=https://evil.invalid'),
  option('digistore24',ds+'#fragment'),
  option('shopify','https://sma-automation.com/app/shop.html?shop=other&produkt=good_01&next=evil'),
  {...option('shopify',shop),requires_customer_approval:false},
  {...option('shopify',shop),product_id:'foreign_id'}
 ])assert.equal(allowedProviderOffer(invalid),null,JSON.stringify(invalid));
 const host=new Node();
 const w=mountProviderOfferOptions({doc,note:host,file:video,isCurrent:()=>true,
  request:async()=>receipt([option('shopify',shop),option('shopify',shop)])});
 w.button.click();await tick();
 assert.equal(w.details.children.filter(x=>x.tag==='a').length,0);
 assert.match(w.details.textContent,/nicht sicher geprüft/);
});

test('missing offers, unauthorized server responses, and a switched file remain fail-closed',async()=>{
 const {mountProviderOfferOptions}=await import('../app/assets/publication-offer-options.mjs');
 const empty=new Node();
 const w=mountProviderOfferOptions({doc,note:empty,file:video,isCurrent:()=>true,request:async()=>receipt([])});
 w.button.click();await tick();assert.match(w.details.textContent,/kein eindeutig bestätigter/);
 const denied=new Node();
 const d=mountProviderOfferOptions({doc,note:denied,file:video,isCurrent:()=>true,
  request:async()=>({ok:false,code:'FILE_CHANGED',can_publish:false})});
 d.button.click();await tick();assert.match(d.details.textContent,/nicht sicher geprüft/);
 let complete;let current=true;
 const switched=new Node();
 const s=mountProviderOfferOptions({doc,note:switched,file:video,isCurrent:()=>current,
  request:()=>new Promise(resolve=>{complete=resolve})});
 s.button.click();current=false;complete(receipt([option('shopify',shop)]));await tick();
 assert.equal(s.details.children.filter(x=>x.tag==='a').length,0);
 assert.equal(s.button.disabled,false);
 s.destroy();assert.equal(s.button.disabled,true);
});

test('one explicit customer click selects the verified offer, not merely displaying it',async()=>{
 const {mountProviderOfferOptions}=await import('../app/assets/publication-offer-options.mjs');
 const host=new Node(),selections=[];let resolveWrite;
 const view=mountProviderOfferOptions({doc,note:host,file:video,isCurrent:()=>true,
  request:async()=>receipt([option('shopify',shop),option('digistore24',ds)]),
  onSelect:offer=>{selections.push(offer);return new Promise(resolve=>{resolveWrite=resolve;});}});
 assert.equal(selections.length,0);
 view.button.click();await tick();
 assert.equal(selections.length,0,'link review cannot save an offer');
 const choose=view.details.children.filter(x=>x.tag==='button');
 assert.equal(choose.length,2);
 choose[1].click();await tick();
 assert.equal(selections.length,1);
 assert.deepEqual(selections[0],{provider:'digistore24',url:ds,product_id:'good_01',label:'Digistore24-Angebot ansehen'});
 assert.equal(choose[1].disabled,true);
 choose[1].click();await tick();
 assert.equal(selections.length,1,'double-click cannot create a second write');
 resolveWrite();await tick();
 assert.equal(choose[1].disabled,false);
});

test('destination validation distinguishes a Digistore link from a Shopify product page',async()=>{
 const {draftDestination}=await import('../app/assets/publication-destination.mjs');
 const root=shop.split('&produkt=')[0];
 const linked={offer_provider:'digistore24',offer_url:ds,offer_product_id:'good_01'};
 assert.deepEqual(draftDestination(root,linked,'de'),{url:ds,label:'Zum Angebot'});
 assert.deepEqual(draftDestination(root,linked,'en'),{url:ds,label:'View offer'});
 for(const wrong of [
  {...linked,offer_url:'https://evil.invalid/redir/123456/Affiliate'},
  {...linked,offer_url:ds+'?next=https://evil.invalid'},
  {...linked,product_id:'good_01'},
  {...linked,offer_provider:'shopify'},
  {...linked,offer_product_id:'../../etc'},
 ])assert.equal(draftDestination(root,wrong,'de'),null);
 assert.deepEqual(draftDestination(root,{product_id:'good_01'},'de'),
  {url:root+'&produkt=good_01',label:'Zum Produkt'});
});
