// Only the file assignment can supply a product ID. Never follow a URL from the draft text.
export function draftDestination(shop, draft, language) {
  if (typeof shop !== 'string' || !/^https:\/\/sma-automation\.com\/app\/shop\.html\?shop=[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shop)) return null;
  if (draft && Object.hasOwn(draft, 'product_id')) {
    if (typeof draft.product_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(draft.product_id)) return null;
    return {url:shop + '&produkt=' + draft.product_id, label:language === 'en' ? 'View product' : 'Zum Produkt'};
  }
  return {url:shop, label:language === 'en' ? 'Visit our shop' : 'Zum Shop'};
}
