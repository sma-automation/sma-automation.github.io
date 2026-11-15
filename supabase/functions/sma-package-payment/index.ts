import {createPaymentHandler} from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const endpoint='https://johnmusic.app.n8n.cloud/webhook/sma-paket-dienst-v1';
const secret=await crypto.subtle.importKey('raw',new TextEncoder().encode(service),{name:'HMAC',hash:'SHA-256'},false,['sign']);
async function post(url:string,headers:Record<string,string>,data:unknown,timeout=12000){
 const r=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(timeout),body:JSON.stringify(data)});
 if(!r.ok)throw Error('SERVICE_UNAVAILABLE');
 return r.json();
}
const rpc=(name:string,apikey:string,auth:string,data:unknown)=>post(base+'/rest/v1/rpc/'+name,{apikey,Authorization:auth},data);
const internal=(name:string,data:unknown)=>rpc(name,service,'Bearer '+service,data);
Deno.serve(createPaymentHandler({
 callback:base+'/functions/v1/sma-package-payment',
 signature:async(id:string)=>Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',secret,new TextEncoder().encode('sma-package-payment-v1/'+id))),b=>b.toString(16).padStart(2,'0')).join(''),
 authorize:async(auth:string,owner:string,order:string)=>{
   const r=await rpc('sma_onboarding_booking_v1',anon,auth,{p_owner:owner});
   return r?.ok===true && r.offer?.automated===true && r.offer.id===order && ['booked','paid'].includes(r.offer.state);
 },
 worker:(id:string,lease:string,action:string,data:unknown)=>internal('sma_package_worker_v1',{p_id:id,p_lease:lease,p_action:action,p_data:data}),
 bridge:async(op:string,data:unknown)=>{
   const ticket=await internal('sma_package_ticket_v1',{p_job:{op,data}});
   const result=await post(endpoint,{}, {ticket},25000);
   if(result?.ok!==true)throw Error('WORKER_UNAVAILABLE');
   return result.value;
 }
}));
