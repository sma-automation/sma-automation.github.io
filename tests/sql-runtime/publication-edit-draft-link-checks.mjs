import assert from 'node:assert/strict';

export async function checkDraftLinkEdits({db,file,saved,product,owner,other,shop}){
  await db.exec('begin');
  try{
    await product('Zweiter Artikel','Second-SKU','second');
    await product('Fremdartikel','Fremd-SKU','foreign',other);
    const read=()=>file('get','youtube');
    const edit=(r,target,fields={})=>{
      const {title,body,hashtags}=r.preview.drafts[0];
      return file('save','youtube',{assignment_revision:r.assignment_revision,title,body,hashtags,link_target:target,...fields});
    };
    const target=(source,product_id,name)=>({source,product_id,name,purpose:''});
    const original=await read(),draft=original.preview.drafts[0];
    assert.equal(original.product_link_available,true);
    await db.exec('savepoint duplicate_product');
    await product('Zweites Produkt mit derselben Kennung','Duplicate-SKU','good_01');
    assert.equal((await read()).product_link_available,false);
    await db.exec('rollback to savepoint duplicate_product');
    // A seller with the same public article ID in a different shop is irrelevant.
    await product('Fremder Artikel','Foreign-SKU','good_01',other);
    assert.equal((await read()).product_link_available,true);
    await db.exec('savepoint removed_product');
    await db.query("delete from public.sma_produkte where sma_produkt_id='good_01' and user_id=$1",[owner]);
    assert.equal((await read()).product_link_available,false);
    await db.exec('rollback to savepoint removed_product');
    const sibling=await file('get','tiktok');
    // Two portals can reference one generic preview. Pure link changes must leave that shared revision intact.
    await db.query("update sma_private.publication_assignments_v1 set preview_id=$1,preview_revision=$2 where platform='tiktok'",[original.id,original.revision]);
    await db.exec("update public.sma_produkte set aktiv=false where sma_produkt_id='good_01'");
    assert.equal((await saved('youtube')).code,'ASSIGNMENT_CHANGED');
    assert.equal((await read()).product_link_available,false);
    await db.exec('savepoint edited_text');
    const edited=await file('save','youtube',{assignment_revision:original.assignment_revision,title:draft.title,body:'Korrigierter Text zum bisherigen Artikel.',hashtags:draft.hashtags});
    assert.equal(edited.ok,true);assert.equal(edited.product_link_available,false);
    await db.exec('rollback to savepoint edited_text');
    const root=await edit(original,null);
    assert.equal(root.product_link_available,null);
    assert.equal(root.ok,true,JSON.stringify(root));assert.equal(root.revision,original.revision);
    assert.equal(root.assignment_revision,original.assignment_revision+1);
    assert.equal(root.preview.drafts[0].product_id,undefined);
    assert.equal(root.preview.drafts[0].caption,draft.caption.replace('🛒 View product: '+shop+'&produkt=good_01','🛒 Visit our shop: '+shop));
    assert.equal((await saved('youtube')).can_publish,false);
    assert.equal((await read()).link_product,null);
    assert.equal((await saved('tiktok')).code,'ASSIGNMENT_CHANGED');
    const same=await edit(root,null);assert.equal(same.assignment_revision,root.assignment_revision);assert.equal(same.product_link_available,null);
    assert.equal((await edit(original,null)).code,'ASSIGNMENT_CONFLICT');
    for(const bad of [false,'https://evil.invalid',{},target('catalog','foreign','Fremdartikel'),target('catalog','second','Veraltet')]){
      assert.equal((await edit(root,bad,{body:'Dieser Text darf nicht gespeichert werden.'})).ok,false);
      assert.deepEqual((await read()).preview,root.preview);
      assert.equal((await read()).revision,root.revision);
    }
    const replacement=target('catalog','second','Zweiter Artikel');
    const linked=await edit(root,replacement);
    assert.equal(linked.ok,true);assert.equal(linked.revision,original.revision);
    assert.equal(linked.preview.drafts[0].product_id,'second');
    assert.equal((await read()).link_product.name,'Zweiter Artikel');assert.equal(linked.product_link_available,true);
    assert.deepEqual((await saved('youtube')).text,linked.preview.drafts[0]);
    assert.equal((await file('get','tiktok')).assignment_revision,sibling.assignment_revision);
    await db.exec("update public.sma_produkte set aktiv=true where sma_produkt_id='good_01'");
    assert.deepEqual((await saved('tiktok')).text,sibling.preview.drafts[0]);
    assert.equal((await edit(linked,replacement)).code,'PRODUCT_SELECTION_CHANGED');
    await product('Dritter Artikel','Article-SKU','third');
    const fromChoices=await edit(linked,target('choice','third','Dritter Artikel'));
    assert.equal(fromChoices.preview.drafts[0].product_id,'third');
    await db.exec("update public.sma_produkte set aktiv=false where sma_produkt_id='third'");
    const combined=await edit(fromChoices,target('matched','good_01','Artikel'),{body:'Ein ausdrücklich bearbeiteter Beitragstext.',hashtags:['Artikel']});
    assert.equal(combined.revision,original.revision+1);
    assert.equal(combined.preview.drafts[0].caption,'Ein ausdrücklich bearbeiteter Beitragstext.\n\n#Artikel\n\n🛒 View product: '+shop+'&produkt=good_01');
    await db.exec("update sma_private.publication_files_v1 set revision='version:2'");
    assert.equal((await edit(combined,null,{asset_revision:'version:2'})).code,'FILE_CHANGED');
  }finally{await db.exec('rollback');}
  console.log('Draft link edits passed for shop fallback, all three product paths, stale selections, shared previews and atomic text changes.');
}
