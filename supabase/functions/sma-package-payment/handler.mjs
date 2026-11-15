const prices={alpha:'100.00',beta:'300.00',delta:'500.00'};
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const pid=/^tr_[A-Za-z0-9]{1,64}$/, cid=/^cst_[A-Za-z0-9]{1,64}$/, sid=/^sub_[A-Za-z0-9]{1,64}$/;
const site='https://sma-automation.com';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':site,
  'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
function requireValue(ok){if(!ok)throw Error('CHECK_REQUIRED');}
function nextMonth(paidAt){
  const date=new Date(paidAt);const day=date.getUTCDate();
  date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+2);date.setUTCDate(0);
  date.setUTCDate(Math.min(day,date.getUTCDate()));return date.toISOString().slice(0,10);
}
function reversal(money){
  if(money===undefined)return false;
  requireValue(money?.currency==='EUR' && typeof money.value==='string' && /^\d+\.\d{2}$/.test(money.value));
  return !/^0+\.00$/.test(money.value);
}
function eligibleTime(timestamp,now){
  const elapsed=now()-Date.parse(timestamp);
  requireValue(Number.isFinite(elapsed)&&elapsed>=-60000&&elapsed<50*60_000);
}
function projectPayment(p,o){
  requireValue(p && pid.test(p.id) && (!o.payment_id||p.id===o.payment_id) && p.metadata?.order===o.id &&
    p.metadata?.sma_onboarding_ref===o.n8n_ref && p.metadata?.kunde_id===undefined && p.metadata?.paket===o.plan && p.mode==='live' && p.sequenceType==='first' &&
    p.customerId===o.merchant_customer && p.amount?.value===prices[o.plan] && p.amount?.currency==='EUR');
  return {id:p.id,ref:o.n8n_ref,plan:o.plan,customer:p.customerId,mode:p.mode,sequence:p.sequenceType,
    value:p.amount.value,currency:'EUR',status:p.status,expires:p.expiresAt,paid_at:p.paidAt,
    reversed:reversal(p.amountRefunded)||reversal(p.amountChargedBack),checkout:p._links?.checkout?.href};
}
function sameAccount(row,o){
  return row && row.id===o.n8n_row_id && row.kunde_id===o.n8n_ref && row.kunde_email===o.email && row.demo_delta_aktiv===false;
}
function dormant(row){
  return row.zugang_aktiv===false && row.zahlung_bestaetigt===false && !row.paket &&
    !row.mollie_customer_id && !row.mollie_subscription_id && row.has_access_token===false;
}
function activated(row,o){
  return sameAccount(row,o)&&row.zugang_aktiv===true&&row.zahlung_bestaetigt===true&&row.has_access_token===true&&
    row.paket===o.plan&&row.mollie_customer_id===o.merchant_customer&&row.mollie_subscription_id===o.subscription_id;
}
function matchingSub(sub,o){
  return sub && sid.test(sub.id) && sub.mode==='live' && sub.customerId===o.merchant_customer &&
    sub.metadata?.order===o.id && sub.metadata?.kunde_id===o.n8n_ref && sub.metadata?.paket===o.plan &&
    sub.amount?.value===prices[o.plan] && sub.amount?.currency==='EUR' && sub.interval==='1 month';
}

