import {safeShopLink} from './website-domain-model.mjs?v=1';

export const shopButtonStyle='display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:44px;padding:12px 20px;border-radius:9px;background:#4065d8;color:#fff;font:inherit;font-weight:600;line-height:1.4;text-decoration:none';

// Only the public shop address enters this script-free, portable HTML link.
// No customer ID, session, credential, tracking parameter or website claim.
export function createShopButton(value){
 const url=safeShopLink(value);
 if(!url||url.trim()!==url)return null;
 const slug=new URL(url).searchParams.get('shop');
 return {
  url,label:'Zum Shop',
  html:`<a href="${url}" style="${shopButtonStyle}">Zum Shop</a>`,
  previewUrl:'https://sma-automation.com/app/website-connection-test.html?shop='+slug
 };
}

export function shopButtonFromSearch(search){
 if(typeof search!=='string'||search.length>200)return null;
 const params=new URLSearchParams(search);
 if(params.size!==1||!params.has('shop'))return null;
 return createShopButton('https://sma-automation.com/app/shop.html?shop='+params.get('shop'));
}
