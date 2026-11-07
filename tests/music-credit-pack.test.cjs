const {test}=require('node:test'),assert=require('node:assert/strict');
const transport=import('../supabase/functions/sma-music-credit-pack/handler.mjs');
test('a disabled merchant connector and unsigned requests cannot start a payment',async()=>{
 const {createPackHandler}=await transport;let called=0;
 const entry=enabled=>createPackHandler({enabled,userStart:async()=>{called++;}});
 const url='https://sma.example.test/function';
 assert.equal((await entry(false)(new Request(url,{method:'POST',headers:{Authorization:'Bearer fixture'}}))).status,503);
 assert.equal((await entry(true)(new Request(url,{method:'POST'}))).status,401);
 assert.equal(called,0);
});
test('checkout only follows a known Mollie HTTPS host',async()=>{
 const {checkoutLink}=await transport;
 for(const url of ['http://www.mollie.com/checkout/test','https://notmollie.com/','https://www.mollie.com:444/','https://attacker@www.mollie.com/','javascript:alert(1)'])assert.throws(()=>checkoutLink(url));
 assert.equal(checkoutLink('https://www.mollie.com/checkout/test'),'https://www.mollie.com/checkout/test');
});
test('editor lists unlocked catalogue tracks, deduplicates owned files and restores verified bytes',async()=>{
 const {createMusicLibraryAPI}=await import('../app/assets/music-library-api.mjs');
 const {inspectMusic}=await import('../app/assets/media-music-model.mjs');
 const blob=new File([Buffer.from('RIFFabcdWAVE1234')],'SMA track.wav'),recipe=await inspectMusic(blob);
 const owner='ab660000-0000-4000-9000-000000000091';
 const rows=[{...recipe,available:true},{...recipe,sha256:'a'.repeat(64),available:false}];
 let stored=[],corrupt=false;
 const api=createMusicLibraryAPI({owner,includeCatalog:true,getSession:async()=>({access_token:'fixture',user:{id:owner}}),request:async(url,opts)=>{
  if(url.includes('/storage/')){assert.ok(url.endsWith('/sma-katalog/'+recipe.sha256+'.wav'));return {ok:true,blob:async()=>corrupt?new Blob(['wrong']):blob};}
  return {ok:true,json:async()=>url.endsWith('credits_v1')?{ok:true,plan:'alpha',credits:9,tracks:rows}:JSON.parse(opts.body).p_action==='list'?{ok:true,version:1,tracks:stored}:{ok:false,code:'MUSIC_NOT_FOUND'}};
 }});
 assert.deepEqual((await api.list()).map(t=>t.catalog),[true]);
 assert.equal(await api.source(recipe),blob);
 stored=[{...recipe,id:owner,status:'ready',favourite:false,object_name:owner+'/'+recipe.sha256+'.wav'}];
 assert.equal((await api.list()).length,1);corrupt=true;await assert.rejects(()=>api.source(recipe),/MUSIC_REQUIRED/);
});
test('dashboard offers ten credits only with an available checkout and renders current entitlements',async()=>{
 const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
 const {mountCatalog}=await import('../app/assets/music-catalog.mjs');
 const {document:doc}=parseHTML('<html><body><div><span id="creditsBalanceSlot">–</span><button disabled>Credits aufladen</button></div><div id="catalog"></div></body></html>');
 const tick=()=>new Promise(resolve=>setImmediate(resolve));let credits=10,available=false,paid=0;
 const host=doc.getElementById('catalog'),settings=doc.getElementById('creditsBalanceSlot');
 const data=()=>({plan:'beta',credits,tracks:[{name:'Musikbeispiel',sha256:'a'.repeat(64),available}]});
 const view=mountCatalog({doc,host,api:{overview:async()=>data(),checkoutEnabled:async()=>true,
  unlock:async()=>{available=true;credits--;},checkout:async()=>{paid++;return {state:'pending'};}},goToCheckout(){assert.fail('No real checkout');}});
 await tick();const btn=label=>[...host.querySelectorAll('button')].find(b=>b.textContent===label);
 assert.equal(settings.textContent,'10 Musik-Credits');assert.equal(settings.parentNode.querySelector('button').disabled,false);
 btn('Für 1 Credit freischalten').click();await tick();
 assert.equal(settings.textContent,'9 Musik-Credits');assert.ok(btn('Anhören'));assert.equal(paid,0);
 view.destroy();assert.equal(settings.textContent,'–');assert.equal(settings.parentNode.querySelector('button').disabled,true);
 const empty=mountCatalog({doc,host,api:{overview:async()=>({plan:'delta',credits:0,tracks:[]})}});
 await tick();assert.match(host.textContent,/in deinem Delta-Paket enthalten/);
 assert.equal(btn('10 Musik-Credits für 10 € kaufen').hidden,true);empty.destroy();
});
