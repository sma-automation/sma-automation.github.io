const marketName={shopify:'Shopify',digistore24:'Digistore24'};
const stateLabel={connection:'Konto verbinden',queued:'Vorgemerkt',running:'Wird übertragen',synced:'Übernommen',attention:'Prüfung erforderlich'};
const reasons={RECONNECT:'Verbindung erneuern',CONFLICT:'Produktzuordnung prüfen',CHECK_RESULT:'Antwort des Marktes prüfen',PRODUCT_INPUT:'Produktangaben prüfen',REJECTED:'Markt hat die Anfrage abgelehnt',SKU_EXISTS:'Diese Artikelnummer ist bereits vergeben.',PLAN_CHANGED:'Der Artikel wurde zwischenzeitlich geändert.',CATEGORY:'Digistore24-Kategorie für diese Produktart wählen.'};
function append(parent,tag,text){const n=document.createElement(tag);if(text)n.textContent=text;parent.append(n);return n;}
function input(form,label,type='text'){
 const l=append(form,'label',label+' '),n=append(l,type==='textarea'?'textarea':'input');
 if(type!=='textarea')n.type=type;n.required=true;return n;
}
function button(parent,text,type='button'){const b=append(parent,'button',text);b.type=type;return b;}
export async function mountMarketCatalog(host,db,reload,products,visible){
 const rpc=async(action,fields={})=>{const {data,error}=await db.rpc('sma_market_catalog_v1',{action,fields});if(error||!data?.ok)throw Error(reasons[data?.code]||'Der Shop konnte nicht aktualisiert werden.');return data;};
 let config=await rpc('get');if(!config.enabled)return;
 host.hidden=false;
 let refreshTimer;
 const setup=append(host,'details');append(setup,'summary','Verkaufskanäle');
 const connections=append(setup,'div');
 const add=append(host,'details');const summary=append(add,'summary','Produkt anlegen');
 const form=append(add,'form'),title=input(form,'Produktname'),sku=input(form,'Artikelnummer'),price=input(form,'Preis in EUR','number'),description=input(form,'Beschreibung','textarea');
 title.maxLength=240;sku.pattern='[A-Za-z0-9_.\\-]{1,80}';sku.maxLength=80;price.step='0.01';price.min='0.01';price.max='9999999';description.required=false;description.maxLength=5000;
 const group=append(form,'label','Produktart '),kind=append(group,'select');for(const v of ['Digital','Dienstleistung','Physisch'])kind.append(new Option(v,v));
 const save=button(form,'In SMA speichern','submit'),status=append(host,'p');status.setAttribute('role','status');let requestId=crypto.randomUUID(),editVersion=null;
 const cancel=button(form,'Abbrechen');
 function clear(){requestId=crypto.randomUUID();editVersion=null;sku.readOnly=false;summary.textContent='Produkt anlegen';form.reset();add.open=false;}
 cancel.onclick=clear;
 async function edge(data){
  const {data:result,error}=await db.functions.invoke('sma-market-catalog',{body:data});
  if(error||result?.ok!==true){let code=result?.code;try{code??=(await error.context.json()).code;}catch{}throw Error(reasons[code]||'Verbindung konnte nicht bestätigt werden. Prüfe Händlerkonto, Berechtigungen und Zugang.');}
  return result;
 }
 function render(){
  connections.replaceChildren();
  for(const market of Object.keys(marketName)){
   append(connections,'p',marketName[market]+' · '+(config.accounts[market]||'Noch nicht verbunden'));
   if(config.accounts[market]&&!config.rows.some(r=>r.market===market&&['RECONNECT','CATEGORY'].includes(r.code)))continue;
   const f=append(connections,'form');
   const identity=input(f,market==='shopify'?'Shop-Domain':'Digistore24-ID');
   if(market==='shopify'){identity.value=config.shop;identity.readOnly=true;}
   const clientId=market==='shopify'?input(f,'Shopify App-Client-ID'):null;
   const key=input(f,market==='shopify'?'Shopify App-Client-Secret':'Digistore24-API-Schlüssel','password');key.autocomplete='off';
   const categories=market==='digistore24'?append(f,'fieldset'):null;
   if(categories){categories.hidden=true;append(categories,'legend','Produktarten in Digistore24');}
   const send=button(f,categories?'Produktarten laden':'Konto verbinden','submit');
   const note=append(f,'p');note.setAttribute('role','status');
   const resetTypes=()=>{if(categories){categories.hidden=true;categories.querySelectorAll('label').forEach(l=>l.remove());send.textContent='Produktarten laden';}};
   identity.addEventListener('input',resetTypes);key.addEventListener('input',resetTypes);
   f.onsubmit=async e=>{
    e.preventDefault();send.disabled=true;note.textContent='Verbindung wird geprüft …';
    try{
     const choose=categories?.hidden===true;
     const mapping=categories?Object.fromEntries([...categories.querySelectorAll('select')].filter(s=>s.value).map(s=>[s.name,Number(s.value)])):null;
     const res=await edge({market,identity:identity.value.trim(),credentials:clientId?{client_id:clientId.value.trim(),client_secret:key.value.trim()}:{key:key.value.trim()},categories:mapping,action:choose?'categories':'connect'});
     if(choose){
      for(const [name,allowed] of Object.entries({Digital:['digital','download'],Dienstleistung:['service'],Physisch:['shipping']})){
       const options=res.types.filter(t=>allowed.includes(t.delivery));
       if(!options.length)continue;
       const l=append(categories,'label',name+' '),sel=append(l,'select');sel.name=name;
       sel.append(new Option('Keine Zuordnung',''),...options.map(t=>new Option(t.name,t.id)));
      }
      categories.hidden=false;send.textContent='Konto verbinden';note.textContent='Wähle einmalig die Digistore24-Kategorie für die Produktarten in deinem Shop.';
     }
     else{key.value='';config=await rpc('get');render();await refresh();status.textContent='Verbindung bestätigt. Vorgemerkte Produkte werden automatisch übertragen.';}
    }catch(e){note.textContent=e.message;}finally{send.disabled=false;}
   };
  }
 }
 render();
 form.onsubmit=async e=>{
  e.preventDefault();save.disabled=true;
  try{await rpc('save',{id:requestId,title:title.value.trim(),sku:sku.value.trim(),price:price.value,description:description.value,kind:kind.value,...(editVersion?{version:editVersion}:{})});clear();status.textContent='Gespeichert und für beide Verkaufskanäle vorgemerkt.';await reload();}
  catch(e){status.textContent=e.message;}finally{save.disabled=false;}
 };
 async function refresh(){
  clearTimeout(refreshTimer);
  const cards=[...document.querySelectorAll('[data-market-product]')];if(!cards.length)return;
  const view=await rpc('get',{ids:cards.map(n=>n.dataset.marketProduct)});
  if(view.rows.some(r=>['queued','running'].includes(r.state)))refreshTimer=setTimeout(()=>{if(visible())void refresh().catch(()=>{});},30000);
  for(const card of cards){
   const rows=view.rows.filter(r=>r.id===card.dataset.marketProduct);
   card.replaceChildren();const text=append(card,'span','');text.textContent=rows.map(r=>marketName[r.market]+' · '+(reasons[r.code]&&r.state==='attention'?reasons[r.code]:stateLabel[r.state]||r.state)).join('   /   ');
   const item=products().find(p=>p.sma_produkt_id===card.dataset.marketProduct);
   if(rows.length&&item?.updated_at){
    const edit=button(card,'Stammdaten bearbeiten');
    edit.onclick=()=>{requestId=item.sma_produkt_id;editVersion=item.updated_at;title.value=item.produkt_name;sku.value=item.sku;sku.readOnly=true;
     description.value=item.beschreibung||'';price.value=item.preis;kind.value=item.produkt_typ;summary.textContent='Produkt bearbeiten';add.open=true;title.focus();};
   }
  }
 }
 document.addEventListener('visibilitychange',()=>{if(visible())void refresh().catch(()=>{});});
 window.addEventListener('pagehide',()=>clearTimeout(refreshTimer));
 await refresh();
 return refresh;
}
