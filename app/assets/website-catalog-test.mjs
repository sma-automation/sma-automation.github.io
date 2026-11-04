import {catalogFromSearch} from './shop-catalog-model.mjs?v=1';

const catalog=catalogFromSearch(location.search),$=id=>document.getElementById(id);
if(catalog){
 const frame=document.createElement('iframe');frame.title='Produkte aus deinem SMA-Shop';frame.loading='lazy';frame.referrerPolicy='no-referrer';
 // Same-origin preview; the copied code always points to the fixed live SMA URL.
 frame.src='./shop-catalog.html?shop='+catalog.slug;
 $('catalogPreview').append(frame);$('shopOpen').href=catalog.url;
 $('embedCode').value=catalog.html;$('buttonPreview').href='./website-connection-test.html?shop='+catalog.slug;
 $('catalogSetup').hidden=false;$('missing').hidden=true;
 $('copyCode').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(catalog.html);$('copyStatus').textContent='Einbaucode kopiert.';}
  catch{$('embedCode').focus();$('embedCode').select();$('copyStatus').textContent='Markierten Einbaucode mit Strg+C oder ⌘C kopieren.';}
 });
}
