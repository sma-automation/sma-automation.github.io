import {mountMusicLibrary} from './music-library-view.mjs?v=2';
import {mountCatalog} from './music-catalog.mjs?v=2';
export function mountMusicLibraryDashboard({doc,api,stylesheetUrl,watchOwner,expectedOwnerId}){
 const entries=[],views=[],addedHosts=[];let destroyed=false;const style=doc.createElement('link');style.rel='stylesheet';style.href=stylesheetUrl;doc.head.append(style);
 // The shared chapter navigator creates chapter sections, not fixed music slot IDs.
 // Reuse a dedicated host if supplied by the shell; otherwise insert one into
 // the matching chapter without replacing any existing cards or input fields.
 function chapterHost(key){
  const id='sma-music-panel-'+key,existing=doc.getElementById(id);
  if(existing)return existing;
  const panel=doc.querySelector('#page-music > .sma-chapter-panel[data-chapter="'+key+'"]');
  if(!panel)return null;
  const host=doc.createElement('div');host.id=id;panel.append(host);addedHosts.push(host);return host;
 }
 for(const [key,playlist] of [['tracks',false],['playlist',true]]){const host=chapterHost(key);if(!host)continue;const old=[...host.childNodes];host.replaceChildren();entries.push({host,old});const view=mountMusicLibrary({doc,host,api,playlist,onChange:()=>views.forEach(v=>{if(v!==view)void v.refresh();})});views.push(view);}
 const catalogHost=chapterHost('catalog');
 const catalog=catalogHost&&api.catalog?mountCatalog({doc,host:catalogHost,api:api.catalog,goToCheckout:url=>window.location.assign(url)}):null;
 let sub;sub=watchOwner?.(id=>{if(id!==expectedOwnerId)destroy();});
 function destroy(){if(destroyed)return;destroyed=true;sub?.unsubscribe();catalog?.destroy();views.forEach(v=>v.destroy());entries.forEach(({host,old})=>host.replaceChildren(...old));addedHosts.forEach(host=>host.remove());style.remove();}
 return {destroy};
}
