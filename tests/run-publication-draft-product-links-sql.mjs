import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {checkDraftLinkEdits} from './sql-runtime/publication-edit-draft-link-checks.mjs';
import {checkCatalogLookup} from './sql-runtime/publication-catalog-lookup-checks.mjs';
import {checkProductChoice} from './sql-runtime/publication-product-choice-checks.mjs';
import {checkOfferOptions} from './sql-runtime/publication-offer-options-checks.mjs';
import {checkOfferSelection} from './sql-runtime/publication-offer-selection-checks.mjs';
import handoff from '../n8n/publishing/publisher-handoff.cjs';
import publisher from '../n8n/publishing/publisher-text.cjs';

const db = new PGlite();
const load = name => readFile(new URL('../supabase/sql/' + name + '.sql', import.meta.url), 'utf8');
const owner = randomUUID(), other = randomUUID(), asset = randomUUID();
const shop = 'https://sma-automation.com/app/shop.html?shop=fixture';
const revision = 'sha256:' + 'a'.repeat(64) + ':1';
const drive = 'fixture-product-video';
const value = async (query, args) => (await db.query(query, args)).rows[0].result;
async function rpc(role, query, args) {
  await db.exec('set role ' + role);
  try { return await value(query, args); } finally { await db.exec('reset role'); }
}
const file = (action, platform, fields = {}) => rpc('authenticated',
  'select public.sma_publication_files_v1($1,$2) result', [action, {asset_id:asset, asset_revision:revision, platform, ...fields}]);
const saved = platform => rpc('service_role',
  'select public.sma_publication_assignment_v1(1,$1,$2,$3) result', [drive, revision, platform]);
