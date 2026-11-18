// Operator helper for a single, already inspected row in the private SMA_Kunden table.
// No provider request is made. Only the seven existing SQL evidence fields are emitted.
const {createInterface}=require('node:readline');

const hiddenFields=['zugangs_token','zugangs_link','mollie_customer_id','mollie_subscription_id'];

function confirmationSql(reference,row){
  if (!/^kunde_[0-9a-f]{32}$/.test(reference) || row?.kunde_id!==reference ||
      !Number.isSafeInteger(row.id)||row.id<1||
      typeof row.kunde_email!=='string'||!row.kunde_email.trim()||
      row.paket!==null||row.zugang_aktiv!==false||
      row.zahlung_bestaetigt!==false||row.demo_delta_aktiv!==false) {
    throw Error('Kennung, Zeilen-ID, Adresse oder Status der n8n-Zeile prüfen.');
  }
  // An existing token/link or merchant reference would make this a reused
  // customer row, not a fresh dormant onboarding account. The payment worker
  // requires these fields to be absent before creating the first payment.
  // Ask only for presence booleans; NEVER ask to copy the actual secret.
  if(hiddenFields.some(key=>row[key+'_vorhanden']!==false)){
    throw Error('n8n-Zeile ist nicht leer: Zugangstoken, Zugangslink und Mollie-Referenzen getrennt prüfen.');
  }
  // Preserve the EXACT seven-field contract of confirm_onboarding_n8n_v1.
  // No secret-presence evidence or hidden raw token goes into the SQL.
  const evidenceRow={
    id:row.id,kunde_id:row.kunde_id,kunde_email:row.kunde_email,paket:row.paket,
    zugang_aktiv:row.zugang_aktiv,zahlung_bestaetigt:row.zahlung_bestaetigt,
    demo_delta_aktiv:row.demo_delta_aktiv
  };
  const evidence=Buffer.from(JSON.stringify([evidenceRow]),'utf8').toString('hex');
  return "select sma_private.confirm_onboarding_n8n_v1('"+reference+"', convert_from(decode('"+evidence+"', 'hex'), 'UTF8')::jsonb);";
}

async function main(){
  const lines=createInterface({input:process.stdin});
  const answers=lines[Symbol.asyncIterator]();
  async function ask(label){
    process.stderr.write(label+': ');
    const answer=await answers.next();
    if(answer.done)throw Error('Eingabe unvollständig.');
    return answer.value;
  }
  async function flag(label){
    const value=(await ask(label+' (EIN/AUS)')).trim().toUpperCase();
    if(!['EIN','AUS'].includes(value))throw Error('EIN oder AUS eingeben.');
    return value==='EIN';
  }
  try{
    const reference=await ask('Reservierte Kennung aus Supabase');
    const id=await ask('Numerische n8n-Zeilen-ID');
    if(!/^[1-9][0-9]*$/.test(id))throw Error('Die Zeilen-ID muss eine positive ganze Zahl sein.');
    const row={
      id:Number(id),
      kunde_id:await ask('kunde_id aus n8n'),
      kunde_email:await ask('kunde_email aus n8n'),
      paket:(await ask('paket aus n8n (bei leerem Feld Enter)'))||null
    };
    for(const key of ['zugang_aktiv','zahlung_bestaetigt','demo_delta_aktiv'])
      row[key]=await flag(key+' aus n8n');
    for(const key of hiddenFields)
      row[key+'_vorhanden']=await flag(key+' in n8n vorhanden?');
    console.log(confirmationSql(reference,row));
  }finally{
    lines.close();
  }
}
module.exports={confirmationSql};
if(require.main===module){
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
