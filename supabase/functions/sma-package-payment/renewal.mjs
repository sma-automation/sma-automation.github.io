// UTC billing dates, anchored to the subscription start day including short months.
function monthDate(anchor,offset){
  const d=new Date(anchor+'T00:00:00Z'), day=d.getUTCDate();
  d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+offset+1);d.setUTCDate(0);
  d.setUTCDate(Math.min(day,d.getUTCDate()));return d.toISOString().slice(0,10);
}
function valid(ok){if(!ok)throw Error('INVALID_RENEWAL');}
function utcDay(timestamp){
  valid(typeof timestamp==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(timestamp));
  valid(monthDate(timestamp.slice(0,10),0)===timestamp.slice(0,10));
  return new Date(timestamp).toISOString().slice(0,10);
}
function period(anchor,day){
  const count=(Number(day.slice(0,4))-Number(anchor.slice(0,4)))*12+Number(day.slice(5,7))-Number(anchor.slice(5,7));
  const offset=monthDate(anchor,count)>day?count-1:count;
  return [monthDate(anchor,offset),monthDate(anchor,offset+1)];
}
function cents(money){
  if(money===undefined)return 0;
  valid(money?.currency==='EUR' && typeof money.value==='string' && /^\d{1,7}\.\d{2}$/.test(money.value));
  return Number(money.value.replace('.',''));
}
export async function renewalDecision({order,sub,event,today,readPage}){
  const anchor=sub.startDate;
  valid(/^\d{4}-\d\d-\d\d$/.test(anchor)&&monthDate(anchor,0)===anchor);
  const [start]=period(anchor,today);
  let cursor=null,found=false,covered=false,pending=false,failed=false,review=false;
  const seen=new Set(),cursors=new Set();
  do{
    const page=await readPage(cursor);
    valid(Array.isArray(page?.payments)&&page.payments.length<=50 && (page.next===null||/^tr_[A-Za-z0-9]{1,64}$/.test(page.next)));
    for(const p of page.payments){
      valid(/^tr_[A-Za-z0-9]{1,64}$/.test(p.id)&&!seen.has(p.id)&&p.id!==order.payment_id&&p.mode==='live'&&p.sequenceType==='recurring'&&
        p.customerId===order.merchant_customer&&p.subscriptionId===order.subscription_id&&p.amount?.currency==='EUR'&&p.amount.value===sub.amount.value);
      for(const [key,value] of Object.entries({order:order.id,kunde_id:order.n8n_ref,paket:order.plan}))valid(p.metadata?.[key]===undefined||p.metadata[key]===value);
      seen.add(p.id);if(p.id===event)found=true;
      const created=utcDay(p.createdAt);
      valid(created<=today && ['paid','open','pending','authorized','failed','expired','canceled'].includes(p.status));
      if(created<anchor)continue;
      const [cycle,end]=period(anchor,created);
      const retryEnd=monthDate(created,1);
      if(p.status==='paid'){
        const paid=utcDay(p.paidAt);valid(paid<=today && Date.parse(p.paidAt)>=Date.parse(p.createdAt));
        const refunded=cents(p.amountRefunded), chargedBack=cents(p.amountChargedBack),total=cents(p.amount);
        // A later successful retry can cover days beyond the original monthly boundary.
        if(today>=end && today>=retryEnd)continue;
        if(chargedBack>0 || refunded>=total)failed=true;
        else if(refunded>0)review=true;
        else covered=true;
      }else if(cycle===start){
        if(['open','pending','authorized'].includes(p.status))pending=true;else failed=true;
      }
    }
    cursor=page.next;
    if(cursor){valid(!cursors.has(cursor)&&cursors.size<9);cursors.add(cursor);}
  }while(cursor);
  valid(!event||found);
  if(today<anchor)return 'WAIT';
  if(covered)return 'ACTIVE';
  if(review)return 'REVIEW';
  if(pending||!failed)return 'WAIT';
  return 'SUSPEND';
}
