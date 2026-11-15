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
  let subscription, dueDate=null, creations=0, activations=0;
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
    signature:async()=>'fixture',authorize:async()=>false,
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
}
