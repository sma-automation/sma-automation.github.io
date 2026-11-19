import assert from 'node:assert/strict';

export async function checkOfferOptions({db,owner,other,asset,revision,shop}){
 const query='select public.sma_publication_offer_options_v1($1,$2) result';
 const get=async(rev=revision)=>{
  await db.exec('set role authenticated');
  try{return (await db.query(query,[asset,rev])).rows[0].result;}
  finally{await db.exec('reset role');}
 };
 await db.exec('begin');
 try{
  const bare=await get();
  assert.equal(bare.ok,true,JSON.stringify(bare));
  assert.equal(bare.can_publish,false);
  assert.equal(bare.requires_customer_selection,true);
  assert.deepEqual(bare.offers.map(x=>x.provider),['shopify']);
  assert.equal(bare.offers[0].url,shop+'&produkt=good_01');
  assert.equal(bare.offers[0].requires_customer_approval,true);
  assert.equal((await get('sha256:'+'f'.repeat(64)+':1')).code,'FILE_CHANGED');

  const providerUrl='https://www.checkout-ds24.com/redir/123456/FixtureAffiliate/Campaign_01';
  await db.exec("update public.sma_produkte set digistore24_aktiv=true where sma_produkt_id='good_01'");
  await db.query("insert into sma_private.publication_digistore_offers_v1 "+
    "(product_row_id,customer_id,user_id,digistore_product_id,affiliate_id,promo_url,verification_reference,verified_at,enabled) "+
    "values((select id from public.sma_produkte where sma_produkt_id='good_01'),1,$1,123456,"+
    "'FixtureAffiliate',$2,'trusted-fixture-receipt',now(),true)",[owner,providerUrl]);
  const both=await get();
  assert.equal(both.can_publish,false);
  assert.deepEqual(both.offers.map(x=>x.provider),['shopify','digistore24']);
  assert.deepEqual(both.offers.map(x=>x.url),[shop+'&produkt=good_01',providerUrl]);
  assert.equal(both.offers.every(x=>x.requires_customer_approval===true),true);
  assert.equal('verification_reference' in both.offers[1],false);

  // Direct private table access is forbidden for the browser role.
  await db.exec('savepoint denied_read');
  await db.exec('set role authenticated');
  try{
   await assert.rejects(db.query('select * from sma_private.publication_digistore_offers_v1'));
  }finally{
   await db.exec('rollback to savepoint denied_read');
   await db.exec('reset role');
  }

  const updates=[
    "update sma_private.publication_digistore_offers_v1 set enabled=false",
    "update sma_private.publication_digistore_offers_v1 set verified_at=now()-interval '31 days'",
    "update sma_private.publication_digistore_offers_v1 set verified_at=now()+interval '1 day'",
    "update sma_private.publication_digistore_offers_v1 set affiliate_id='SomeoneElse'",
    "update sma_private.publication_digistore_offers_v1 set digistore_product_id=654321",
    "update sma_private.publication_digistore_offers_v1 set user_id=$1",
    "update public.sma_produkte set digistore24_aktiv=false where sma_produkt_id='good_01'",
  ];
  for(const sql of updates){
   await db.exec('savepoint invalid_offer');
   if(sql.includes('$1'))await db.query(sql,[other]);else await db.exec(sql);
   const response=await get();
   assert.deepEqual(response.offers.map(x=>x.provider),['shopify'],sql);
   await db.exec('rollback to savepoint invalid_offer');
  }

  for(const malicious of [
    'http://www.checkout-ds24.com/redir/123456/FixtureAffiliate',
    'https://evil.invalid/redir/123456/FixtureAffiliate',
    'https://www.checkout-ds24.com/redir/123456/FixtureAffiliate?next=evil',
    'https://www.checkout-ds24.com/redir/123456/FixtureAffiliate#fragment',
    'https://www.checkout-ds24.com@evil.invalid/redir/123456/FixtureAffiliate',
  ]){
   await db.exec('savepoint bad_url');
   await assert.rejects(db.query(
    'update sma_private.publication_digistore_offers_v1 set promo_url=$1',[malicious]));
   await db.exec('rollback to savepoint bad_url');
  }
  assert.deepEqual((await get()).offers.map(x=>x.provider),['shopify','digistore24']);

  // A Digistore-only article can offer its own independently verified promotion.
  await db.exec('savepoint digistore_only');
  await db.exec("update public.sma_produkte set shopify_aktiv=false where sma_produkt_id='good_01'");
  const only=await get();
  assert.deepEqual(only.offers.map(x=>x.provider),['digistore24']);
  assert.equal(only.offers[0].url,providerUrl);
  await db.exec('rollback to savepoint digistore_only');

  // Ambiguous article names and a foreign login cannot produce a sale destination.
  await db.exec('savepoint duplicate_name');
  await db.query("insert into public.sma_produkte(user_id,kunde_id,produkt_name,sku,sma_produkt_id,aktiv) "+
    "values($1,'our','Artikel','DUPLICATE','duplicate',true)",[owner]);
  assert.equal((await get()).offers.length,0);
  await db.exec('rollback to savepoint duplicate_name');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  const foreign=await get();assert.equal(foreign.ok,false);assert.equal(foreign.can_publish,false);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  assert.deepEqual((await get()).offers.map(x=>x.provider),['shopify','digistore24']);

  console.log('Provider offer options: tenant/revision, separate Shopify+Digistore, stale/mismatched/unsafe links, no browser table access.');
 }finally{await db.exec('rollback');}
}