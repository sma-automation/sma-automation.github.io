// Private pilot operator. Reads Mollie and prints a SQL statement for the private SQL editor.
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';

const price = {alpha:'100.00', beta:'300.00', delta:'500.00'};
const paymentId = /^tr_[A-Za-z0-9]{1,64}$/;
const customerId = /^cst_[A-Za-z0-9]{1,64}$/;
const subscriptionId = /^sub_[A-Za-z0-9]{1,64}$/;

function reversed(money) {
  if (money === undefined) return false;
  if (money?.currency !== 'EUR' || !/^\d+\.\d{2}$/.test(money.value)) throw Error('Ungültiger Rückzahlungsbetrag.');
  return !/^0+\.00$/.test(money.value);
}

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
  const literal = obj => "convert_from(decode('"+Buffer.from(JSON.stringify(obj)).toString('hex')+"','hex'),'UTF8')::jsonb";
  return 'select sma_private.sync_onboarding_booking_v1('+literal(receipt)+','+(account?literal(account):'null')+');';
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
    if ((option && option!=='--mit-konto') || extra.length || !paymentId.test(id))
      throw Error('Aufruf: node n8n/sync-onboarding-payment.mjs tr_ID [--mit-konto]');
    const token=process.env.SMA_MOLLIE_READ_TOKEN;
    if (!token) throw Error('Lesezugang SMA_MOLLIE_READ_TOKEN fehlt.');
    const account=option?await inputAccount():null;
    const read=async path=>{
      const response=await fetch('https://api.mollie.com/v2'+path,{
        headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) throw Error('Mollie-Abruf fehlgeschlagen ('+response.status+').');
      return response.json();
    };
    console.log(await preparePaymentSync(id,account,read));
  } catch (error) { console.error(error.message);process.exitCode=1; }
}
