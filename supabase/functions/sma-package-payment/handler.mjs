import {assessRenewal} from './renewal.mjs';
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
function hasFolderMapping(row){
  return ['upload_folder_id','processing_folder_id'].every(key=>typeof row?.[key]==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(row[key]))&&
    row.upload_folder_id!==row.processing_folder_id;
}
function matchingSub(sub,o){
  return sub && sid.test(sub.id) && sub.mode==='live' && sub.customerId===o.merchant_customer &&
    sub.metadata?.order===o.id && sub.metadata?.kunde_id===o.n8n_ref && sub.metadata?.paket===o.plan &&
    sub.amount?.value===prices[o.plan] && sub.amount?.currency==='EUR' && sub.interval==='1 month';
}

export function createPaymentHandler({authorize,worker,bridge,renewal,consumeRenewal,schedule,signature,callback,now=Date.now,newId=()=>crypto.randomUUID()}){
  const response=(status,code)=>new Response(JSON.stringify({code}),{status,headers});
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return response(405,'METHOD');
    const url=new URL(request.url);let id,lease,locked=false;
    try{
      let event=null;
      const scheduled=url.searchParams.has('scheduled');
      const cycle=scheduled||url.searchParams.get('cycle')==='1';
      if(scheduled){
        if(url.search!=='?scheduled=1'||!request.headers.get('content-type')?.startsWith('application/json'))return response(400,'INVALID');
        const input=await request.text();
        if(input.length>100)return response(400,'INVALID');
        let body;try{body=JSON.parse(input);}catch{return response(400,'INVALID');}
        if(typeof body?.ticket!=='string'||!uuid.test(body.ticket)||Object.keys(body).length!==1)return response(400,'INVALID');
        id=await schedule.claim(body.ticket);
        if(typeof id!=='string'||!uuid.test(id))return response(403,'DENIED');
      }else if(url.searchParams.has('order')){
        id=url.searchParams.get('order');
        if(!uuid.test(id)||url.searchParams.get('proof')!==await signature(cycle?'renewal/'+id:id))return response(403,'DENIED');
        if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return response(400,'INVALID');
        const body=await request.text();if(body.length>150)return response(400,'INVALID');
        event=new URLSearchParams(body).get('id');if(!pid.test(event))return response(400,'INVALID');
      }else{
        if(cycle)return response(403,'DENIED');
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
      if(scheduled && (!['active','paid','reversed'].includes(o.state)||!o.payment_id||!o.merchant_customer||!o.subscription_id))return response(409,'INELIGIBLE');
      let checkOn=null;
      const finish=async(code)=>{
        requireValue(await schedule.record(id,lease,code,checkOn));
        return response(200,code);
      };
      if(o.state==='closed')return response(200,'CLOSED');
      if(cycle && (!o.payment_id||!o.subscription_id))return response(503,'RETRY');
      if(!cycle && event && o.payment_id && event!==o.payment_id)return response(409,'MISMATCH');
      if(event && !o.merchant_customer)return response(503,'RETRY');
      const account=()=>bridge('account',{row:o.n8n_row_id,ref:o.n8n_ref,email:o.email});
      if(!o.payment_id&&!event){
        const row=await account();requireValue(sameAccount(row,o)&&dormant(row)&&hasFolderMapping(row));
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
        const requested=cycle?o.payment_id:(event||o.payment_id);
        p=await bridge('payment',{payment:requested});requireValue(p.id===requested);
      }else{
        // Customer creation may have taken time; recheck before creating the first payment.
        const row=await account();requireValue(sameAccount(row,o)&&dormant(row)&&hasFolderMapping(row));
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
        if(o.subscription_id)return await finish('REVERSED');
        return response(200,'REVERSED');
      }
      if(state==='BOOKED'||state==='CLOSED'||(state==='ACTIVE'&&!cycle))return response(200,state);
      const today=new Date(now()).toISOString().slice(0,10);
      const reconcile=async(sub,notification)=>{
        const call=async(action,data)=>{
          const result=await renewal(id,lease,action,data);requireValue(result && !result.error);return result;
        };
        const assessment=await assessRenewal({order:o,sub,event:notification,today,readPage:async cursor=>{
          const {ticket}=await call('renewals',{cursor});requireValue(uuid.test(ticket));return consumeRenewal(ticket);
        }});
        const {decision}=assessment;checkOn=assessment.checkOn;
        if(state!=='ACTIVE')return decision;
        if(['WAIT','REVIEW'].includes(decision)&&!o.renewal_suspended)return decision;
        const row=await account();
        const action=decision==='ACTIVE'?'restore':'suspend';
        let result=await call(action,{row});
        if(result.state==='REVIEW'){checkOn=null;return 'REVIEW';}
        if(result.state==='ACTIVE')return 'ACTIVE';
        if(result.state==='RESTORE'){
          requireValue(uuid.test(result.ticket));await consumeRenewal(result.ticket);
          const after=await account();requireValue(activated(after,o));
          result=await call('restore',{row:after});requireValue(result.state==='ACTIVE');return 'ACTIVE';
        }
        requireValue(result.state==='SUSPEND');
        if(activated(row,o))await bridge('disable',{row:o.n8n_row_id,ref:o.n8n_ref,email:o.email,customer:o.merchant_customer,subscription:o.subscription_id,plan:o.plan});
        const after=await account();
        requireValue(sameAccount(after,o)&&after.paket===o.plan&&after.mollie_subscription_id===o.subscription_id&&
          after.mollie_customer_id===o.merchant_customer&&after.zugang_aktiv===false&&after.zahlung_bestaetigt===false);
        return decision==='REVIEW'?'REVIEW':'SUSPENDED';
      };
      if(cycle && state==='ACTIVE'){
        requireValue(receipt.status==='paid'&&!receipt.reversed&&typeof receipt.paid_at==='string');
        const sub=await bridge('subscription',{customer:o.merchant_customer,subscription:o.subscription_id});
        requireValue(matchingSub(sub,o)&&sub.id===o.subscription_id&&sub.startDate===nextMonth(receipt.paid_at));
        return await finish(await reconcile(sub,event));
      }
      requireValue(state==='PAID' && receipt.status==='paid' && !receipt.reversed && typeof receipt.paid_at==='string');
      const startDate=nextMonth(receipt.paid_at);
      let row=await account();
      requireValue(sameAccount(row,o)&&(dormant(row)||activated(row,o))&&hasFolderMapping(row));
      if(!o.subscription_id){
        requireValue(startDate>new Date(now()).toISOString().slice(0,10));
        o=await write('begin_subscription');
        eligibleTime(o.sub_started,now);
        const renewalHook=new URL(callback);
        renewalHook.searchParams.set('order',id);renewalHook.searchParams.set('cycle','1');
        renewalHook.searchParams.set('proof',await signature('renewal/'+id));
        const created=await bridge('subscribe',{order:id,customer:o.merchant_customer,body:{amount,interval:'1 month',startDate,
          description:'SMA '+o.plan.toUpperCase()+' – Monatsabo',metadata:{order:id,kunde_id:o.n8n_ref,paket:o.plan},
          webhookUrl:renewalHook.href}});
        requireValue(matchingSub(created,o));
        o=await write('subscription',{id:created.id});
      }
      // A replayed creation response can be cached. Verify the stored subscription itself.
      const sub=await bridge('subscription',{customer:o.merchant_customer,subscription:o.subscription_id});
      requireValue(matchingSub(sub,o) && sub.id===o.subscription_id && sub.startDate===startDate);
      const firstMonthPaid=startDate>today;
      const startConfirmed=sub.status==='pending' && sub.nextPaymentDate===startDate;
      if(firstMonthPaid && cycle && event)await reconcile(sub,event);
      if(firstMonthPaid ? (sub.status!=='active' && !startConfirmed) : (await reconcile(sub,cycle?event:null)!=='ACTIVE')){
        // Let Mollie retry while an authenticated customer sees their confirmed payment.
        if(scheduled){checkOn=null;return await finish('PAID');}
        return event ? response(503,'RETRY') : response(200,'PAID');
      }
      // First activation needs the current mapping after the provider calls.
      // Existing active, reversal and renewal paths above remain independent of it.
      row=await account();
      requireValue(sameAccount(row,o)&&(dormant(row)||activated(row,o))&&hasFolderMapping(row));
      const folders={upload_folder_id:row.upload_folder_id,processing_folder_id:row.processing_folder_id};
      if(!activated(row,o)){
        await bridge('activate',{row:o.n8n_row_id,ref:o.n8n_ref,email:o.email,customer:o.merchant_customer,
          subscription:o.subscription_id,plan:o.plan,token:newId()+newId(),...folders});
        row=await account();
      }
      requireValue(activated(row,o)&&row.upload_folder_id===folders.upload_folder_id&&row.processing_folder_id===folders.processing_folder_id);
      const final=await write('receipt',{receipt,row});
      requireValue(final.state==='ACTIVE');
      if(firstMonthPaid)checkOn=startDate;
      return await finish('ACTIVE');
    }catch{return response(503,'RETRY');}
    finally{if(locked){try{await worker(id,lease,'release',{});}catch{/* An abandoned lease expires. */}}}
  };
}
