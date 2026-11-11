const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const load=import('../app/assets/shop-order-search.mjs');
test('shop order search accepts safe exact-number fragments and selected filters',async()=>{
 const {normalizeShopOrderFilters:n,orderFiltersActive:active}=await load;
 assert.deepEqual(n(),{search:'',market:'all',mode:'all'});
 assert.deepEqual(n({search:' #1001 ',market:'shopify',mode:'test'}),{search:'#1001',market:'shopify',mode:'test'});
 assert.equal(active(n()),false);
 assert.equal(active(n({search:'1001'})),true);
 assert.equal(active(n({mode:'unknown'})),true);
 for(const bad of ['%','_','\\','a%','a_b','x,foo','a\nb','!','#'.repeat(61)])assert.throws(()=>n({search:bad}),/ORDER_SEARCH_INVALID/);
 for(const bad of ['shop','unknown','shopify,all','a.b'])assert.throws(()=>n({market:bad}),/ORDER_SEARCH_INVALID/);
 for(const bad of ['live','false','pending','paid'])assert.throws(()=>n({mode:bad}),/ORDER_SEARCH_INVALID/);
});
test('filters are server-side, never classify an unknown test as real',async()=>{
 const {applyShopOrderFilters:apply}=await load;
 const filterTrace=[];
 const q={
  ilike:(k,v)=>{filterTrace.push(['ilike',k,v]);return q;},
  eq:(k,v)=>{filterTrace.push(['eq',k,v]);return q;},
  is:(k,v)=>{filterTrace.push(['is',k,v]);return q;}
 };
 apply(q,{search:'#1002',market:'shopify',mode:'test'});
 assert.deepEqual(filterTrace,[['ilike','bestellnummer','%#1002%'],['eq','markt','shopify'],['eq','ist_testbestellung',true]]);
 filterTrace.length=0;
 apply(q,{search:'',market:'digistore24',mode:'untagged'});
 assert.deepEqual(filterTrace,[['eq','markt','digistore24'],['eq','ist_testbestellung',false]]);
 filterTrace.length=0;
 apply(q,{search:'',market:'all',mode:'unknown'});
 assert.deepEqual(filterTrace,[['is','ist_testbestellung',null]]);
 filterTrace.length=0;
 apply(q,{search:'',market:'all',mode:'all'});
 assert.deepEqual(filterTrace,[]);
 assert.throws(()=>apply(q,{search:'_'}),/ORDER_SEARCH_INVALID/);
});
test('shop UI includes accessible order search above the five-item page list',()=>{
 const html=readFileSync('app/shop-manager.html','utf8');
 const section=html.slice(html.indexOf('<section id="bestellungen"'),html.indexOf('</section>',html.indexOf('<section id="bestellungen"')));
 const posSearch=section.indexOf('id="smaOrderSearch"'),posList=section.indexOf('id="bestellListe"');
 assert(posSearch>0&&posList>posSearch);
 assert.match(section,/id="smaOrderMarket"/);
 assert.match(section,/id="smaOrderTestMode"/);
 assert.match(section,/id="smaOrderClear"/);
 assert.match(section,/role="search"/);
 assert.match(html,/const ORDER_PAGE_SIZE = 5/);
 assert(html.includes(".eq('user_id',userId)"));
 assert.match(html,/requestQuery/);
 assert(html.includes('applyShopOrderFilters('));
 assert.doesNotMatch(section,/type="submit"/);
});
