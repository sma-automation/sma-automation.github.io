import {createPackHandler} from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const merchant=Deno.env.get('SMA_MUSIC_MOLLIE_KEY')||'';
const secret=await crypto.subtle.importKey('raw',new TextEncoder().encode(service),{name:'HMAC',hash:'SHA-256'},false,['sign']);
async function rpc(name:string,auth:string,key:string,body:unknown){
 const res=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{
  apikey:key,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(!res.ok)throw Error('RPC_UNAVAILABLE');
 return res.json();
}
Deno.serve(createPackHandler({
 enabled:merchant.startsWith('live_'),endpoint:base+'/functions/v1/sma-music-credit-pack',
 signature:async(id:string)=>Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',secret,new TextEncoder().encode('music-credit-pack:'+id))),b=>b.toString(16).padStart(2,'0')).join(''),
 userStart:(auth:string)=>rpc('sma_music_credits_v1',auth,anon,{p_action:'start',p_input:{}}),
 record:(id:string,r:Record<string,unknown>)=>{
  const receipt=Object.fromEntries(['id','mode','status','amount','metadata','amountRefunded','amountChargedBack'].filter(k=>k in r).map(k=>[k,r[k]]));
  return rpc('sma_music_pack_receipt_v1','Bearer '+service,service,{p_id:id,p_receipt:receipt});
 },
 mollie:async(method:string,id:string|null,body?:unknown,requestId?:string)=>{
  const headers:Record<string,string>={Authorization:'Bearer '+merchant,'Content-Type':'application/json'};
  if(requestId)headers['Idempotency-Key']=requestId;
  const r=await fetch('https://api.mollie.com/v2/payments'+(id?'/'+encodeURIComponent(id):''),{
   method,headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('PAYMENT_UNAVAILABLE');
  return r.json();
 }
}));