export function createPaymentHandler({authorize,worker,bridge,signature,callback,now=Date.now,newId=()=>crypto.randomUUID()}){
  const response=(status,code)=>new Response(JSON.stringify({code}),{status,headers});
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return response(405,'METHOD');
    const url=new URL(request.url);let id,lease,locked=false;
    try{
      let event=null;
      if(url.searchParams.has('order')){
        id=url.searchParams.get('order');
        if(!uuid.test(id)||url.searchParams.get('proof')!==await signature(id))return response(403,'DENIED');
        if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return response(400,'INVALID');
        const body=await request.text();if(body.length>150)return response(400,'INVALID');
        event=new URLSearchParams(body).get('id');if(!pid.test(event))return response(400,'INVALID');
      }else{
        const auth=request.headers.get('authorization');
        if(!/^Bearer \S+$/.test(auth||''))return response(401,'AUTH');
        const body=await request.json();id=body?.order;
        if(!uuid.test(id)||!uuid.test(body?.owner)||!await authorize(auth,body.owner,id))return response(403,'DENIED');
      }
      lease=newId();
      const write=async(action,data={})=>{
        const r=await worker(id,lease,action,data);if(r?.error)throw Error(r.error);return r;
      };
      let o=await write('lock');locked=true;
      requireValue(o.id===id&&Object.hasOwn(prices,o.plan)&&o.automated===true);
      if(o.state==='closed')return response(200,'CLOSED');
      if(event && o.payment_id && event!==o.payment_id)return response(409,'MISMATCH');
      if(event && !o.merchant_customer)return response(503,'RETRY');
      const account=()=>bridge('account',{row:o.n8n_row_id,ref:o.n8n_ref,email:o.email});
      if(!o.payment_id&&!event){
        const row=await account();requireValue(sameAccount(row,o)&&dormant(row));
        eligibleTime(o.first_started,now);
        if(!o.merchant_customer){
          const c=await bridge('customer',{order:id,ref:o.n8n_ref,email:o.email});
          requireValue(cid.test(c.id)&&c.metadata?.order===id&&c.email===o.email);
          o=await write('customer',{id:c.id});
        }
      }
      requireValue(cid.test(o.merchant_customer));
      const metadata={order:id,sma_onboarding_ref:o.n8n_ref,paket:o.plan};
      const amount={value:prices[o.plan],currency:'EUR'};
      const hook=new URL(callback);hook.searchParams.set('order',id);hook.searchParams.set('proof',await signature(id));
      let p;
      if(event||o.payment_id){
        const requested=event||o.payment_id;
        p=await bridge('payment',{payment:requested});requireValue(p.id===requested);
      }else{
        eligibleTime(o.first_started,now);
        p=await bridge('first',{order:id,body:{customerId:o.merchant_customer,amount,sequenceType:'first',
          description:'SMA '+o.plan.toUpperCase()+' – Monatsabo',redirectUrl:site+'/app/paketwahl.html?buchung='+id,
          webhookUrl:hook.href,metadata}});
      }
      const receipt=projectPayment(p,o);
      if(receipt.status==='open')requireValue(/^https:\/\/(www|checkout)\.mollie\.com\/checkout\/[A-Za-z0-9/_-]+$/.test(receipt.checkout));
      const payable=receipt.status==='open';
      if(!o.payment_id || (o.state==='booked' && ['open','pending','authorized'].includes(receipt.status))){
        const expires=payable ? (receipt.expires??new Date(now()+15*60_000).toISOString()) : null;
        o=await write('payment',{id:p.id,checkout:payable?receipt.checkout:null,expires});
      }
      const {state}=await write('receipt',{receipt});
      if(state==='REVERSED'){
        const row=await account();
        if(activated(row,o))await bridge('disable',{row:o.n8n_row_id,ref:o.n8n_ref,email:o.email,customer:o.merchant_customer,subscription:o.subscription_id,plan:o.plan});
        const after=await account();
        requireValue(sameAccount(after,o)&&after.zugang_aktiv===false&&after.zahlung_bestaetigt===false);
        return response(200,'REVERSED');
      }
      if(['BOOKED','ACTIVE','CLOSED'].includes(state))return response(200,state);
      requireValue(state==='PAID' && receipt.status==='paid' && !receipt.reversed && typeof receipt.paid_at==='string');
      const startDate=nextMonth(receipt.paid_at);
      let row=await account();
      requireValue(sameAccount(row,o)&&(dormant(row)||activated(row,o)));
      if(!o.subscription_id){
        requireValue(startDate>new Date(now()).toISOString().slice(0,10));
        o=await write('begin_subscription');
        eligibleTime(o.sub_started,now);
        const created=await bridge('subscribe',{order:id,customer:o.merchant_customer,body:{amount,interval:'1 month',startDate,
          description:'SMA '+o.plan.toUpperCase()+' – Monatsabo',metadata:{order:id,kunde_id:o.n8n_ref,paket:o.plan},
          webhookUrl:'https://johnmusic.app.n8n.cloud/webhook/sma-mollie-zahlung-status'}});
        requireValue(matchingSub(created,o));
        o=await write('subscription',{id:created.id});
      }
      // A replayed creation response can be cached. Verify the stored subscription itself.
      const sub=await bridge('subscription',{customer:o.merchant_customer,subscription:o.subscription_id});
      requireValue(matchingSub(sub,o) && sub.id===o.subscription_id && sub.startDate===startDate);
      const firstMonthPaid=startDate>new Date(now()).toISOString().slice(0,10);
      const scheduled=sub.status==='pending' && sub.nextPaymentDate===startDate;
      if(!firstMonthPaid || (sub.status!=='active' && !scheduled)){
        // Let Mollie retry while an authenticated customer sees their confirmed payment.
        return event ? response(503,'RETRY') : response(200,'PAID');
      }
      if(!activated(row,o)){
        await bridge('activate',{row:o.n8n_row_id,ref:o.n8n_ref,email:o.email,customer:o.merchant_customer,
          subscription:o.subscription_id,plan:o.plan,token:newId()+newId()});
        row=await account();
      }
      requireValue(activated(row,o));
      const final=await write('receipt',{receipt,row});
      requireValue(final.state==='ACTIVE');return response(200,'ACTIVE');
    }catch{return response(503,'RETRY');}
    finally{if(locked){try{await worker(id,lease,'release',{});}catch{/* An abandoned lease expires. */}}}
  };
}
