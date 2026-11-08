// Run the actual editor through an iframe reload. The fixture has only a local, synthetic RPC client.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

const fileId='a7700000-0000-4000-8000-000000000011';
const client=`
const file={id:'${fileId}',revision:'version:1',media_kind:'video',name:'Testvideo.webm',mime_type:'video/webm',verified_at:new Date().toISOString(),
 assignments:[{platform:'youtube',revision:4,status:'assigned'}]};
const draft={platform:'youtube',title:'Gespeichert',body:'Mein früherer Beitragstext.',hashtags:[],review_notes:[],caption:'Mein früherer Beitragstext.'};
const saved={ok:true,status:'completed',id:'a7700000-0000-4000-8000-000000000022',revision:1,assignment_revision:4,
 preview:{can_publish:false,language:'de',shop_url:'https://sma-automation.com/app/shop.html?shop=fixture',drafts:[draft]}};
let offline=false;
export function createClient(){return {auth:{onAuthStateChange(){},getSession:async()=>({data:{session:{user:{id:'fixture-owner'},access_token:'fixture'}}})},
 rpc(name,args){
  const call=(async()=>{
   if(name==='sma_publication_files_v1'){
    if(args.p_action==='list')return {data:{ok:true,files:[file]}};
    if(args.p_action==='save'){sessionStorage.fixtureWrites=String(Number(sessionStorage.fixtureWrites||0)+1);offline=true;throw Error('lost reply');}
    if(args.p_action==='get'){if(offline)throw Error('offline');return {data:saved};}
   }
   return {data:{ok:false,code:'UNAVAILABLE'}};
  })();
  call.abortSignal=()=>call;return call;
 }};}`;

const exercise=`
try{
 const body=document.getElementById('youtube-body'),pending='Lokale Korrektur aus dem vorherigen Seitenaufruf.';
 if(!sessionStorage.fixtureReload){
  if(!body)throw Error('Editor did not open');
  body.value=pending;body.dispatchEvent(new Event('input',{bubbles:true}));
  const unresolved=new Promise(resolve=>{
   const observer=new MutationObserver(()=>{if(!busy&&!document.getElementById('checkDraftSave').hidden){
    observer.disconnect();resolve();
   }});
   observer.observe(document.body,{attributes:true,childList:true,subtree:true});
  });
  document.getElementById('save').click();await unresolved;sessionStorage.fixtureReload='1';location.reload();
 }else{
  parent.postMessage({type:'reload-result',restored:body?.value===pending,writes:Number(sessionStorage.fixtureWrites),
   notice:document.getElementById('saveStatus').textContent,ready:!busy&&!document.getElementById('save').disabled},location.origin);
 }
}catch(error){parent.postMessage({type:'reload-result',error:String(error)},location.origin);}`;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  const send=(type,body)=>{res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store',
   'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:"});res.end(body);};
  if(path==='/')return send('text/html','<script>onmessage=e=>{if(e.origin===location.origin&&e.data?.type==="reload-result"){const o=document.createElement("output");o.textContent=JSON.stringify(e.data);document.body.append(o);}}</script><iframe src="/app/publication-preview.html?portal=youtube&wide=1&asset='+fileId+'"></iframe>');
  if(path==='/client.mjs')return send('text/javascript',client);
  if(path!=='/app/publication-preview.html'&&!/^\/app\/assets\/[\w.-]+\.(css|m?js)$/.test(path)){res.writeHead(404).end();return;}
  let source=await readFile(new URL('..'+path,import.meta.url),'utf8');
  if(path==='/app/assets/publication-preview.js')source=source.replace("import('https://esm.sh/@supabase/supabase-js@2')","import('/client.mjs')")+exercise;
  send(path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'text/javascript',source);
 }catch{res.writeHead(500).end();}
});
const profile=await mkdtemp(join(tmpdir(),'sma-tab-reload-'));
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const {stdout}=await promisify(execFile)(process.env.CHROME_BIN||'google-chrome',[
  '--headless','--disable-gpu','--disable-background-networking','--disable-dev-shm-usage','--no-sandbox',
  '--user-data-dir='+profile,'--virtual-time-budget=12000','--dump-dom','http://127.0.0.1:'+server.address().port
 ],{timeout:45000,maxBuffer:2*1024*1024});
 const match=stdout.match(/<output>([^<]+)<\/output>/);assert.ok(match,'Reloaded editor did not report its state: '+stdout.slice(-500));
 const result=JSON.parse(match[1]);assert.equal(result.restored,true,JSON.stringify(result));assert.equal(result.ready,true);
 assert.match(result.notice,/wiederhergestellt/);assert.equal(result.writes,1);
 console.log('Chromium restored the interrupted form after a real reload with no additional write.');
}finally{server.close();await rm(profile,{recursive:true,force:true});}
