import {catalogFromSearch,fetchCatalog} from './shop-catalog-model.mjs?v=1';

// Public catalog only: no session, storage, account API, cart or checkout.
export function mountShopCatalog({doc=document,search=doc.defaultView.location.search,request=fetchCatalog}={}){
 const config=catalogFromSearch(search),$=id=>doc.getElementById(id),win=doc.defaultView;
 let page=1,serial=0,controller=null,destroyed=false,busy=false;
 if(!config)return {destroy(){}};
 $('shopOpen').href=config.url;$('shopOpen').hidden=false;$('refresh').hidden=false;
 function notice(text,error=false){$('catalogStatus').textContent=text;$('catalogStatus').classList.toggle('error',error);}
 function card(product){
  const row=doc.createElement('article');row.className='product';
  const photo=doc.createElement('div');photo.className='photo';
  const placeholder=()=>{const span=doc.createElement('span');span.textContent='Kein Produktbild';photo.replaceChildren(span);};
  if(product.image){const img=doc.createElement('img');img.src=product.image;img.alt=product.title;img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',placeholder,{once:true});photo.append(img);}else placeholder();
  const copy=doc.createElement('div'),title=doc.createElement('h2'),availability=doc.createElement('p');
  title.textContent=product.title;title.tabIndex=-1;availability.className='availability';
  availability.textContent=!product.ready?'Noch nicht bestellbar':product.stock===null?'Verfügbarkeit im Shop prüfen':product.stock>0?product.stock+' verfügbar':'Derzeit nicht lieferbar';
  copy.append(title,availability);
  const amount=doc.createElement('span');amount.className='price';amount.textContent='Preis im Shop';
  if(product.price!==null){try{amount.textContent=new Intl.NumberFormat('de-AT',{style:'currency',currency:product.currency}).format(product.price);}catch{}}
  row.append(photo,copy,amount);return row;
 }
 async function load(target,scroll=false){
  if(destroyed||busy)return;
  const seq=++serial;busy=true;page=target;controller=new win.AbortController();
  const timer=win.setTimeout(()=>controller?.abort(),10000);
  $('products').replaceChildren();$('products').setAttribute('aria-busy','true');$('pager').hidden=true;$('catalogNote').hidden=true;$('refresh').disabled=true;
  $('merchantName').textContent='SMA Shop';notice('Produkte werden geladen …');
  try{
   let result=await request({slug:config.slug,page:target,signal:controller.signal});
   if(!destroyed&&seq===serial&&target>1&&!result.products.length){page=1;result=await request({slug:config.slug,page:1,signal:controller.signal});}
   if(destroyed||seq!==serial)return;
   $('merchantName').textContent=result.name;
   for(const product of result.products)$('products').append(card(product));
   notice(result.total?result.total+(result.total===1?' Produkt · Stand ':' Produkte · Stand ')+new Intl.DateTimeFormat('de-AT',{hour:'2-digit',minute:'2-digit'}).format(new Date()):'Derzeit sind keine Produkte verfügbar.');
   $('pageNumber').textContent='Seite '+page+' von '+Math.max(1,result.pages);
   $('previous').disabled=page<=1;$('next').disabled=page>=result.pages;
   $('pager').hidden=result.pages<=1;$('catalogNote').hidden=false;
   if(scroll){$('products').querySelector('h2')?.focus({preventScroll:true});$('products').scrollIntoView({block:'start',behavior:'auto'});}
  }catch{
   if(destroyed||seq!==serial)return;
   // A failed refresh must not leave old prices or stock visible.
   $('products').replaceChildren();notice('Produkte derzeit nicht verfügbar. Bitte erneut aktualisieren oder den Shop öffnen.',true);
  }finally{
   win.clearTimeout(timer);
   if(!destroyed&&seq===serial){busy=false;$('refresh').disabled=false;$('products').setAttribute('aria-busy','false');}
  }
 }
 const refresh=()=>load(page),previous=()=>load(Math.max(1,page-1),true),next=()=>load(Math.min(1000,page+1),true);
 $('refresh').addEventListener('click',refresh);$('previous').addEventListener('click',previous);$('next').addEventListener('click',next);
 load(1);
 return {destroy(){destroyed=true;serial++;controller?.abort();$('refresh').removeEventListener('click',refresh);$('previous').removeEventListener('click',previous);$('next').removeEventListener('click',next);$('products').replaceChildren();$('pager').hidden=true;}};
}

