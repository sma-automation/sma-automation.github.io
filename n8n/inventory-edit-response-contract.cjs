'use strict';

// Only these expected client conflicts are translated. Programming, identity,
// credential and provider failures must never become successful responses.
function productEditAttempt(run) {
  try { return {...run(),_edit_ok:true}; }
  catch(error) {
    const known={
      PRODUCT_EDIT_STOCK_INVALID:[400,'Bitte eine gültige ganze Bestandsmenge ab null angeben.'],
      SHOPIFY_STOCK_USE_STOCK_ORDER:[409,'Bitte den Shopify-Bestand über den Bestandsauftrag ändern.'],
      PRODUCT_EDIT_CONFLICT_RELOAD_REQUIRED:[409,'Das Produkt wurde inzwischen geändert. Bitte neu laden und die Bearbeitung erneut prüfen.'],
    };
    if(!Object.hasOwn(known,error?.message))throw error;
    const match=known[error.message];
    return {_edit_ok:false,response:{status:match[0],body:{ok:false,code:error.message,message:match[1]}}};
  }
}

function productEditCustomerFilter(product) {
  if(typeof product?.kunde_id!=='string'||!/^kunde_[A-Za-z0-9_-]+$/.test(product.kunde_id))
    throw Error('PRODUCT_EDIT_CUSTOMER_INVALID');
  return `(kunde_id.eq.${product.kunde_id},n8n_kunde_id.eq.${product.kunde_id})`;
}

function confirmProductEditCustomer(rows,product) {
  const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!row || typeof row.kunde_id!=='string' || !/^kunde_[A-Za-z0-9_-]+$/.test(row.kunde_id) ||
      !uuid.test(row.user_id||'') || (row.kunde_id!==product.kunde_id&&row.n8n_kunde_id!==product.kunde_id))
    throw Error('PRODUCT_EDIT_CUSTOMER_NOT_CONFIRMED');
  return {kunde_id:row.kunde_id,user_id:row.user_id,n8n_kunde_id:product.kunde_id};
}

function productEditMirrorBody(row,owner,now) {
  if(!['shopify','sma'].includes(owner))throw Error('PRODUCT_EDIT_OWNER_REQUIRED');
  const body={kunde_id:row.kunde_id,sma_produkt_id:row.produkt_id,produkt_name:row.produkt_name,
    beschreibung:row.beschreibung??'',sku:row.sku??'',produkt_typ:row.produkt_typ,
    preis:Number(row.preis),waehrung:row.waehrung,aktiv:row.aktiv===true,updated_at:now};
  // Even a metadata mirror must not submit a stale Shopify quantity. The
  // canonical inventory RPC remains its sole quantity writer on this route.
  if(owner==='sma')body.bestand=Number(row.bestand);
  return body;
}

function confirmProductEditMirror(rows,edit,customer,owner) {
  const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  const sent=edit._edit_mirror_body;
  const fields=['produkt_name','beschreibung','sku','produkt_typ','waehrung','aktiv'];
  if(!row || !sent || !['sma','shopify'].includes(owner) || customer.n8n_kunde_id!==edit.kunde_id ||
      row.kunde_id!==customer.kunde_id || row.user_id!==customer.user_id ||
      row.sma_produkt_id!==edit.produkt_id || fields.some(k=>row[k]!==sent[k]) ||
      !Number.isFinite(row.preis) || row.preis!==sent.preis ||
      !Number.isSafeInteger(row.bestand) || row.bestand<0 ||
      (owner==='sma'&&row.bestand!==sent.bestand))throw Error('PRODUCT_EDIT_MIRROR_NOT_CONFIRMED');
  return {ok:true,produkt_id:edit.produkt_id,stock_owner:owner,bestand:row.bestand};
}

module.exports={productEditAttempt,productEditCustomerFilter,confirmProductEditCustomer,productEditMirrorBody,confirmProductEditMirror};
