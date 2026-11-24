import {createMusicPreview,musicFileLabel} from './music-file-preview.mjs?v=1';
import {createMusicClipFilters} from './music-clip-filters.mjs?v=1';
export const musicLibraryMessages={AUTH_REQUIRED:'Bitte melde dich erneut an.',ACCESS_INACTIVE:'Dein SMA-Zugang ist derzeit nicht aktiv.',ACCOUNT_UNAVAILABLE:'Dein Kundenkonto ist nicht eindeutig verfügbar.',MUSIC_INVALID:'Bitte MP3 oder WAV bis 8 MB wählen.',MUSIC_LIMIT:'Die Musikbibliothek ist voll (100 MB oder 100 Tracks).',MUSIC_NOT_FOUND:'Diese Musik ist noch nicht in deiner Bibliothek gespeichert.',MUSIC_REQUIRED:'Die gespeicherte Musik konnte nicht vollständig geladen werden. Bitte erneut versuchen.',MUSIC_INCOMPLETE:'Der Upload ist noch nicht vollständig. Wähle dieselbe Datei erneut.',MUSIC_CONFLICT:'Die Datei passt nicht zum gespeicherten Track.',MUSIC_UNAVAILABLE:'Die Musikbibliothek ist gerade nicht erreichbar. Bitte erneut versuchen.'};
export function mountMusicLibrary({doc,host,api,playlist=false,onSelect=null,selectionKey=()=>true,onChange=()=>{},createURL=b=>URL.createObjectURL(b),revokeURL=u=>URL.revokeObjectURL(u)}){
 let tracks=[],page=0,busy=false,disposed=false,epoch=0,controller=null;const cleanups=[];
 const recipe=t=>Object.fromEntries(['name','sha256','size_bytes','mime_type','volume','start_ms'].map(k=>[k,k==='volume'?25:k==='start_ms'?0:t[k]]));
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const root=el('div',null,'sma-music-library'),bar=el('div',null,'sma-music-actions'),add=el('button','Musik hinzufügen'),refresh=el('button','Aktualisieren'),input=el('input'),search=el('input'),status=el('p',null,'sma-music-status'),list=el('div'),pages=el('div',null,'sma-music-actions'),prev=el('button','Zurück'),next=el('button','Weiter'),count=el('span'),player=el('audio');
 input.type='file';input.accept='.mp3,.wav,audio/mpeg,audio/wav';input.hidden=true;search.type='search';search.placeholder='Musik suchen';search.setAttribute('aria-label','Musik suchen');player.controls=true;player.preload='metadata';player.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 for(const b of [add,refresh,prev,next])b.type='button';bar.append(add,refresh,input,search);pages.append(prev,count,next);root.append(bar,status,player,list,pages);host.append(root);
 const filters=createMusicClipFilters(doc,()=>{page=0;draw();});
 if(filters){filters.root.hidden=true;root.insertBefore(filters.root,status);}
 if(playlist)add.hidden=true;
 const say=text=>status.textContent=text;const live=e=>!disposed&&e===epoch;
 const preview=createMusicPreview({doc,audio:player,status,source:(t,signal)=>api.source(recipe(t),signal),createURL,revokeURL});
 function lock(v){busy=v;for(const b of root.querySelectorAll('button,input'))b.disabled=v;draw();}
 async function operation(fn){if(busy||disposed)return;const e=++epoch;controller=new AbortController();lock(true);try{await fn(controller.signal,e);}catch(error){if(live(e)&&!controller.signal.aborted){if(['AUTH_REQUIRED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE'].includes(error.message)){tracks=[];preview.stop();draw();}say(musicLibraryMessages[error.message]||musicLibraryMessages.MUSIC_UNAVAILABLE);}}finally{if(live(e)){controller=null;lock(false);}}}
 async function load(signal,e){const rows=await api.list(signal);if(!live(e))return;tracks=rows;if(filters){const options=playlist?rows.filter(t=>t.favourite):rows;filters.update(options);filters.root.hidden=!options.some(t=>t.mood);}draw();}
 const refreshList=()=>operation(async(s,e)=>{say('Musik wird geladen …');await load(s,e);if(live(e))say('');});
 function draw(){if(disposed)return;const visible=tracks.filter(t=>(!filters||filters.matches(t))&&(!playlist||t.favourite)&&t.name.toLocaleLowerCase('de').includes(search.value.toLocaleLowerCase('de'))),total=Math.max(1,Math.ceil(visible.length/5));page=Math.min(page,total-1);list.replaceChildren();
  for(const t of visible.slice(page*5,page*5+5)){const row=el('div',null,'sma-music-row'),actions=el('div',null,'sma-music-actions');
   const available=t.available!==false;
   const detail=available?(t.size_bytes/1000000).toLocaleString('de-AT',{maximumFractionDigits:2})+' MB · '+(t.mime_type==='audio/wav'?'WAV':'MP3'):'Unter „SMA-Musik“ freischaltbar';
   const info=musicFileLabel(doc,t,detail,available?()=>preview.play(t):null);
   if(available)info.disabled=busy;
   const action=(label,fn)=>{const b=el('button',label);b.type='button';b.disabled=busy;b.addEventListener('click',fn);actions.append(b);return b;};
   if(available)action(t.favourite?'Aus Playlist entfernen':'Zur Playlist',()=>operation(async(s,e)=>{await api.favourite(t,!t.favourite,s);await load(s,e);if(live(e)){say(t.favourite?'Aus deiner Playlist entfernt.':'Zur Playlist hinzugefügt.');onChange();}}));
   if(onSelect&&available)action('Verwenden',()=>operation(async(s,e)=>{const key=selectionKey();if(!key)return;say('Musik wird geladen …');const blob=await api.source(recipe(t),s);if(!live(e)||key!==selectionKey())return;await onSelect(t,blob);if(live(e))say('Musik für den Entwurf ausgewählt.');}));row.append(info,actions);list.append(row);
  }
  if(!visible.length)list.append(el('p',playlist?'Deine Playlist ist leer. Füge unter „Tracks“ Musik hinzu.':tracks.length?'Keine passende Musik gefunden.':'Hier erscheinen deine Musikdateien und SMA-Clips.'));
  count.textContent=visible.length+' Tracks · Seite '+(page+1)+' von '+total;prev.disabled=busy||page===0;next.disabled=busy||page>=total-1;pages.hidden=visible.length<=5;
 }
 function listen(n,event,fn){n.addEventListener(event,fn);cleanups.push(()=>n.removeEventListener(event,fn));}
 listen(add,'click',()=>input.click());listen(refresh,'click',refreshList);listen(search,'input',()=>{page=0;draw();});listen(prev,'click',()=>{page--;draw();});listen(next,'click',()=>{page++;draw();});listen(input,'change',()=>{const f=input.files?.[0];if(!f)return;void operation(async(s,e)=>{say('Musik wird gespeichert …');await api.upload(f,s);await load(s,e);if(live(e)){input.value='';say('Musik dauerhaft gespeichert.');onChange();}});});
 void refreshList();return {refresh:refreshList,destroy(){if(disposed)return;disposed=true;epoch++;controller?.abort();preview.stop();cleanups.forEach(f=>f());root.remove();}};
}
