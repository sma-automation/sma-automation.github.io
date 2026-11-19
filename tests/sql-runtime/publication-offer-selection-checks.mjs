import assert from 'node:assert/strict';
import handoff from '../../n8n/publishing/publisher-handoff.cjs';
import publisher from '../../n8n/publishing/publisher-text.cjs';

export async function checkOfferSelection({db,file,saved,owner,other,asset,revision,shop}){
 const promo='https://www.checkout-ds24.com/redir/123456/FixtureAffiliate/Campaign_01';
 const select=async(provider,url,expected,platform='youtube')=>{
  await db.exec('set role authenticated');
  try {
   const {rows:[row]}=await db.query(
    'select public.sma_publication_offer_selection_v1($1,$2,$3,$4,$5,$6) result',
    [asset,revision,platform,expected,provider,url]);
   return row.result;
  }finally{await db.exec('reset role');}
 };
 await db.exec('begin');
 try {
  await db.query('update sma_private.publication_files_v1 set verified_at=now() where id=$1',[asset]);
  await db.exec("update public.sma_produkte set digistore24_aktiv=true where sma_produkt_id='good_01'");
  await db.query("insert into sma_private.publication_digistore_offers_v1 "+
    "(product_row_id,customer_id,user_id,digistore_product_id,affiliate_id,promo_url,verification_reference,verified_at,enabled) "+
    "values((select id from public.sma_produkte where sma_produkt_id='good_01' and user_id=$1),"+
    "1,$1,123456,'FixtureAffiliate',$2,'fixture-offer-approval',now(),true)",[owner,promo]);
  const before=await file('get','youtube');
  assert.equal(before.preview.drafts[0].product_id,'good_01');
  const initial=before.assignment_revision;
  const save=await select('digistore24',promo,initial);
  assert.equal(save.ok,true,JSON.stringify(save));
  assert.equal(save.can_publish,false);
  assert.equal(save.assignment_revision,initial+1);
  const d=save.preview.drafts[0];
  assert.equal(d.product_id,undefined);
  assert.equal(d.offer_provider,'digistore24');
  assert.equal(d.offer_product_id,'good_01');
  assert.equal(d.offer_url,promo);
  assert.ok(d.caption.endsWith('\n\n🛒 View offer: '+promo));
  assert.equal((d.caption.match(/https:\/\//g)||[]).length,1);
  const reopened=await file('get','youtube');
  assert.equal(reopened.assignment_revision,save.assignment_revision);
  assert.deepEqual(reopened.preview.drafts[0],d);
  assert.equal(reopened.offer_link_available,true);
  assert.equal(reopened.product_link_available,null);
  const read=await saved('youtube');
  assert.equal(read.ok,true,JSON.stringify(read));
  const binding={version:1,customer_id:1,drive_file_id:'fixture-product-video',
   asset_id:asset,asset_revision:revision,platform:'youtube',
   assignment_revision:save.assignment_revision,preview_id:save.id,preview_revision:save.revision,
   shop_url:shop,media_kind:'video'};
  const prepared=publisher.publisherText(handoff.makeHandoff(read,binding),binding);
  assert.equal(prepared.ok,true,JSON.stringify(prepared));
  assert.equal(prepared.adapter_fields.snippet.description,d.caption);
  assert.equal(prepared.can_upload,false);
  assert.equal(prepared.can_publish,false);

  // A lost response cannot produce a second assignment revision.
  const replay=await select('digistore24',promo,initial);
  assert.equal(replay.code,'ASSIGNMENT_CONFLICT');
  assert.equal((await file('get','youtube')).assignment_revision,initial+1);
  const wrong=await select('digistore24',
    'https://www.checkout-ds24.com/redir/123456/DifferentAffiliate',initial+1);
  assert.equal(wrong.code,'OFFER_CHANGED');
  assert.equal((await file('get','youtube')).assignment_revision,initial+1);

  // Ordinary editorial changes retain the validated, selected provider, without
  // generating a second promo URL or changing other portals.
  const edited=await file('save','youtube',{assignment_revision:initial+1,
    title:d.title,body:'Neue sachliche Beschreibung dieses Produkts.',hashtags:['Produkt']});
  assert.equal(edited.ok,true,JSON.stringify(edited));
  assert.equal(edited.preview.drafts[0].offer_url,promo);
  assert.equal(edited.preview.drafts[0].product_id,undefined);
  assert.equal(edited.preview.drafts[0].caption,
    'Neue sachliche Beschreibung dieses Produkts.\n\n#Produkt\n\n🛒 View offer: '+promo);
  assert.equal((await saved('youtube')).ok,true);
  const otherPortal=await file('get','tiktok');
  assert.ok(!otherPortal.preview.drafts[0].offer_provider);

  // Expired verification disallows both downstream handoff and new text saves.
  await db.exec('savepoint expired');
  await db.exec("update sma_private.publication_digistore_offers_v1 set verified_at=now()-interval '31 days'");
  assert.equal((await saved('youtube')).code,'ASSIGNMENT_CHANGED');
  assert.equal((await file('get','youtube')).offer_link_available,false);
  const rejected=await file('save','youtube',{assignment_revision:edited.assignment_revision,
    title:d.title,body:'Dieser geänderte Text darf nicht als geprüft gelten.',hashtags:[]});
  assert.equal(rejected.code,'PRODUCT_LINK_UNAVAILABLE');
  await db.exec('rollback to savepoint expired');
  assert.equal((await saved('youtube')).ok,true);

  // Selected Shopify is still canonical, and the legacy editor can revert to
  // shop homepage without retaining a stale Digistore destination.
  const chosenShop=await select('shopify',shop+'&produkt=good_01',edited.assignment_revision);
  assert.equal(chosenShop.ok,true,JSON.stringify(chosenShop));
  assert.equal(chosenShop.preview.drafts[0].offer_provider,undefined);
  assert.equal(chosenShop.preview.drafts[0].product_id,'good_01');
  assert.equal(chosenShop.preview.drafts[0].caption.endsWith('🛒 View product: '+shop+'&produkt=good_01'),true);
  const chosenDsAgain=await select('digistore24',promo,chosenShop.assignment_revision);
  assert.equal(chosenDsAgain.ok,true);
  const d2=chosenDsAgain.preview.drafts[0];
  const home=await file('save','youtube',{assignment_revision:chosenDsAgain.assignment_revision,
    title:d2.title,body:d2.body,hashtags:d2.hashtags,link_target:null});
  assert.equal(home.ok,true,JSON.stringify(home));
  assert.equal(home.preview.drafts[0].offer_provider,undefined);
  assert.equal(home.preview.drafts[0].offer_url,undefined);
  assert.equal(home.preview.drafts[0].product_id,undefined);
  assert.ok(home.preview.drafts[0].caption.endsWith('🛒 Visit our shop: '+shop));

  // Identity/account changes must fail closed; no foreign user may overwrite.
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  assert.equal((await select('digistore24',promo,home.assignment_revision)).code,'ACCOUNT_UNAVAILABLE');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  assert.equal((await file('get','youtube')).assignment_revision,home.assignment_revision);

  console.log('One-portal verified Digistore selection, canonical footer, saved edits, stale and foreign denial, provider handoff.');
 }finally{await db.exec('rollback');}
}