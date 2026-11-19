// Only the file assignment can supply a product ID. Never follow a URL from the draft text.
export function draftDestination(shop, draft, language) {
  if (typeof shop !== 'string' || !/^https:\/\/sma-automation\.com\/app\/shop\.html\?shop=[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shop)) return null;
  if (draft && (Object.hasOwn(draft, 'offer_provider') || Object.hasOwn(draft, 'offer_url') ||
     Object.hasOwn(draft, 'offer_product_id'))) {
    if (draft.offer_provider !== 'digistore24' || Object.hasOwn(draft, 'product_id') ||
        typeof draft.offer_product_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(draft.offer_product_id) ||
        typeof draft.offer_url !== 'string' ||
        !/^https:\/\/www\.checkout-ds24\.com\/redir\/[1-9][0-9]{0,11}\/[A-Za-z0-9._-]{1,80}(?:\/[A-Za-z0-9._-]{1,127})?\/?$/.test(draft.offer_url)) return null;
    return {url:draft.offer_url, label:language === 'en' ? 'View offer' : 'Zum Angebot'};
  }
  if (draft && Object.hasOwn(draft, 'product_id')) {
    if (typeof draft.product_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(draft.product_id)) return null;
    return {url:shop + '&produkt=' + draft.product_id, label:language === 'en' ? 'View product' : 'Zum Produkt'};
  }
  return {url:shop, label:language === 'en' ? 'Visit our shop' : 'Zum Shop'};
}
