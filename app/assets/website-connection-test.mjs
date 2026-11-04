import {shopButtonFromSearch,shopButtonStyle} from './shop-button.mjs?v=1';

const button=shopButtonFromSearch(location.search);
const $=id=>document.getElementById(id);
if(button){
 $('shopButton').href=button.url;
 $('shopButton').textContent=button.label;
 $('shopButton').style.cssText=shopButtonStyle;
 $('shopAddress').textContent=button.url;
 $('embedCode').value=button.html;
 $('connection').hidden=false;
 $('missing').hidden=true;
 $('copyCode').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(button.html);$('copyStatus').textContent='Einbaucode kopiert.';}
  catch{$('embedCode').focus();$('embedCode').select();$('copyStatus').textContent='Markierten Einbaucode mit Strg+C oder ⌘C kopieren.';}
 });
}