async function assign(platform, language, assignmentRevision = 0) {
  const preview = randomUUID(), body = 'Synthetischer Testartikel ' + preview;
  const draft = {platform, title:'Testartikel', body, hashtags:[], review_notes:[],
    caption:body + '\n\n' + (language === 'de' ? '🛒 Zum Shop: ' : '🛒 Visit our shop: ') + shop};
  await db.query(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
    values ($1,$2,1,$3,$4,'completed',$5)`, [preview, owner, {language, media_kind:'video', platforms:[platform]}, shop,
      {language, shop_url:shop, can_publish:false, drafts:[{...draft, product_id:'untrusted-model-id'}]}]);
  const result = await file('assign', platform, {assignment_revision:assignmentRevision, preview_id:preview, preview_revision:1, product_id:'untrusted-client-id'});
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}
const product = (name, sku, id, user = owner, customer = 'our', active = true, sale = {}) => db.query(
  `insert into public.sma_produkte(user_id,kunde_id,produkt_name,sku,sma_produkt_id,aktiv,
      shopify_aktiv,digistore24_aktiv,kauf_url,bestand,preis,waehrung)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [user,customer,name,sku,id,active,sale.shopify??true,sale.digistore??false,
   sale.url===undefined?'https://fixture.myshopify.com/cart/123456789012:1':sale.url,
   sale.stock===undefined?10:sale.stock,sale.price===undefined?19.90:sale.price,
   sale.currency===undefined?'EUR':sale.currency]);
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;
    create table public.sma_kunden(id bigint primary key,user_id uuid,kunde_id text,n8n_kunde_id text,kunde_email text,
      aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);
    create table public.sma_produkte(id bigint generated always as identity primary key,user_id uuid,kunde_id text,
      produkt_name text,sku text,sma_produkt_id text,beschreibung text,aktiv boolean,
      shopify_aktiv boolean,digistore24_aktiv boolean,kauf_url text,bestand bigint,preis numeric,waehrung text);
    create table public.sma_shopify_konten(sma_kunden_id bigint,aktiv boolean,markt_konto_id text,shopify_domain text);
    grant select on public.sma_kunden,public.sma_produkte,public.sma_shopify_konten to service_role;`);
  for (const name of ['publication-preview','publication-files','publication-caption-history','publication-assignment-history','publication-text-edits']) {
    await db.exec(await load(name));
  }
  for (const name of ['publication-editor-exports','publication-magic-effect']) {
    await db.exec((await load(name)).split('create or replace function')[0]);
  }
  await db.exec(`alter table sma_private.publication_editor_exports_v1 add column local_probe jsonb;
    create function sma_private.publication_export_technical_v1(sma_private.publication_files_v1) returns jsonb language sql as $$select null::jsonb$$;`);
  await db.exec(await load('publication-product-context'));
  await db.query("insert into public.sma_kunden values(1,$1,'our','ours','test@example.invalid',true,true,false,'fixture',true)", [owner]);
  await db.exec("insert into public.sma_shopify_konten values(1,true,'merchant-fixture','fixture.myshopify.com')");
  await db.query(`insert into sma_private.publication_files_v1(id,user_id,customer_id,drive_file_id,revision,name,media_kind,mime_type,modified_at,size_bytes)
    values ($1,$2,1,$3,$4,'Article-SKU.mp4','video','video/mp4',now(),1234)`, [asset,owner,drive,revision]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await product('Artikel','Article-SKU','good_01');
  // A pre-migration assignment contains no bound product.
  const legacy = await assign('youtube','de');
  await db.query("update sma_private.publication_assignments_v1 set draft=draft-'product_id'");
  await db.exec(await load('publication-draft-product-links'));
  await db.exec(await load('publication-product-choice'));
  await db.exec(await load('publication-catalog-lookup'));
  await db.exec(await load('publication-edit-draft-link'));
  await db.exec(await load('publication-draft-product-availability'));
  await db.exec(await load('publication-sale-link-guard'));
  await db.exec('grant usage on schema sma_private to authenticated');
  await db.exec(await load('publication-offer-options'));
  await db.exec(await load('publication-offer-selection'));
  const keep = await file('save','youtube',{assignment_revision:legacy.assignment_revision,title:'Alter Entwurf',body:'Ein bearbeiteter älterer Entwurf.'});
  assert.equal(keep.preview.drafts[0].product_id,undefined);assert.equal(keep.product_link_available,null);
  assert.ok(keep.preview.drafts[0].caption.endsWith('🛒 Zum Shop: '+shop));
  for (const platform of ['youtube','tiktok','instagram','facebook']) {
    let sequence = platform === 'youtube' ? keep.assignment_revision : 0;
    for (const language of ['de','en']) {
      const fresh = await assign(platform, language, sequence);
      assert.equal(fresh.product_link_available,true);
      const draft = fresh.preview.drafts[0];
      const footer = (language==='de'?'🛒 Zum Produkt: ':'🛒 View product: ') + shop + '&produkt=good_01';
      assert.equal(draft.product_id,'good_01');
      assert.equal(draft.caption,draft.body+'\n\n'+footer);
      assert.deepEqual((await file('get',platform)).preview.drafts[0],draft);
      const change = await file('save',platform,{assignment_revision:fresh.assignment_revision,title:draft.title,
        body:'Bearbeiteter Testartikel ' + fresh.id,hashtags:['Grün']});
      assert.equal(change.ok,true,JSON.stringify(change));
      sequence = change.assignment_revision;
      const response = await saved(platform);
      const binding = {version:1,customer_id:1,drive_file_id:drive,asset_id:asset,asset_revision:revision,platform,
        assignment_revision:sequence,preview_id:fresh.id,preview_revision:change.revision,shop_url:shop,media_kind:'video'};
      const prepared = publisher.publisherText(handoff.makeHandoff(response,binding),binding);
      assert.deepEqual(prepared.draft,change.preview.drafts[0]);
      assert.equal(prepared.can_upload,false);
      assert.equal(prepared.can_publish,false);
      const caption = prepared.adapter_fields.snippet?.description ?? prepared.adapter_fields.post_info?.title ??
        prepared.adapter_fields.caption ?? prepared.adapter_fields.description;
      assert.equal(caption,'Bearbeiteter Testartikel '+fresh.id+'\n\n#Grün\n\n'+footer);
    }
  }
  await checkDraftLinkEdits({db,file,saved,product,owner,other,shop});
  await checkCatalogLookup({db,file,saved,product,owner,other,shop});
  await checkProductChoice({db,file,saved,product,owner,other,shop});
  await checkOfferOptions({db,owner,other,asset,revision,shop});
  await checkOfferSelection({db,file,saved,owner,other,asset,revision,shop});
  // Product-detail links must not be mistaken for a confirmed checkout path.
  // These cases run in a rolled-back fixture transaction; no production services.
  await db.exec('begin');
  try {
    const available=async(id='good_01') => value(
      'select sma_private.publication_product_link_available_v1(c,$1) result from public.sma_kunden c where c.id=1',[id]);
    assert.equal(await available(),true);
    await product('Nur Katalogeintrag','CATALOG','catalog_only',owner,'our',true,
      {shopify:false,digistore:false,url:null});
    assert.equal(await available('catalog_only'),false);
    await product('Digistore Vorlage','DS-001','ds_only',owner,'our',true,
      {shopify:false,digistore:true,url:'https://www.digistore24.com/redir/12345/test'});
    assert.equal(await available('ds_only'),false,'Digistore-only requires a separate provider handoff');
    for(const mutation of [
      "update public.sma_produkte set shopify_aktiv=false where sma_produkt_id='good_01'",
      "update public.sma_produkte set bestand=0 where sma_produkt_id='good_01'",
      "update public.sma_produkte set preis=null where sma_produkt_id='good_01'",
      "update public.sma_produkte set waehrung=null where sma_produkt_id='good_01'",
      "update public.sma_produkte set kauf_url=null where sma_produkt_id='good_01'",
      "update public.sma_produkte set kauf_url='http://fixture.myshopify.com/cart/123456789012:1' where sma_produkt_id='good_01'",
      "update public.sma_produkte set kauf_url='https://other.myshopify.com/cart/123456789012:1' where sma_produkt_id='good_01'",
      "update public.sma_produkte set kauf_url='https://fixture.myshopify.com/products/wrong-item' where sma_produkt_id='good_01'",
      "update public.sma_produkte set kauf_url='https://fixture.myshopify.com/cart/123456789012:1?redirect=evil' where sma_produkt_id='good_01'",
      "update public.sma_shopify_konten set aktiv=false",
      "update public.sma_shopify_konten set markt_konto_id=null",
      "insert into public.sma_shopify_konten values(1,true,'duplicate','fixture.myshopify.com')",
    ]) {
      await db.exec('savepoint unsafe_sale');
      await db.exec(mutation);
      assert.equal(await available(),false,mutation);
      await db.exec('rollback to savepoint unsafe_sale');
    }
    await db.exec("update public.sma_produkte set bestand=0 where sma_produkt_id='good_01'");
    assert.equal((await file('get','youtube')).product_link_available,false);
    assert.equal((await saved('youtube')).code,'ASSIGNMENT_CHANGED');
    assert.equal((await file('product','youtube')).product_context.product_id,undefined);
    await db.exec("update sma_private.publication_files_v1 set name='neutral.mp4'");
    const choices=await file('catalog_search','youtube',{query:'Artikel'});
    assert.equal(choices.ok,true);
    assert.ok(!choices.choices.some(item=>item.product_id==='good_01'));
    assert.ok(!choices.choices.some(item=>item.product_id==='catalog_only'));
    assert.ok(!choices.choices.some(item=>item.product_id==='ds_only'));
  } finally {await db.exec('rollback');}
  assert.equal((await file('get','youtube')).product_link_available,true);
  const previous = (await file('get','youtube')).assignment_revision;
  for (const modify of [
    () => product('Zweiter Treffer','Article-SKU','other-id'),
    () => product('Andere Ware','other-sku','good_01'),
    () => db.exec("update public.sma_produkte set aktiv=false"),
    () => db.query("update public.sma_produkte set user_id=$1",[other]),
    () => db.exec("update public.sma_produkte set kunde_id='different'"),
    () => db.exec("update public.sma_produkte set sma_produkt_id='bad/link'"),
    () => db.exec("update sma_private.publication_files_v1 set name='missing.mp4'"),
  ]) {
    await db.exec('begin'); await modify();
    const d = (await assign('youtube','de',previous)).preview.drafts[0];
    assert.equal(d.product_id,undefined);
    assert.equal(d.caption,d.body+'\n\n🛒 Zum Shop: '+shop);
    await db.exec('rollback');
  }
  await db.exec('begin');
  await db.exec("update public.sma_produkte set sma_produkt_id=repeat('X',80)");
  const currentTikTok = await file('get','tiktok');
  const longLink = await assign('tiktok','en',currentTikTok.assignment_revision);
  const rejected = await file('save','tiktok',{assignment_revision:longLink.assignment_revision,
    title:'Grenzfall',body:'Film '+ '🎥'.repeat(1040),hashtags:[]});
  assert.equal(rejected.code,'CAPTION_TOO_LONG');
  const afterRejection = await file('get','tiktok');
  assert.equal(afterRejection.revision,longLink.revision);
  assert.deepEqual(afterRejection.preview,longLink.preview);
  await db.exec('rollback');
  // Profile evidence alone does not create a shop item. A duplicate full name also stays unlinked.
  await db.exec("update sma_private.publication_files_v1 set name='neutral.mp4'");
  await db.query(`with p as (insert into sma_private.publication_product_profiles_v1(customer_id,user_id,name,topic,purpose)
    values(1,$1,'Artikel','Film','Ein synthetischer Testzweck.') returning id)
    insert into sma_private.publication_product_sources_v1 select 1,$1,repeat('a',64),id from p`,[owner]);
  assert.equal((await file('product','youtube')).product_context.product_id,'good_01');
  await product('Artikel','Another-SKU','second-id');
  assert.equal((await file('product','youtube')).product_context.product_id,undefined);
  await db.exec("update public.sma_produkte set aktiv=false where sma_produkt_id='good_01'");
  assert.equal((await saved('youtube')).code,'ASSIGNMENT_CHANGED');
  assert.equal((await file('get','youtube')).preview.drafts[0].product_id,'good_01');
  await db.exec("update public.sma_kunden set shop_slug='changed'");
  assert.equal((await file('get','youtube')).code,'ACCOUNT_CHANGED');
  console.log('Draft product links passed for four portals in German and English, edits, isolation, ambiguity, withdrawal and legacy drafts.');
} finally { await db.close(); }
