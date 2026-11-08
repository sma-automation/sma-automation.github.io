// Inputs contain only the four customer-editable fields of one portal draft.
const labels={title:'Titel',body:'Beitragstext',hashtags:'Hashtags',product_id:'Linkziel'};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function display(key,value){
 if(key==='hashtags')return value.map(tag=>'#'+tag).join(' ')||'Keine Hashtags';
 if(key==='product_id')return value?'Shopartikel '+value:'Shop-Startseite';
 return value;
}

export function mountDraftConflict(doc){
 const dialog=doc.getElementById('draftConflictDialog'),fields=doc.getElementById('draftConflictFields');
 const accept=doc.getElementById('draftConflictApply'),back=doc.getElementById('draftConflictBack');
 let resolveChoice,merged,choices=[];
 function finish(result){
  const resolve=resolveChoice;
  resolveChoice=null;choices=[];merged=null;fields.replaceChildren();
  if(dialog.open)dialog.close();
  resolve?.(result);
 }
 function update(){accept.disabled=choices.some(choice=>!choice.mine.checked&&!choice.stored.checked);}
 accept.addEventListener('click',()=>{
  if(!resolveChoice||accept.disabled)return;
  for(const c of choices)merged[c.key]=c.mine.checked?c.local:c.remote;
  finish(merged);
 });
 back.addEventListener('click',()=>finish(null));
 dialog.addEventListener('close',()=>{if(!dialog.open&&resolveChoice)finish(null);});
 function option(field,key,source,value){
  const label=doc.createElement('label'),input=doc.createElement('input'),text=doc.createElement('span');
  input.type='radio';input.name='draft-conflict-'+key;input.addEventListener('change',update);
  text.textContent=source+' · '+display(key,value);label.append(input,text);field.append(label);
  return input;
 }
 return {
  clear:()=>finish(null),
  choose(base,local,remote){
   finish(null);merged={...remote};
   for(const [key,label] of Object.entries(labels)){
    const mine=local[key],stored=remote[key];
    if(equal(mine,base[key])&&equal(stored,base[key]))continue;
    const field=doc.createElement('fieldset'),legend=doc.createElement('legend');
    legend.textContent=label;field.append(legend);fields.append(field);
    if(!equal(mine,base[key])&&!equal(stored,base[key])&&!equal(mine,stored)){
     choices.push({key,local:mine,remote:stored,mine:option(field,key,'In diesem Tab',mine),stored:option(field,key,'Gespeichert',stored)});
    }else{
     const localChange=!equal(mine,base[key])&&!equal(mine,stored);
     merged[key]=localChange?mine:stored;
     const value=doc.createElement('p');value.textContent=(localChange?'In diesem Tab':'Gespeichert')+' · '+display(key,merged[key]);field.append(value);
    }
   }
   if(!fields.children.length){
    const note=doc.createElement('p');note.textContent='Die vier Felder stimmen mit dem gespeicherten Stand überein.';fields.append(note);
   }
   update();dialog.showModal();return new Promise(resolve=>{resolveChoice=resolve;});
  }
 };
}
