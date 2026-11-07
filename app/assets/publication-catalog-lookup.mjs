// The two pickers show the same names and only select an explicitly supplied ID.
export function fillProductChoices(doc, select, choices, wanted) {
  const placeholder=doc.createElement('option');
  placeholder.value='';placeholder.textContent='Bitte auswählen';select.replaceChildren(placeholder);
  const labels=choices.map(c=>c.sku?c.name+' · '+c.sku:c.name);
  const counts=new Map();
  for(const label of labels)counts.set(label,(counts.get(label)||0)+1);
  for(const [i,item] of choices.entries()){
    const option=doc.createElement('option');option.value=item.product_id;
    option.textContent=counts.get(labels[i])>1?labels[i]+' · '+item.product_id:labels[i];
    select.append(option);
  }
  const selected=choices.find(item=>item.product_id===wanted);
  select.value=selected?.product_id||'';
  return selected;
}

export function mountCatalogLookup(doc,lookup){
  const el=id=>doc.getElementById(id);
  const panel=el('catalogLookup'),query=el('catalogQuery'),select=el('catalogProduct');
  const button=el('catalogSearch'),more=el('catalogMore'),status=el('catalogStatus');
  let context=null,choices=[],serial=0,pending=false;
  const selected=()=>choices.find(item=>item.product_id===select.value);
  function reset(){
    serial++;pending=false;choices=[];select.replaceChildren();select.value='';
    el('catalogResults').hidden=true;more.hidden=true;status.textContent='';button.disabled=false;
  }
  async function search(append=false){
    if(!context||el('catalogLookupFields').disabled||pending||(append&&more.hidden))return;
    const previous=append?choices:[];
    const params={query:query.value.trim()};
    if(append)params.after=previous[previous.length-1].product_id;
    if(!append)reset();
    const ticket=++serial;
    pending=true;button.disabled=more.disabled=true;status.textContent='Artikel werden geladen …';
    try{
      const result=await lookup(context,params);
      if(ticket!==serial)return;
      choices=[...previous,...result.choices];
      fillProductChoices(doc,select,choices,append?select.value:'');
      el('catalogResults').hidden=!choices.length;more.hidden=result.more!==true;
      status.textContent=choices.length?'':'Keine passenden Shopartikel gefunden.';
    }catch(error){
      if(ticket===serial)status.textContent=error.message;
    }finally{
      if(ticket===serial){pending=false;button.disabled=more.disabled=false;}
    }
  }
  button.addEventListener('click',()=>search());
  more.addEventListener('click',()=>search(true));
  query.addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();void search();}
  });
  query.addEventListener('input',reset);
  panel.addEventListener('input',event=>event.stopPropagation());
  panel.addEventListener('toggle',()=>{
    if(panel.open&&!panel.hidden&&!pending&&!choices.length&&!query.value)void search();
  });
  return {
    selected,
    setContext(file,platform,saved){
      if(!file||file.id!==context?.asset_id||file.revision!==context?.asset_revision||platform!==context?.platform){
        reset();query.value='';panel.open=false;
        context=file?{asset_id:file.id,asset_revision:file.revision,platform}:null;
      }
      panel.hidden=!context;
      if(saved&&context){
        reset();choices=[saved];fillProductChoices(doc,select,choices,saved.product_id);
        el('catalogResults').hidden=false;panel.open=true;
      }
    },
    async validate(){
      if(pending)throw Error('Die Artikelsuche läuft noch.');
      const choice=selected();
      if(!choice)return null;
      const ticket=serial,result=await lookup(context,{product_id:choice.product_id});
      if(ticket!==serial)throw Error('Die Artikelauswahl hat sich geändert.');
      const item=result.choices[0];
      if(item?.product_id!==choice.product_id||item.name!==choice.name||item.purpose!==choice.purpose){
        reset();panel.open=true;status.textContent='Der gewählte Artikel hat sich geändert. Bitte suche ihn erneut.';
        throw Error(status.textContent);
      }
      return {...item,state:'matched',chosen:true,fromCatalog:true};
    }
  };
}
