const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/checkout-test.html'),'utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/m,'');
class Element{constructor(){this.children=[];this.events={};this.hidden=false;this.disabled=false;this.textContent='';this.value='';this.checked=false;}append(...x){this.children.push(...x)}replaceChildren(...x){this.children=x}setAttribute(){}addEventListener(k,f){this.events[k]=f}}
const product={sma_produkt_id:'10c2f5a9-0571-4023-a1d6-df871813e1a7',produkt_name:'Produkt 2',sku:'P2',bestand:6,preis:39.9,waehrung:'EUR'};
const result={ok:true,modus:'dry_run',zahlung_ausgeloest:false,checkout_url:null,live_checkout_unveraendert:true,haendler_freigegeben:false,waehrung:'EUR',gesamtbetrag:39.9,warenkorb:[{name:'Produkt 2',menge:1,summe:39.9}],message:'Test bestanden'};
async function boot({signedIn=true,slug='sma-testkunde',invoke=async()=>({data:result})}={}){
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id)};
 get('selection').hidden=true;get('result').hidden=true;
 const calls=[];
 const client={auth:{getSession:async()=>({data:{session:signedIn?{user:{id:'owner'}}:null}})},from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},single(){return q},then(resolve){resolve({data:table==='sma_kunden'?{kunde_id:'customer',shop_slug:slug,aktiv:true,shop_oeffentlich:true,demo_delta_aktiv:true}:[product]})}};return q;},functions:{invoke:async(name,options)=>{calls.push({name,options});return invoke();}}};
 await vm.runInNewContext('(async()=>{'+source+'})()',{createClient:()=>client,document:{getElementById:get,createElement:()=>new Element()},Intl,console});
 return {get,calls,qty:get('products').children[0]?.children[2]?.children[1],run:()=>get('check').events.click()};
}
test('owner can test with only shop, product IDs and quantities; edits clear a successful result',async()=>{
 const p=await boot();assert.equal(p.get('selection').hidden,false);await p.run();assert.equal(p.get('result').hidden,false);assert.match(p.get('resultTotal').textContent,/39,90/);
 assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0].options.body)),{shop:'sma-testkunde',items:[{produkt_id:product.sma_produkt_id,menge:1}]});
 p.qty.value='2';p.qty.events.input();assert.equal(p.get('result').hidden,true);assert.match(p.get('status').textContent,/erneut/);
});
test('signed out and other-merchant sessions cannot expose the test form',async()=>{
 for(const config of [{signedIn:false},{slug:'other'}]){const p=await boot(config);assert.equal(p.get('selection').hidden,true);assert.equal(p.calls.length,0);}
});
test('invalid quantities are blocked locally; server stock errors appear and controls recover',async()=>{
 const p=await boot({invoke:async()=>({error:{context:{json:async()=>({message:'Gewünschte Menge nicht verfügbar'})}}})});
 for(const value of ['','0','1.5','21']){p.qty.value=value;await p.run();}assert.equal(p.calls.length,0);
 p.qty.value='7';await p.run();assert.equal(p.get('result').hidden,true);assert.match(p.get('status').textContent,/nicht verfügbar/);assert.equal(p.get('check').disabled,false);
});
test('concurrent clicks invoke once, and an unexpected payment URL is never shown',async()=>{
 let finish;const p=await boot({invoke:()=>new Promise(resolve=>finish=resolve)});
 const first=p.run();await p.run();assert.equal(p.calls.length,1);assert.equal(p.qty.disabled,true);
 finish({data:{...result,checkout_url:'https://evil.invalid'}});await first;assert.equal(p.get('result').hidden,true);assert.match(p.get('status').textContent,/nicht bestätigt/);assert.equal(p.qty.disabled,false);
});
