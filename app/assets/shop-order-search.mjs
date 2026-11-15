// Server-side filters for the current signed-in SMA merchant's orders.
// Never load all orders into the browser, never search other customers.
// A missing/invalid search must not be silently treated as "all orders".
const MARKETS=new Set(['all','shopify','digistore24']);
const MODES=new Set(['all','test','untagged','unknown']);
export function normalizeShopOrderFilters({search='',market='all',mode='all'}={}){
 const term=typeof search==='string'?search.trim():'';
 if(term.length>60||!(/^[\p{L}\p{N} #./-]*$/u.test(term))||
    !MARKETS.has(market)||!MODES.has(mode))
  throw Error('ORDER_SEARCH_INVALID');
 return Object.freeze({search:term,market,mode});
}
export function applyShopOrderFilters(query,filters){
 const f=normalizeShopOrderFilters(filters);
 // No percent / underscore / backslash accepted: no LIKE wildcards or
 // PostgREST grammar may come from a customer-supplied search term.
 if(f.search)query=query.ilike('bestellnummer','%'+f.search+'%');
 if(f.market!=='all')query=query.eq('markt',f.market);
 if(f.mode==='test')query=query.eq('ist_testbestellung',true);
 else if(f.mode==='untagged')query=query.eq('ist_testbestellung',false);
 else if(f.mode==='unknown')query=query.is('ist_testbestellung',null);
 return query;
}
export const orderFiltersActive=f=>Boolean(f.search||f.market!=='all'||f.mode!=='all');
