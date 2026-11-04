import {safeShopLink} from './website-domain-model.mjs?v=1';

export const catalogOrigin='https://bnvnmdxosbnuzedokqgh.supabase.co';
const api=catalogOrigin+'/functions/v1/sma-shop-produkte';
const validSlug=value=>typeof value==='string'&&value.length<=63&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function createShopCatalog(value){
 const url=safeShopLink(value);
 if(!url||url.trim()!==url)return null;
 const slug=new URL(url).searchParams.get('shop');
 if(!validSlug(slug))return null;
 const src='https://sma-automation.com/app/shop-catalog.html?shop='+slug;
 return {slug,url,src,previewUrl:'https://sma-automation.com/app/website-catalog-test.html?shop='+slug,
  html:`<iframe src="${src}" title="Produkte aus unserem SMA-Shop" width="100%" height="640" loading="lazy" referrerpolicy="no-referrer" style="display:block;width:100%;height:640px;border:1px solid #e4e7ed;border-radius:12px;background:#fff"></iframe>\n<p><a href="${url}" target="_blank" rel="noopener noreferrer">Shop separat öffnen</a></p>`};
}

export function catalogFromSearch(search){
 if(typeof search!=='string'||search.length>200)return null;
 const params=new URLSearchParams(search);
 if(params.size!==1||!validSlug(params.get('shop')))return null;
 return createShopCatalog('https://sma-automation.com/app/shop.html?shop='+params.get('shop'));
}

export function catalogRequestUrl(slug,page){
 if(!validSlug(slug)||!Number.isSafeInteger(page)||page<1||page>1000)fail('INVALID_REQUEST');
 return api+'?'+new URLSearchParams({shop:slug,seite:String(page)});
}

function productImage(value){
 if(typeof value!=='string'||value.length>4096)return null;
 try{
  const url=new URL(value);
  if(url.origin!==catalogOrigin||url.username||url.password||url.hash||!url.pathname.startsWith('/storage/v1/object/sign/sma-produktbilder/'))return null;
  return url.href;
 }catch{return null;}
}

export function readCatalog(value,slug,page){
 catalogRequestUrl(slug,page);
 if(value?.ok!==true)fail('UNAVAILABLE');
 if(value.shop?.slug!==slug||typeof value.shop.name!=='string'||value.shop.name.length>500||value.seite!==page||value.pro_seite!==10||
  !Number.isSafeInteger(value.gesamt)||value.gesamt<0||value.seiten!==Math.ceil(value.gesamt/10)||!Array.isArray(value.produkte)||value.produkte.length>10)fail('INVALID_RESPONSE');
 const expected=Math.min(10,Math.max(0,value.gesamt-(page-1)*10));
 if(value.produkte.length!==expected)fail('INVALID_RESPONSE');
 const ids=new Set();
 const products=value.produkte.map(p=>{
  if(!p||typeof p.produkt_id!=='string'||!p.produkt_id||p.produkt_id.length>200||ids.has(p.produkt_id)||typeof p.name!=='string'||p.name.length>1000)fail('INVALID_RESPONSE');
  ids.add(p.produkt_id);
  // Missing prices or inventory must not turn into a free or available product.
  const price=(typeof p.preis==='number'||typeof p.preis==='string'&&/^\d+(?:\.\d{1,2})?$/.test(p.preis))?Number(p.preis):NaN;
  const currency=typeof p.waehrung==='string'&&/^[A-Z]{3}$/.test(p.waehrung)?p.waehrung:null;
  return {id:p.produkt_id,title:p.name||'Produkt',price:Number.isFinite(price)&&price>=0&&price<=1e9&&currency?price:null,currency,
   stock:Number.isSafeInteger(p.bestand)&&p.bestand>=0?p.bestand:null,ready:p.shopify_aktiv===true,
   image:(Array.isArray(p.bilder)?p.bilder:[]).slice(0,8).map(productImage).find(Boolean)||null};
 });
 return {name:value.shop.name||'SMA Shop',page,total:value.gesamt,pages:Math.min(1000,value.seiten),products};
}

export async function fetchCatalog({slug,page=1,fetcher=fetch,signal}){
 const response=await fetcher(catalogRequestUrl(slug,page),{method:'GET',mode:'cors',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',headers:{Accept:'application/json'},signal});
 if(!response.ok)fail('UNAVAILABLE');
 return readCatalog(await response.json(),slug,page);
}
