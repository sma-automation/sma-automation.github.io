// Native Chromium reproduction of the customer's saved-site preparation
// inside a srcdoc Dashboard iframe, including their live-like shop context.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const read=p=>readFile(new URL('../app/'+p,import.meta.url),'utf8');
const [model,button,catalog,website,css,setup,domain,wordpress,sync]=await Promise.all([
 'assets/website-domain-model.mjs','assets/shop-button.mjs',
 'assets/shop-catalog-model.mjs','assets/website-domain.mjs',
 'assets/website-domain.css','assets/website-setup.mjs',
 'assets/domain-verification.mjs','assets/wordpress-connection.mjs',
 'assets/wordpress-sync.mjs'
].map(read));
const expose=(source,returned)=>source.replace(/^import .*;$/gm,'')
 .replace(/\bexport (?:function|const|async function)\b/g,x=>x.replace('export ',''))
 +'\nreturn {'+returned+'};';
const code=[
 'const {createWebsiteDraftClient,safeShopLink,normalizeWebsite,normalizeDomain}=(()=>{'+expose(model,'createWebsiteDraftClient,safeShopLink,normalizeWebsite,normalizeDomain')+'})();',
 'const {createShopButton}=(()=>{'+expose(button,'createShopButton')+'})();',
 'const {createShopCatalog}=(()=>{'+expose(catalog,'createShopCatalog')+'})();',
 'const {mountWebsiteSetup}=(()=>{'+expose(setup,'mountWebsiteSetup')+'})();',
 'const {mountWordpressSync}=(()=>{'+expose(sync,'mountWordpressSync')+'})();',
 'const {mountWordpressConnection}=(()=>{'+expose(wordpress,'mountWordpressConnection')+'})();',
 'const {mountDomainVerification,domainVerificationTarget}=(()=>{'+expose(domain,'mountDomainVerification,domainVerificationTarget')+'})();',
 expose(website,'mountWebsitePreparation').replace(/^return \{mountWebsitePreparation\};$/m,'')
].join('\n');
const site='https://eu2.wpsandbox.org/site/s-qa73zdpavg6dm/';
const shop='https://sma-automation.com/app/shop.html?shop=sma-testkunde';
const fixtures=[
 {name:'legacy-active',isActive:true,shopUrl:shop},
 {name:'chapters-not-active',isActive:false,shopUrl:shop},
 {name:'no-shop',isActive:false,shopUrl:null},
 {name:'stalled-auth',isActive:false,shopUrl:shop,stalledAuth:true},
 {name:'late-read-preserves-input',isActive:false,shopUrl:shop,lateRead:true}
];
function frame(f){
 const js=code+'\n'+[
  'const report={scenario:'+JSON.stringify(f.name)+'};',
  'const page=document.getElementById("page-website");',
  'const view=mountWebsitePreparation({',
  ' page,chapterNavigation:true,stylesheetUrl:"data:text/css,",',
  ' getOwnerId:async()=>'+(f.stalledAuth?'new Promise(()=>{})':'"test-owner"')+',',
  ' setupRequest:async(action)=>{report.setup=(report.setup||[]).concat(action);return {ok:true,available:false,draft_exists:true,job:null};},',
  ' domainRequest:async(action)=>{report.domain=(report.domain||[]).concat(action);return {ok:true,revision:1,state:"unprepared",hostname:"eu2.wpsandbox.org"};},',
  ' wordpressRequest:async()=>({ok:false,code:"NOT_CONNECTED"}),',
  ' wordpressSyncRequest:async()=>({ok:false,code:"NOT_CONNECTED"}),',
  ' request:async(action)=>{report.calls=(report.calls||[]).concat(action);',
  (f.lateRead?'  await new Promise(resolve=>setTimeout(resolve,400));':'')+
  ' return {',
  '  ok:true,state:"preparation",revision:1,can_publish:false,',
  '  updated_at:"2026-11-10T19:44:21Z",shop_url:'+JSON.stringify(f.shopUrl)+',',
  '  draft:{mode:"existing",website_url:'+JSON.stringify(site)+',desired_domain:""}',
  ' }}',
  '});',
  (f.lateRead?[
  'setTimeout(()=>{const field=document.querySelector("[name=website_url]");',
  ' field.value="https://edited.test-website.org/";',
  ' field.dispatchEvent(new Event("input",{bubbles:true}));},90);'
  ].join('
'):''),
  'setTimeout(()=>{',
  ' const root=document.getElementById("smaWebsitePreparation");',
  ' const input=root.querySelector("[name=website_url]");',
  ' const fieldset=root.querySelector("fieldset");',
  ' const submit=root.querySelector("[type=submit]");',
  ' const status=root.querySelector(".sma-website-status");',
  ' const box=input.getBoundingClientRect();input.focus();',
  ' Object.assign(report,{fieldsetDisabled:fieldset.disabled,submitDisabled:submit.disabled,',
  '  inputDisabled:input.disabled,actualDisabled:input.matches(":disabled"),',
  '  isFocused:document.activeElement===input,inputValue:input.value,',
  '  notice:status.textContent,noticeHidden:status.hidden,busy:root.getAttribute("aria-busy"),',
  '  hit:document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)?.tagName,',
  '  pointer:getComputedStyle(input).pointerEvents});',
  ' parent.postMessage(report,"*");view.destroy();',
  '},1200);'
 ].join('\n');
 const html='<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style></head><body>'+
 '<section id="page-website" class="'+(f.isActive?'active':'')+'"><div class="package-module-slot"></div></section>'+
 '<script>'+js.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
 return '<iframe style="width:900px;height:730px" srcdoc="'+
 html.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')+'"></iframe>';
}
const folder=await mkdtemp(join(tmpdir(),'sma-wp-browser-'));
try{
 const file=join(folder,'verify.html');
 const html='<!doctype html><html><body><script>'+
 'addEventListener("message",event=>{const e=document.createElement("output");'+
 'e.textContent=JSON.stringify(event.data);document.body.append(e);});'+
 '</script>'+fixtures.map(frame).join('')+'</body></html>';
 await writeFile(file,html);
 const output=execFileSync(process.env.CHROME_BIN||'google-chrome',[
  '--headless','--no-sandbox','--disable-background-networking','--disable-gpu',
  '--disable-dev-shm-usage','--user-data-dir='+join(folder,'profile'),
  '--virtual-time-budget=4500','--dump-dom',pathToFileURL(file).href
 ],{encoding:'utf8',maxBuffer:6*1024*1024,timeout:35000,stdio:['ignore','pipe','pipe']});
 const reports=[...output.matchAll(/<output>(\{[^<]*\})<\/output>/g)].map(x=>JSON.parse(x[1]));
 assert.equal(reports.length,fixtures.length,'Every Chromium scenario must complete');
 for(const f of fixtures){
  const result=reports.find(r=>r.scenario===f.name);assert.ok(result,f.name);
  console.log(result);
  if(f.stalledAuth){
   assert.deepEqual(result.calls||[],[],'No request may start without an authenticated owner');
   assert.equal(result.submitDisabled,true,'Save must remain gated during a stalled owner lookup');
  }else{
   assert.deepEqual(result.calls,['get'],f.name+' must load the preparation');
   assert.equal(result.submitDisabled,false,f.name+' save action');
  }
  assert.equal(result.inputValue,f.lateRead?'https://edited.test-website.org/':f.stalledAuth?'':site);
  assert.equal(result.fieldsetDisabled,false,f.name+' fieldset must allow address editing');
  assert.equal(result.actualDisabled,false,f.name+' native browser state');
  assert.equal(result.isFocused,true,f.name+' should be keyboard-editable');
  assert.equal(result.hit,'INPUT',f.name+' input should receive pointer events');
  assert.equal(result.pointer,'auto',f.name+' pointer interaction');
 }
}finally{await rm(folder,{recursive:true,force:true});}
