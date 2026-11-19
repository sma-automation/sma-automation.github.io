// Customer-visible, read-only provider choices for an owned video revision.
// The backend alone decides whether an offer belongs to this product and customer.
// Displaying a link NEVER selects a caption, opens a checkout or publishes.
const SHOPIFY=/^https:\/\/sma-automation\.com\/app\/shop\.html\?shop=[a-z0-9]+(?:-[a-z0-9]+)*&produkt=[A-Za-z0-9_-]{1,80}$/;
const DIGISTORE=/^https:\/\/www\.checkout-ds24\.com\/redir\/[1-9][0-9]{0,11}\/[A-Za-z0-9._-]{1,80}(?:\/[A-Za-z0-9._-]{1,127})?\/?$/;

export function allowedProviderOffer(value) {
 if(!value||typeof value!=='object'||value.requires_customer_approval!==true||
   typeof value.url!=='string'||typeof value.product_id!=='string'||
   !/^[A-Za-z0-9_-]{1,80}$/.test(value.product_id))return null;
 if(value.provider==='shopify' && SHOPIFY.test(value.url) && value.url.endsWith('&produkt='+value.product_id))
   return {provider:'shopify',url:value.url,product_id:value.product_id,label:'Shopify-Artikel ansehen'};
 if(value.provider==='digistore24' && DIGISTORE.test(value.url))
   return {provider:'digistore24',url:value.url,product_id:value.product_id,label:'Digistore24-Angebot ansehen'};
 return null;
}

// Re-selecting a saved offer is idempotent: the server may return the same
// assignment revision when nothing changed. A stale or unrelated receipt must
// never be accepted as a harmless repeat.
export function isSavedProviderOffer(draft,offer) {
 if(!draft||typeof draft!=='object'||!offer||typeof offer!=='object'||
   typeof draft.caption!=='string')return false;
 const verified=allowedProviderOffer({...offer,requires_customer_approval:true});
 if(!verified)return false;
 const hasFooter=(de,en)=>draft.caption.endsWith('\n\n🛒 '+de+': '+verified.url)||
   draft.caption.endsWith('\n\n🛒 '+en+': '+verified.url);
 if(verified.provider==='digistore24')return !Object.hasOwn(draft,'product_id')&&
   draft.offer_provider==='digistore24'&&draft.offer_url===verified.url&&
   draft.offer_product_id===verified.product_id&&hasFooter('Zum Angebot','View offer');
 return !Object.hasOwn(draft,'offer_provider')&&!Object.hasOwn(draft,'offer_url')&&
   !Object.hasOwn(draft,'offer_product_id')&&draft.product_id===verified.product_id&&
   hasFooter('Zum Produkt','View product');
}

export function mountProviderOfferOptions({doc,note,file,request,isCurrent,onSelect}) {
 if(!file||file.media_kind!=='video'||typeof request!=='function'||typeof isCurrent!=='function')return null;
 const button=doc.createElement('button'),details=doc.createElement('div');
 button.type='button';button.className='btn';button.textContent='Shopify- und Digistore24-Links prüfen';
 details.setAttribute('role','status');
 details.hidden=true;
 let pending=false,serial=0;
 async function check() {
  if(pending||!isCurrent())return;
  const ticket=++serial;pending=true;button.disabled=true;details.hidden=false;
  details.textContent='Verkaufslinks werden geprüft …';
  try {
   const answer=await request(file.id,file.revision);
   if(ticket!==serial||!isCurrent())return;
   details.replaceChildren();
   if(answer?.ok!==true || answer.can_publish!==false ||
      answer.requires_customer_selection!==true ||
      !Array.isArray(answer.offers) || answer.offers.length>2 ||
      (answer.asset_revision!==undefined && answer.asset_revision!==file.revision)){
    details.textContent='Die Verkaufslinks konnten nicht sicher geprüft werden.';
    return;
   }
   const offers=answer.offers.map(allowedProviderOffer);
   const providers=answer.offers.map(x=>x.provider);
   if(offers.some(x=>!x)||new Set(providers).size!==providers.length){
    details.textContent='Die Verkaufslinks konnten nicht sicher geprüft werden.';
    return;
   }
   if(!offers.length){
    details.textContent='Für diese Datei liegt noch kein eindeutig bestätigter Shopify- oder Digistore24-Verkaufslink vor.';
    return;
   }
   const summary=doc.createElement('p');
   summary.textContent='Geprüfte Linkvorschläge. Vor der Übernahme in einen Beitrag persönlich kontrollieren:';
   details.append(summary);
   for(const offer of offers){
    const link=doc.createElement('a');
    link.href=offer.url;link.target='_blank';link.rel='noopener noreferrer nofollow';
    link.referrerPolicy='no-referrer';
    link.textContent=offer.label;
    details.append(link);
    if(typeof onSelect==='function'){
     const choose=doc.createElement('button');choose.type='button';choose.className='btn';
     choose.textContent='Für diesen Portalentwurf übernehmen';
     choose.addEventListener('click',async()=>{
      if(pending||!isCurrent()||choose.disabled)return;
      choose.disabled=true;
      try{
       await onSelect(offer);
       if(ticket===serial&&isCurrent())details.textContent='Linkauswahl gespeichert. Prüfe den aktualisierten Portaltext.';
      }catch(error){
       if(ticket===serial&&isCurrent())details.textContent=typeof error?.message==='string'?error.message:'Die Linkauswahl konnte nicht gespeichert werden.';
      }finally{if(ticket===serial)choose.disabled=false;}
     });
     details.append(choose);
    }
   }
  }catch{
   if(ticket===serial&&isCurrent())details.textContent='Die Verkaufslinks konnten nicht geladen werden.';
  }finally{
   if(ticket===serial){pending=false;button.disabled=false;}
  }
 }
 button.addEventListener('click',()=>{void check();});
 note.append(button,details);
 return {button,details,destroy(){serial++;pending=false;button.disabled=true;}};
}