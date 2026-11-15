import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPaymentHandler} from '../supabase/functions/sma-package-payment/handler.mjs';
import workerBuilder from '../n8n/package-payment/build-worker.cjs';

// Exercise the Edge handler, the installed SQL contract and the n8n response projection together.
// Only the provider and the customer data table are substituted.
export async function checkScheduledSubscription({db,order,receipt,account}) {
  const reference={httpHeaderAuth:{id:'fixture'}};
  const {nodes}=workerBuilder.build({nodes:[
    {name:'SMA – Mollie – Erste Zahlung erstellen',credentials:reference},
    {name:'SMA – Supabase – Bestellung spiegeln',credentials:reference},
    {name:'SMA – Paketauswahl – Kunde prüfen',parameters:{dataTableId:{value:'fixture'}}}
  ]});
  const node=name=>nodes.find(n=>n.name===name);
  const project=new Function('$','$input',node('Antwort begrenzen').parameters.jsCode);
  const create=node('Mollie subscribe').parameters;
  assert.equal(create.method,'POST');
  assert.deepEqual(create.headerParameters.parameters,[{name:'Idempotency-Key',value:"={{ 'subscribe-'+$json.data.order }}"}]);
  assert.equal(node('Mollie subscription').parameters.method,'GET');
  const payment={id:receipt.id,mode:'live',customerId:receipt.customer,sequenceType:'first',status:'paid',
    amount:{currency:'EUR',value:receipt.value},paidAt:receipt.paid_at,
    metadata:{order, paket:receipt.plan, sma_onboarding_ref:receipt.ref}};
  const row={...account,demo_delta_aktiv:false,zahlung_bestaetigt:false,zugang_aktiv:false};
  let subscription, dueDate=null, creations=0, activations=0, restores=0, disables=0;
  let time=Date.now(), payments=[], loseRestore=false, loseDisable=false;
  const projectList=new Function('$','$input',node('Folgebelege begrenzen').parameters.jsCode);
  assert.equal(node('Mollie Abozahlungen lesen').parameters.method,'GET');
  const restoreParams=node('Bestehenden Zugang fortsetzen').parameters;
  assert.deepEqual(restoreParams.columns.value,{zugang_aktiv:true,zahlung_bestaetigt:true});
  assert.equal(restoreParams.matchType,'allConditions');
  const filters=Object.fromEntries(restoreParams.filters.conditions.map(f=>[f.keyName,f.condition??f.keyValue]));
  for(const key of ['id','kunde_id','kunde_email','paket','mollie_customer_id','mollie_subscription_id'])assert.ok(filters[key]?.includes('$json.data.'));
  assert.deepEqual([filters.zugangs_token,filters.demo_delta_aktiv,filters.zugang_aktiv,filters.zahlung_bestaetigt],['isNotEmpty','isFalse','isFalse','isFalse']);
  async function bridge(op,data) {
    let result;
    switch(op){
      case 'payment': assert.equal(data.payment,payment.id);result=payment;break;
      case 'account': assert.deepEqual(data,{row:row.id,ref:row.kunde_id,email:row.kunde_email});result=row;break;
      case 'subscribe':
        creations++;
        assert.equal(data.order,order);assert.equal(data.customer,receipt.customer);
        subscription={...data.body,id:'sub_scheduled',mode:'live',customerId:data.customer,status:'pending'};
        result=subscription;break;
      case 'subscription':
        assert.deepEqual(data,{customer:receipt.customer,subscription:subscription.id});
        result={...subscription,nextPaymentDate:dueDate};break;
      case 'disable':
        if(loseDisable){loseDisable=false;throw Error('disable interrupted');}
        assert.equal(data.subscription,subscription.id);disables++;
        Object.assign(row,{zugang_aktiv:false,zahlung_bestaetigt:false});result=row;break;
      case 'activate':
        activations++;
        Object.assign(row,{paket:data.plan,mollie_customer_id:data.customer,mollie_subscription_id:data.subscription,
          zugang_aktiv:true,zahlung_bestaetigt:true,zugangs_token:data.token});
        result=row;break;
      default: throw Error('Unbekannter Testvorgang '+op);
    }
    const item={json:result};
    const [reply]=project(()=>({first:()=>({json:{op}})}),{first:()=>item,all:()=>[item]});
    assert.equal(reply.json.ok,true);return reply.json.value;
  }
  const handler=createPaymentHandler({bridge,newId:randomUUID,callback:'https://fixture.invalid/pay',
    now:()=>time,signature:async id=>id.startsWith('renewal/')?'recurring-proof':'fixture',authorize:async()=>false,
    renewal:async(id,lease,action,data)=>(await db.query(
      'select public.sma_package_renewal_v1($1,$2,$3,$4) as result',[id,lease,action,data])).rows[0].result,
    consumeRenewal:async ticket=>{
      const {rows:[{job}]}=await db.query('select public.sma_package_ticket_v1($1,null) as job',[ticket]);
      let value;
      assert.equal(job.data.subscription,subscription.id);assert.equal(job.data.customer,receipt.customer);
      if(job.op==='restore'){
        assert.equal(job.data.row,row.id);assert.equal(row.zugang_aktiv,false);restores++;
        Object.assign(row,{zugang_aktiv:true,zahlung_bestaetigt:true});
        if(loseRestore){loseRestore=false;throw Error('restore response lost');}
        value=row;
      }else{
        assert.equal(job.op,'renewals');
        const index=job.data.cursor?payments.findIndex(p=>p.id===job.data.cursor):0;assert.ok(index>=0);
        const items=payments.slice(index,index+1);
        value={count:items.length,_embedded:{payments:items},_links:{next:payments[index+1]?{href:
          'https://api.mollie.com/v2/customers/'+receipt.customer+'/subscriptions/'+subscription.id+'/payments?from='+payments[index+1].id}:null}};
      }
      const [reply]=projectList(()=>({first:()=>({json:job})}),{first:()=>({json:value})});
      assert.equal(reply.json.ok,true);return reply.json.value;
    },
    worker:async(id,lease,action,data)=>(await db.query(
      'select public.sma_package_worker_v1($1,$2,$3,$4) as result',[id,lease,action,data])).rows[0].result
  });
  const notify=()=>handler(new Request('https://fixture.invalid/pay?order='+order+'&proof=fixture',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id='+payment.id
  }));
  assert.equal((await notify()).status,503);assert.equal(activations,0);
  dueDate=subscription.startDate;
  assert.deepEqual(await (await notify()).json(),{code:'ACTIVE'});
  assert.deepEqual(await (await notify()).json(),{code:'ACTIVE'});
  assert.equal(creations,1);assert.equal(activations,1);
  const bill=(id,status)=>({id,mode:'live',sequenceType:'recurring',subscriptionId:subscription.id,customerId:receipt.customer,
    amount:payment.amount,createdAt:new Date(time).toISOString(),status,...(status==='paid'?{paidAt:new Date(time).toISOString()}:{})});
  const cycle=(id,url=subscription.webhookUrl)=>handler(new Request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id='+id}));
  const code=async id=>(await (await cycle(id)).json()).code;
  const token=row.zugangs_token;
  assert.equal(new URL(subscription.webhookUrl).searchParams.get('cycle'),'1');
  assert.equal((await cycle('tr_failure',subscription.webhookUrl.replace('recurring-proof','fixture'))).status,403);
  time=Date.parse(subscription.startDate+'T12:00:00Z');
  payments=[bill('tr_failure','failed'),bill('tr_wait','pending')];
  assert.equal(await code('tr_failure'),'WAIT');assert.equal(row.zugang_aktiv,true);
  const customerStatus=async()=>{
    await db.exec('set local role authenticated');
    try{return (await db.query('select public.sma_onboarding_payment_status_v1($1) as state',[order])).rows[0].state;}
    finally{await db.exec('set local role service_role');}
  };
  payments.pop();loseDisable=true;
  assert.equal(await code('tr_failure'),'RETRY');assert.equal(row.zugang_aktiv,true);assert.equal(await customerStatus(),'renewal_suspended');
  assert.equal(await code('tr_failure'),'SUSPENDED');assert.equal(row.zugang_aktiv,false);
  assert.equal(await code('tr_failure'),'SUSPENDED');assert.equal(disables,1);
  payments.push(bill('tr_retry','paid'));loseRestore=true;
  assert.equal(await code('tr_failure'),'RETRY');assert.equal(row.zugang_aktiv,true);
  assert.equal(await code('tr_retry'),'ACTIVE');assert.equal(restores,1);assert.equal(await customerStatus(),'active');
  assert.equal(await code('tr_failure'),'ACTIVE');assert.equal(row.zugangs_token,token);
  assert.equal(await code('tr_foreign'),'RETRY');
  payments[1].amountRefunded={currency:'EUR',value:'5.00'};
  assert.equal(await code('tr_retry'),'REVIEW');assert.equal(disables,1);
  payments[1].amountChargedBack=payment.amount;
  assert.equal(await code('tr_retry'),'SUSPENDED');assert.equal(row.zugang_aktiv,false);
  payments.push(bill('tr_replacement','paid'));assert.equal(await code('tr_replacement'),'ACTIVE');
  assert.equal(row.zugang_aktiv,true);assert.equal(activations,1);assert.equal(creations,1);
  Object.assign(row,{zugang_aktiv:false,zahlung_bestaetigt:false}); // Separate operator suspension.
  assert.equal(await code('tr_replacement'),'REVIEW');assert.equal(row.zugang_aktiv,false);
  Object.assign(row,{zugang_aktiv:true,zahlung_bestaetigt:true});
}
