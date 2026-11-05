'use strict';
function validatePages(pages, claim, now = Date.now()) {
  if (!claim?.claimed || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(claim.shop_domain || '')) throw Error('INVALID_CLAIM');
  if (!Array.isArray(pages) || !pages.length || pages.length > 200) throw Error('INVALID_PAGES');
  const ids = new Set(), cursors = new Set(), orders = [];
  const financial = new Set(['AUTHORIZED','EXPIRED','PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','PENDING','REFUNDED','VOIDED']);
  const fulfillment = new Set(['FULFILLED','FULFILLMENT_NOT_REQUIRED','IN_PROGRESS','ON_HOLD','OPEN','PARTIALLY_FULFILLED','PENDING_FULFILLMENT','REQUEST_DECLINED','RESTOCKED','SCHEDULED','UNFULFILLED']);
  pages.forEach((page, index) => {
    if (page?.error || (page?.errors && (!Array.isArray(page.errors) || page.errors.length))) throw Error('SHOPIFY_ERROR');
    const connection = page?.data?.orders, info = connection?.pageInfo;
    if (!Array.isArray(connection?.nodes) || typeof info?.hasNextPage !== 'boolean') throw Error('INVALID_PAGE');
    if (info.hasNextPage !== (index < pages.length - 1)) throw Error('INCOMPLETE_PAGINATION');
    if (info.hasNextPage && (typeof info.endCursor !== 'string' || !info.endCursor || cursors.has(info.endCursor))) throw Error('INVALID_CURSOR');
    if (info.endCursor) cursors.add(info.endCursor);
    for (const o of connection.nodes) {
      const money = o?.currentTotalPriceSet?.shopMoney;
      const created = Date.parse(o?.createdAt), updated = Date.parse(o?.updatedAt);
      if (!/^gid:\/\/shopify\/Order\/[0-9]+$/.test(o?.id || '') || ids.has(o.id)) throw Error('INVALID_ORDER_ID');
      if (typeof o.name !== 'string' || !o.name || o.name.length > 255 || !Number.isFinite(created) || !Number.isFinite(updated) || updated < created || updated > now + 300000) throw Error('INVALID_ORDER');
      if (o.displayFinancialStatus !== null && !financial.has(o.displayFinancialStatus)) throw Error('INVALID_FINANCIAL_STATUS');
      if (!fulfillment.has(o.displayFulfillmentStatus)) throw Error('INVALID_FULFILLMENT_STATUS');
      if (typeof o.test !== 'boolean') throw Error('INVALID_TEST_FLAG');
      if (typeof money?.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(money.amount) || Number(money.amount) > 1e12 || !/^[A-Z]{3}$/.test(money?.currencyCode || '')) throw Error('INVALID_MONEY');
      ids.add(o.id);
      orders.push({externe_bestell_id:o.id,bestellnummer:o.name,erstellt_am:o.createdAt,
        quelle_aktualisiert_am:o.updatedAt,zahlungsstatus:(o.displayFinancialStatus || 'UNKNOWN').toLowerCase(),
        lieferstatus:o.displayFulfillmentStatus.toLowerCase(),gesamtbetrag:money.amount,waehrung:money.currencyCode,
        ist_testbestellung:o.test});
    }
  });
  if (orders.length > 10000) throw Error('ORDER_LIMIT');
  return {complete:true,pages:pages.length,shop_domain:claim.shop_domain,
    markt_konto_id:claim.markt_konto_id,kunde_id:claim.kunde_id,orders};
}
module.exports = { validatePages };
