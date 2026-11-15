// Private pilot operator. Reads Mollie and prints a SQL statement for the private SQL editor.
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';

const price = {alpha:'100.00', beta:'300.00', delta:'500.00'};
const paymentId = /^tr_[A-Za-z0-9]{1,64}$/;
const customerId = /^cst_[A-Za-z0-9]{1,64}$/;
const subscriptionId = /^sub_[A-Za-z0-9]{1,64}$/;

function reversed(money) {
  if (money === undefined) return false;
  if (money?.currency !== 'EUR' || typeof money.value !== 'string' || !/^\d+\.\d{2}$/.test(money.value)) throw Error('Ungültiger Rückzahlungsbetrag.');
  return !/^0+\.00$/.test(money.value);
}

const literal = obj => "convert_from(decode('"+Buffer.from(JSON.stringify(obj)).toString('hex')+"','hex'),'UTF8')::jsonb";

export async function preparePaymentSync(id, account, read) {
  if (!paymentId.test(id)) throw Error('Mollie-Zahlungs-ID prüfen.');
  const p = await read('/payments/'+id);
  const plan = p?.metadata?.paket;
  if (p?.id !== id || p.mode !== 'live' || p.sequenceType !== 'first' || !customerId.test(p.customerId) ||
      !/^kunde_[0-9a-f]{32}$/.test(p.metadata?.kunde_id) || !Object.hasOwn(price,plan) ||
      p.amount?.currency !== 'EUR' || p.amount.value !== price[plan]) throw Error('Erstzahlung passt nicht zur Paketbuchung.');
  const receipt = {id, ref:p.metadata.kunde_id, plan, customer:p.customerId, mode:p.mode, sequence:p.sequenceType,
    value:p.amount.value,currency:p.amount.currency,status:p.status,expires:p.expiresAt,paid_at:p.paidAt,
    reversed:reversed(p.amountRefunded)||reversed(p.amountChargedBack),checkout:p._links?.checkout?.href};
  if (account) {
    if (receipt.reversed || p.status !== 'paid' || !subscriptionId.test(account.mollie_subscription_id) ||
        account.mollie_customer_id !== p.customerId || account.kunde_id !== receipt.ref || account.paket !== plan)
      throw Error('n8n-Zuordnung oder Zahlungsstatus prüfen.');
    const sub = await read('/customers/'+p.customerId+'/subscriptions/'+account.mollie_subscription_id);
    if (sub.id !== account.mollie_subscription_id || sub.status !== 'active' || sub.interval !== '1 month' ||
        sub.amount?.value !== price[plan] || sub.amount?.currency !== 'EUR' ||
        sub.metadata?.kunde_id !== receipt.ref || sub.metadata?.paket !== plan)
      throw Error('Das aktive Monatsabo passt nicht zum Kunden und Paket.');
  }
  return 'select sma_private.sync_onboarding_booking_v1('+literal(receipt)+','+(account?literal(account):'null')+');';
}

const recurringStatuses = new Set(['open','pending','authorized','paid','failed','expired','canceled']);
const orderId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function providerTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10) !== value.slice(0,10))
    throw Error('Zeitpunkt der Mollie-Zahlung prüfen.');
  return new Date(value).toISOString();
}

