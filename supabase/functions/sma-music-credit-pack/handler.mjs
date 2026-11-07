const sku='sma-music-10-v1',amount={currency:'EUR',value:'10.00'};
const orderId=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const paymentId=/^tr_[A-Za-z0-9]{1,64}$/;
const site='https://sma-automation.com';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':site,
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export function checkoutLink(value){
 const u=new URL(value);
 if(!['www.mollie.com','checkout.mollie.com'].includes(u.hostname)||u.protocol!=='https:'||u.port||u.username||u.password)throw Error('INVALID_CHECKOUT');
 return u.href;
}
export function createPackHandler({mollie,userStart,record,signature,enabled,endpoint,now=Date.now}){
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const url=new URL(request.url);
  if(request.method==='GET')return response({enabled});
  if(request.method!=='POST')return response({ok:false},405);
  if(!enabled)return response({ok:false,code:'CHECKOUT_UNAVAILABLE'},503);
  try{
   if(url.searchParams.has('order')){
    const id=url.searchParams.get('order'),proof=url.searchParams.get('proof');
    if(!orderId.test(id)||proof!==await signature(id))return response({ok:false},403);
    if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return response({ok:false},400);
    const input=await request.text();
    if(input.length>160)return response({ok:false},400);
    const pid=new URLSearchParams(input).get('id');
    if(!paymentId.test(pid))return response({ok:false},400);
    // The callback body never supplies amount, owner or settlement status.
    const receipt=await mollie('GET',pid);
    if(receipt.id!==pid)return response({ok:false},409);
    const accepted=await record(id,receipt);
    return response({ok:accepted.ok===true},accepted.ok?200:409);
   }
   const auth=request.headers.get('authorization');
   if(!/^Bearer [^\s]+$/.test(auth||''))return response({ok:false,code:'AUTH_REQUIRED'},401);
   const pack=await userStart(auth);
   if(!pack.ok||!orderId.test(pack.id))return response({ok:false,code:pack.code||'CHECKOUT_UNAVAILABLE'},403);
   let receipt;
   if(pack.payment_id){
    if(!paymentId.test(pack.payment_id))throw Error('INVALID_PAYMENT');
    receipt=await mollie('GET',pack.payment_id);
    if(receipt.id!==pack.payment_id)throw Error('INVALID_PAYMENT');
   }else{
    // A lost create response is retried only inside Mollie's idempotency window.
    const age=now()-Date.parse(pack.created_at);
    if(!Number.isFinite(age)||age< -60000||age>15*60000)return response({ok:false,code:'CHECKOUT_RECONCILE'},409);
    const callback=new URL(endpoint);callback.searchParams.set('order',pack.id);callback.searchParams.set('proof',await signature(pack.id));
    receipt=await mollie('POST',null,{amount,description:'SMA · 10 Musik-Credits',sequenceType:'oneoff',
     metadata:{product:sku,order:pack.id},redirectUrl:site+'/app/dashboard.html',webhookUrl:callback.href},pack.id);
   }
   const settled=await record(pack.id,receipt);
   if(!settled.ok)return response({ok:false,code:'CHECKOUT_UNAVAILABLE'},409);
   if(settled.state!=='open')return response({ok:true,state:settled.state});
   if(!receipt._links?.checkout?.href)return response({ok:true,state:'pending'});
   return response({ok:true,checkout:checkoutLink(receipt._links.checkout.href)});
  }catch{return response({ok:false,code:'CHECKOUT_UNAVAILABLE'},503);}
 };
}
