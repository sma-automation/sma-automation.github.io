const test=require('node:test');
const assert=require('node:assert/strict');
const ready=import('../app/assets/shop-catalog-model.mjs');
const url='https://sma-automation.com/app/shop.html?shop=mein-shop';
const image='https://bnvnmdxosbnuzedokqgh.supabase.co/storage/v1/object/sign/sma-produktbilder/customer/product/photo.png?token=public-image';
const product={produkt_id:'p1',name:'Produkt',preis:39.9,waehrung:'EUR',bestand:6,shopify_aktiv:true,bilder:[image]};
const response=(overrides={})=>({ok:true,shop:{slug:'mein-shop',name:'Testshop'},seite:1,pro_seite:10,gesamt:1,seiten:1,produkte:[{...product}],...overrides});

test('catalog embed has fixed public destinations and an accessible fallback without credentials',async()=>{
 const {createShopCatalog,catalogFromSearch}=await ready;
 const embed=createShopCatalog(url);
 assert.equal(embed.src,'https://sma-automation.com/app/shop-catalog.html?shop=mein-shop');
 assert.equal(catalogFromSearch('?shop=mein-shop').url,url);
 assert.match(embed.html,/<iframe[^>]*title="Produkte aus unserem SMA-Shop"/);
 assert.match(embed.html,/referrerpolicy="no-referrer"/);
 assert.match(embed.html,/<a href="https:\/\/sma-automation\.com\/app\/shop\.html\?shop=mein-shop" target="_blank" rel="noopener noreferrer">/);
 assert.doesNotMatch(embed.html,/access_token|customer_id|user_id|<script|onload|checkout/);
});

test('embed rejects injected destinations, duplicate parameters, and unsupported shop identifiers',async()=>{
 const {createShopCatalog,catalogFromSearch,catalogRequestUrl}=await ready;
 for(const value of [null,'',url+'\n',url+'#x',url+'&token=x',url.replace('.com','.com.evil.test'),url+'"><img src=x>',url.replace('mein-shop','x'.repeat(64))])assert.equal(createShopCatalog(value),null);
 for(const search of ['',null,'?shop=one&shop=two','?shop=UPPER','?shop=one&url=https://evil.test','?shop=one%0A','?shop=one%22%3E','?shop='+('x'.repeat(64))])assert.equal(catalogFromSearch(search),null);
 for(const page of [0,-1,1.5,1001,'1'])assert.throws(()=>catalogRequestUrl('mein-shop',page),{code:'INVALID_REQUEST'});
 assert.throws(()=>catalogRequestUrl('../other',1),{code:'INVALID_REQUEST'});
});

test('catalog rejects another shop, stale page metadata and inconsistent product counts',async()=>{
 const {readCatalog}=await ready;
 for(const patch of [{shop:{slug:'other',name:'Other'}},{seite:2},{pro_seite:20},{gesamt:2},{seiten:5},{produkte:[product,product]},{ok:false}])assert.throws(()=>readCatalog(response(patch),'mein-shop',1));
 const empty=readCatalog(response({gesamt:0,seiten:0,produkte:[]}),'mein-shop',1);
 assert.equal(empty.products.length,0);
 const changed=readCatalog(response({seite:2,gesamt:1,seiten:1,produkte:[]}),'mein-shop',2);
 assert.equal(changed.total,1);
});

test('missing or invalid price and stock never become a free available product',async()=>{
 const {readCatalog}=await ready;
 for(const value of [null,'',false,-1,Infinity,'free',{},'1e2']){
  const p=readCatalog(response({produkte:[{...product,preis:value,bestand:value}]}),'mein-shop',1).products[0];
  assert.equal(p.price,null);assert.equal(p.stock,null);
 }
 const p=readCatalog(response({produkte:[{...product,preis:'39.90',bestand:0,shopify_aktiv:'true'}]}),'mein-shop',1).products[0];
 assert.equal(p.price,39.9);assert.equal(p.stock,0);assert.equal(p.ready,false);
 assert.equal(readCatalog(response({produkte:[{...product,waehrung:'<EUR>'}]}),'mein-shop',1).products[0].price,null);
});

test('only current project product-storage images are rendered, while text remains plain data',async()=>{
 const {readCatalog}=await ready;
 const sources=['javascript:alert(1)','data:image/svg+xml,<svg/>','https://evil.test/photo.png',image.replace('.co','.co.evil.test'),image.replace('/sign/','/public/'),'http://localhost/photo.png'];
 const p=readCatalog(response({produkte:[{...product,name:'<img src=x onerror=alert(1)>',bilder:sources}]}),'mein-shop',1).products[0];
 assert.equal(p.image,null);assert.equal(p.title,'<img src=x onerror=alert(1)>');
 assert.equal(readCatalog(response(),'mein-shop',1).products[0].image,image);
});

test('catalog fetch uses only the public read endpoint with omitted credentials and no redirects',async()=>{
 const {fetchCatalog}=await ready;let calls=0;const signal=new AbortController().signal;
 const catalog=await fetchCatalog({slug:'mein-shop',signal,fetcher:async(destination,options)=>{
  calls++;assert.equal(destination,'https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-shop-produkte?shop=mein-shop&seite=1');
  assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.signal,signal);
  assert.deepEqual(options.headers,{Accept:'application/json'});return {ok:true,json:async()=>response()};
 }});
 assert.equal(catalog.products[0].stock,6);assert.equal(calls,1);
});

test('disabled shop and invalid responses fail closed and invalid slugs never send a request',async()=>{
 const {fetchCatalog}=await ready;
 await assert.rejects(fetchCatalog({slug:'mein-shop',fetcher:async()=>({ok:false})}),{code:'UNAVAILABLE'});
 await assert.rejects(fetchCatalog({slug:'mein-shop',fetcher:async()=>({ok:true,json:async()=>response({shop:{slug:'other',name:'Other'}})})}),{code:'INVALID_RESPONSE'});
 let called=false;
 await assert.rejects(fetchCatalog({slug:'../private',fetcher:async()=>{called=true;}}),{code:'INVALID_REQUEST'});
 assert.equal(called,false);
});