// Match a single merchant receipt to the subscription and then to the stored booking.
// Older receipts remain valid evidence for that transaction, including after cancellation.
export async function prepareRenewalCheck(id, read) {
  if (!paymentId.test(id)) throw Error('Mollie-Zahlungs-ID prüfen.');
  const p = await read('/payments/'+id);
  if (p?.id !== id || p.mode !== 'live' || p.sequenceType !== 'recurring' ||
      typeof p.customerId !== 'string' || !customerId.test(p.customerId) ||
      typeof p.subscriptionId !== 'string' || !subscriptionId.test(p.subscriptionId) || !recurringStatuses.has(p.status))
    throw Error('Keine zuordenbare Live-Folgezahlung.');
  const sub = await read('/customers/'+p.customerId+'/subscriptions/'+p.subscriptionId);
  const {order, kunde_id:ref, paket:plan} = sub?.metadata ?? {};
  if (sub?.id !== p.subscriptionId || sub.customerId !== p.customerId || sub.mode !== 'live' || sub.interval !== '1 month' ||
      typeof order !== 'string' || !orderId.test(order) || typeof ref !== 'string' || !/^kunde_[0-9a-f]{32}$/.test(ref) ||
      typeof plan !== 'string' || !Object.hasOwn(price,plan) ||
      sub.amount?.currency !== 'EUR' || sub.amount.value !== price[plan] ||
      p.amount?.currency !== 'EUR' || p.amount.value !== price[plan])
    throw Error('Abo, Händlerkonto oder Paketbetrag stimmen nicht überein.');
  for (const [key, expected] of Object.entries({order,kunde_id:ref,paket:plan})) {
    if (p.metadata?.[key] !== undefined && p.metadata[key] !== expected)
      throw Error('Die Zahlungsdaten widersprechen der Abo-Zuordnung.');
  }
  const chargeback = reversed(p.amountChargedBack);
  const refund = reversed(p.amountRefunded);
  const created = providerTime(p.createdAt);
  const paid = p.paidAt == null ? null : providerTime(p.paidAt);
  if ((p.status === 'paid' && !paid) || (paid && paid < created)) throw Error('Zahlungszeitpunkt prüfen.');
  const receipt = {id,order,ref,plan,customer:p.customerId,subscription:p.subscriptionId,created,paid,
    status:p.status,refund:refund ? p.amountRefunded.value : '0.00',chargeback:chargeback ? p.amountChargedBack.value : '0.00'};

  return `with beleg as (select ${literal(receipt)} as p)
select case when b.id is null then 'NICHT_ZUGEORDNET' else 'ZUGEORDNET' end as zuordnung,
       case when b.id is not null then p->>'status' end as zahlungsstatus,
       case when b.id is not null then p->>'created' end as zahlung_erstellt_utc,
       case when b.id is not null then p->>'paid' end as zahlung_bezahlt_utc,
       case when b.id is not null then p->>'refund' end as erstattet_eur,
       case when b.id is not null then p->>'chargeback' end as rueckgebucht_eur,
       case when b.id is not null then b.state end as buchungsstatus,
       case when b.id is null then null
            when r.customer_id is null or c.id is null or c.demo_delta_aktiv is distinct from false
              or c.n8n_kunde_id is distinct from b.n8n_ref or c.kunde_email is distinct from b.email then 'PRUEFEN'
            when c.aktiv is true and c.zahlung_bestaetigt is true and c.paket=b.plan then 'AKTIV'
            when c.aktiv is false and c.zahlung_bestaetigt is false then 'GESPERRT'
            else 'PRUEFEN' end as website_zugang
from beleg
left join sma_private.onboarding_package_bookings_v1 b on b.id=(p->>'order')::uuid
  and b.automated and b.plan=p->>'plan' and b.n8n_ref=p->>'ref'
  and b.merchant_customer=p->>'customer' and b.subscription_id=p->>'subscription'
  and b.payment_id<>p->>'id' and b.booked_at<=(p->>'created')::timestamptz
left join public.sma_kunden c on (c.id,c.user_id)=(b.customer_id,b.user_id)
left join sma_private.onboarding_plan_choices_v1 r on (r.customer_id,r.user_id,r.n8n_ref,r.n8n_row_id,r.n8n_link_email)
  =(b.customer_id,b.user_id,b.n8n_ref,b.n8n_row_id,b.email);`;
}

async function inputAccount() {
  const rl=createInterface({input:process.stdin,output:process.stderr});
  try {
    const row={};
    for (const key of ['id','kunde_id','kunde_email','paket','mollie_customer_id','mollie_subscription_id']) {
      row[key]=(await rl.question(key+' aus der geprüften n8n-Zeile: ')).trim();
    }
    if (!/^[1-9]\d*$/.test(row.id) || !Number.isSafeInteger(Number(row.id))) throw Error('n8n-Zeilen-ID prüfen.');
    row.id=Number(row.id);
    for (const key of ['zugang_aktiv','zahlung_bestaetigt','demo_delta_aktiv','has_access_token']) {
      const value=(await rl.question((key==='has_access_token'?'Zugangstoken vorhanden (nur EIN/AUS)':key+' (EIN/AUS)')+': ')).trim().toUpperCase();
      if (!['EIN','AUS'].includes(value)) throw Error('EIN oder AUS eingeben.');
      row[key]=value==='EIN';
    }
    return row;
  } finally {rl.close();}
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [id, option, ...extra]=process.argv.slice(2);
    if ((option && !['--mit-konto','--folgezahlung'].includes(option)) || extra.length || !paymentId.test(id))
      throw Error('Aufruf: node n8n/sync-onboarding-payment.mjs tr_ID [--mit-konto | --folgezahlung]');
    const token=process.env.SMA_MOLLIE_READ_TOKEN;
    if (!token) throw Error('Lesezugang SMA_MOLLIE_READ_TOKEN fehlt.');
    const account=option==='--mit-konto'?await inputAccount():null;
    const read=async path=>{
      const response=await fetch('https://api.mollie.com/v2'+path,{
        headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw Error('Mollie-Abruf fehlgeschlagen ('+response.status+').');
      return response.json();
    };
    console.log(option==='--folgezahlung' ? await prepareRenewalCheck(id,read) : await preparePaymentSync(id,account,read));
  } catch (error) { console.error(error.message);process.exitCode=1; }
}
