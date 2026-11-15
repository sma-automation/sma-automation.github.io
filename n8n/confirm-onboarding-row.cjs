// Operator helper for a single, already inspected row in the private SMA_Kunden table.
const { createInterface } = require('node:readline');

function confirmationSql(reference, row) {
  if (!/^kunde_[0-9a-f]{32}$/.test(reference) || row.kunde_id !== reference ||
      !Number.isSafeInteger(row.id) || row.id < 1 || !row.kunde_email?.trim() ||
      row.paket !== null || row.zugang_aktiv !== false ||
      row.zahlung_bestaetigt !== false || row.demo_delta_aktiv !== false) {
    throw Error('Kennung, Zeilen-ID, Adresse oder Status der n8n-Zeile prüfen.');
  }
  // Only ASCII hex enters the SQL string literals, including for addresses with apostrophes.
  const evidence = Buffer.from(JSON.stringify([row]), 'utf8').toString('hex');
  return `select sma_private.confirm_onboarding_n8n_v1('${reference}', convert_from(decode('${evidence}', 'hex'), 'UTF8')::jsonb);`;
}

async function main() {
  const lines = createInterface({ input: process.stdin });
  const answers = lines[Symbol.asyncIterator]();
  async function ask(label) {
    process.stderr.write(label + ': ');
    const answer = await answers.next();
    if (answer.done) throw Error('Eingabe unvollständig.');
    return answer.value;
  }
  try {
    const reference = await ask('Reservierte Kennung aus Supabase');
    const id = await ask('Numerische n8n-Zeilen-ID');
    if (!/^[1-9][0-9]*$/.test(id)) throw Error('Die Zeilen-ID muss eine positive ganze Zahl sein.');
    const row = {
      id: Number(id),
      kunde_id: await ask('kunde_id aus n8n'),
      kunde_email: await ask('kunde_email aus n8n'),
      paket: (await ask('paket aus n8n (bei leerem Feld Enter)')) || null
    };
    for (const key of ['zugang_aktiv', 'zahlung_bestaetigt', 'demo_delta_aktiv']) {
      const value = (await ask(key + ' aus n8n (EIN/AUS)')).trim().toUpperCase();
      if (!['EIN', 'AUS'].includes(value)) throw Error('EIN oder AUS eingeben.');
      row[key] = value === 'EIN';
    }
    console.log(confirmationSql(reference, row));
  } finally {
    lines.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
