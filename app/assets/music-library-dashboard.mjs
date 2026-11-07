import {mountMusicLibrary} from './music-library-view.mjs?v=2';
import {mountCatalog} from './music-catalog.mjs?v=2';
export function mountMusicLibraryDashboard({doc,api,stylesheetUrl,watchOwner,expectedOwnerId}){
 const entries=[],views=[];let destroyed=false;const style=doc.createElement('link');style.rel='stylesheet';style.href=stylesheetUrl;doc.head.append(style);
 for(const [key,playlist] of [['tracks',false],['playlist',true]]){const host=doc.getElementById('sma-music-panel-'+key);if(!host)continue;const old=[...host.childNodes];host.replaceChildren();entries.push({host,old});const view=mountMusicLibrary({doc,host,api,playlist,onChange:()=>views.forEach(v=>{if(v!==view)void v.refresh();})});views.push(view);}
 const catalogHost=doc.getElementById('sma-music-panel-catalog');
 const catalog=catalogHost&&api.catalog?mountCatalog({doc,host:catalogHost,api:api.catalog,goToCheckout:url=>window.location.assign(url)}):null;
 let sub;sub=watchOwner?.(id=>{if(id!==expectedOwnerId)destroy();});
 function destroy(){if(destroyed)return;destroyed=true;sub?.unsubscribe();catalog?.destroy();views.forEach(v=>v.destroy());entries.forEach(({host,old})=>host.replaceChildren(...old));style.remove();}
 return {destroy};
}
