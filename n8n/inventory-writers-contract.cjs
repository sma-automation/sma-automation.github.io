'use strict';

function writerVersion(row) {
  if (!Number.isSafeInteger(row?.id) || row.id <= 0 || typeof row.updatedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.updatedAt) || !Number.isFinite(Date.parse(row.updatedAt)))
    throw new Error('STOCK_ROW_VERSION_REQUIRED');
}
function prepareProductEdit(product, mappings, body) {
  writerVersion(product);
  if (!product.kunde_id || !product.produkt_id || !body || body.produkt_id !== product.produkt_id || !Array.isArray(mappings))
    throw new Error('PRODUCT_EDIT_IDENTITY');
  const rows=mappings.filter(r=>r && Object.keys(r).length);
  if (rows.some(r=>r.kunde_id!==product.kunde_id || r.produkt_id!==product.produkt_id || r.markt!=='shopify'))
    throw new Error('PRODUCT_EDIT_MAPPING');
  // Any established Shopify product keeps stock ownership, including a mapping
  // temporarily paused for sync. Removing stock ownership needs its own process.
  const shopify=rows.some(r=>r.externe_produkt_id||r.externe_variant_id);
  let target=product.bestand;
  if (body.bestand !== undefined) {
    if (!['number','string'].includes(typeof body.bestand) || String(body.bestand).trim()==='') throw new Error('PRODUCT_EDIT_STOCK_INVALID');
    target=Number(body.bestand);
    if (!Number.isSafeInteger(target) || target<0) throw new Error('PRODUCT_EDIT_STOCK_INVALID');
    if (shopify && target!==product.bestand) throw new Error('SHOPIFY_STOCK_USE_STOCK_ORDER');
  }
  return {...product,stock_owner:shopify?'shopify':'sma',expected_stock:target};
}
function confirmProductEdit(rows, before) {
  if (!Array.isArray(rows) || rows.length!==1 || !rows[0] || !Object.keys(rows[0]).length)
    throw new Error('PRODUCT_EDIT_CONFLICT_RELOAD_REQUIRED');
  const row=rows[0];writerVersion(row);
  if (row.id!==before.id || row.kunde_id!==before.kunde_id || row.produkt_id!==before.produkt_id ||
      row.bestand!==before.expected_stock || Date.parse(row.updatedAt)<=Date.parse(before.updatedAt))
    throw new Error('PRODUCT_EDIT_NOT_CONFIRMED');
  return row;
}
module.exports={writerVersion,prepareProductEdit,confirmProductEdit};
