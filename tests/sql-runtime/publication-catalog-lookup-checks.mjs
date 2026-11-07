import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function checkCatalogLookup({db,file,saved,product,owner,other,shop}){
  await db.exec('begin');
  try{
    const search=params=>file('catalog_search','youtube',params);
    assert.equal((await search({query:''})).code,'PRODUCT_SELECTION_CHANGED');
    await db.exec("update sma_private.publication_files_v1 set name='Aufnahme.mp4'");
    for(let n=0;n<14;n++)await product('Serie Grün '+n,'S-'+n,'serie_'+String(n).padStart(2,'0'));
    await product('Fremd','S-55','other-owner',other);
    await product('Falscher Kunde','S-55','other-customer',owner,'wrong');
    await product('Inaktiv','S-55','archived',owner,'our',false);
    await product('Doppelt A','D-1','dupe');await product('Doppelt B','D-2','dupe');
    const page=await search({query:'grÜn'});assert.equal(page.choices.length,10);assert.equal(page.more,true);
    const next=await search({query:'grÜn',after:page.choices.at(-1).product_id});assert.equal(next.choices.length,4);assert.equal(next.more,false);
    assert.equal(new Set([...page.choices,...next.choices].map(p=>p.product_id)).size,14);
    const target=(await search({query:'s-13'})).choices[0];assert.equal(target.product_id,'serie_13');
    assert.deepEqual((await search({product_id:target.product_id})).choices,[target]);
    for(const id of ['other-owner','other-customer','archived','dupe'])assert.deepEqual((await search({product_id:id})).choices,[]);
    assert.deepEqual((await search({query:'%'})).choices,[]);
    for(const input of [{},{product_id:null},{query:'a',product_id:'good_01'},{query:'',after:'bad&x=1'},{query:'a'.repeat(161)},{query:[],user_id:other}])
      assert.equal((await search(input)).code,'INVALID_INPUT');
    assert.equal((await search({query:'',asset_revision:'stale'})).code,'FILE_CHANGED');
    for(const platform of ['youtube','tiktok']){
      const initial=await file('get',platform),preview=randomUUID(),body='Manuelle Artikelsuche '+preview;
      const facts={Produkt:target.name,Thema:'',Einsatzzweck:target.purpose,Artikelnummer:target.product_id};
      const source='SMA-Artikelauswahl aus dem Shop: '+JSON.stringify(facts)+'\nDateiinhalt: Das Produkt steht auf dem Tisch.';
      const draft={platform,title:'Shopartikel',body,hashtags:[],review_notes:[],caption:body+'\n\n🛒 Zum Shop: '+shop};
      await db.query(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
       values($1,$2,1,$3,$4,'completed',$5)`,[preview,owner,{language:'de',media_kind:'video',platforms:[platform],source_text:source},shop,
         {language:'de',shop_url:shop,can_publish:false,drafts:[draft]}]);
      const bind=()=>file('assign',platform,{preview_id:preview,preview_revision:1,assignment_revision:initial.assignment_revision});
      await db.exec("update public.sma_produkte set beschreibung='Geändert' where sma_produkt_id='serie_13'");
      assert.equal((await bind()).code,'PRODUCT_SELECTION_CHANGED');
      await db.exec("update public.sma_produkte set beschreibung=null where sma_produkt_id='serie_13'");
      await db.exec("update sma_private.publication_files_v1 set name='Article-SKU.mp4'");
      assert.equal((await bind()).code,'PRODUCT_SELECTION_CHANGED');
      await db.exec("update sma_private.publication_files_v1 set name='Aufnahme.mp4'");
      assert.equal((await file('get',platform)).assignment_revision,initial.assignment_revision);
      assert.equal((await bind()).ok,true);
      const reopened=await file('get',platform),handed=await saved(platform);
      assert.equal(reopened.preview.drafts[0].product_id,target.product_id);
      assert.deepEqual(handed.text,reopened.preview.drafts[0]);
      assert.equal(handed.text.caption,body+'\n\n🛒 Zum Produkt: '+shop+'&produkt=serie_13');
      assert.equal(handed.can_publish,false);
    }
    await db.exec('update public.sma_kunden set shop_oeffentlich=false where id=1');
    assert.equal((await search({query:''})).code,'PUBLIC_SHOP_REQUIRED');
  }finally{await db.exec('rollback');}
  console.log('Manual shop lookup: paging, literal search, SKU, permissions, stale evidence and both saved portal handoffs passed.');
}
