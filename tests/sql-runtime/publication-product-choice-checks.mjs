import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function checkProductChoice({db,file,saved,product,owner,other,shop}){
  await db.exec('begin');
  try{
    await product('Zweite Ausführung','Article-SKU','second_02');
    await product('Nicht im Video','Other-SKU','unrelated');
    await product('Fremder Treffer','Article-SKU','foreign',other);
    await product('Anderer Kunde','Article-SKU','other-tenant',owner,'other-tenant');
    await product('Archiviert','Article-SKU','archived',owner,'our',false);
    await product('Doppelte Kennung','Article-SKU','duplicate');
    await product('Weiterer Artikel','Different-SKU','duplicate');
    await db.exec("update public.sma_produkte set beschreibung='Grüne Ausführung für den Außenbereich.' where sma_produkt_id='second_02'");
    const matches=(await file('product','youtube')).product_context;
    assert.equal(matches.state,'ambiguous');
    assert.deepEqual(matches.choices.map(c=>c.product_id),['good_01','second_02']);
    const selected=matches.choices[1];
    const facts={Produkt:selected.name,Thema:'',Einsatzzweck:selected.purpose,Artikelnummer:selected.product_id};
    const source=(data)=>'SMA-Produktauswahl (Kunden-/Katalogdaten): '+JSON.stringify(data)+'\nDateiinhalt: Das Produkt ist vor der Kamera zu sehen.';
    for(const platform of ['youtube','tiktok']){
      const before=await file('get',platform),preview=randomUUID(),body='Produktvariante im Testvideo '+preview;
      const base={platform,title:'Gewählte Variante',body,hashtags:[],review_notes:[],caption:body+'\n\n🛒 Zum Shop: '+shop};
      await db.query(`insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,preview)
        values($1,$2,1,$3,$4,'completed',$5)`,[preview,owner,{platforms:[platform],language:'de',media_kind:'video',source_text:source(facts)},shop,
          {language:'de',shop_url:shop,can_publish:false,drafts:[base]}]);
      const bind=()=>file('assign',platform,{assignment_revision:before.assignment_revision,preview_revision:1,preview_id:preview});
      const input=text=>db.query("update sma_private.publication_previews_v1 set input=jsonb_set(input,'{source_text}',to_jsonb($2::text)) where id=$1",[preview,text]);
      for(const bad of [source({...facts,Artikelnummer:'unrelated'}),source({...facts,Artikelnummer:'foreign'}),source({...facts,Einsatzzweck:'Falsche Angabe'}),'SMA-Produktauswahl (Kunden-/Katalogdaten): ungültig']){
        await input(bad);
        assert.equal((await bind()).code,'PRODUCT_SELECTION_CHANGED');
        assert.equal((await file('get',platform)).assignment_revision,before.assignment_revision);
      }
      await input(source(facts));
      await db.exec("update public.sma_produkte set aktiv=false where sma_produkt_id='second_02'");
      assert.equal((await bind()).code,'PRODUCT_SELECTION_CHANGED');
      await db.exec("update public.sma_produkte set aktiv=true where sma_produkt_id='second_02'");
      const stored=await bind();
      assert.equal(stored.ok,true,JSON.stringify(stored));
      const draft=stored.preview.drafts[0];
      assert.equal(draft.product_id,selected.product_id);
      assert.equal(draft.caption,body+'\n\n🛒 Zum Produkt: '+shop+'&produkt=second_02');
      assert.deepEqual((await file('get',platform)).preview.drafts[0],draft);
      const edit=await file('save',platform,{assignment_revision:stored.assignment_revision,title:'Geprüfte Variante',body:'Bearbeiteter Produktentwurf '+preview});
      assert.equal(edit.preview.drafts[0].product_id,selected.product_id);
      const handed=await saved(platform);
      assert.deepEqual(handed.text,edit.preview.drafts[0]);
      assert.equal(handed.can_publish,false);
    }
  }finally{await db.exec('rollback');}
  console.log('Ambiguous video product choices, tenant boundaries, changed evidence, editor and saved handoff passed.');
}
