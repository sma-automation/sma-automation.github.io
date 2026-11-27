import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {createOrderClient} from './publication-order.mjs?v=34';
import {refreshMediaCatalog} from './media-metadata.mjs?v=3';
import {createPortalVideoSource} from './portal-video-playback.mjs?v=2';
import {createManualVideoThumbnails} from './manual-video-thumbnail.mjs?v=1';
import {createMediaThumbnailLoader} from './asset-thumbnail.mjs?v=4';
import {createSharedThumbnailClient} from './thumbnail-batch.mjs?v=1';
import {createDeliveryMonitor} from './portal-delivery-monitor.mjs?v=1';
import {mountManualComposer} from './manual-post-composer.mjs?v=3';
import {describeFile} from './file-description.mjs?v=4';

import {createManualIntake,mountManualDrop,manualURL,driveOpenId,driveIdFromLink} from './manual-file-input.mjs?v=1';
import {manualVideoPreview} from './manual-video-preview.mjs?v=2';
import {watchPortalCatalog} from './portal-catalog-watch.mjs?v=1';
const db=createClient('https://bnvnmdxosbnuzedokqgh.supabase.co','sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const params=new URLSearchParams(location.search),platform=params.get('portal');
const portals={youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'};
const $=id=>document.getElementById(id);
const errors={INVALID_EDIT:'Der Beitragstext muss 10 bis 1.200 Zeichen enthalten. Prüfe auch die Hashtags.',INVALID_HASHTAGS:'Prüfe Anzahl und Schreibweise der Hashtags.',CAPTION_TOO_LONG:'Der Beitrag ist mit Hashtags und Link zu lang.',CAPTION_TOO_SIMILAR:'Der Beitragstext ähnelt einem bereits gespeicherten Text zu stark.',PUBLIC_SHOP_REQUIRED:'Für diesen Beitrag ist ein eingerichteter SMA-Shop erforderlich.',ASSIGNMENT_CONFLICT:'Der Entwurf wurde inzwischen geändert. Öffne die Datei erneut.',REVISION_CONFLICT:'Der Beitrag wurde inzwischen geändert. Öffne die Datei erneut.',FILE_REFRESH_REQUIRED:'Die Dateidaten sind veraltet. Aktualisiere den Ordner.',FILE_CHANGED:'Die Dateiversion wurde geändert. Aktualisiere den Ordner.',FILE_UNAVAILABLE:'Diese Datei ist im ausgewählten Portal nicht mehr verfügbar.',PORTAL_MEDIA_PROOF_REQUIRED:'Für diese Datei fehlt der Nachweis für das sichtbare Profillogo und die passende hörbare Musik.',AUTH_REQUIRED:'Melde dich im SMA-Kundenbereich an.',TARGET_ACCOUNT_REQUIRED:'Für dieses Portal ist kein Versandkonto verbunden.',FOLDER_OR_FILE_UNAVAILABLE:'Dieser Ordner oder diese Dateiversion ist derzeit nicht verfügbar.',INVALID_TIME:'Wähle eine spätere Uhrzeit für heute in Wien.',ORDER_CHANGED:'Die Datei oder Freigabe hat sich geändert. Lade den aktuellen Beitrag.'};
const visibility={PUBLIC_TO_EVERYONE:'Öffentlich',public:'Öffentlich',unlisted:'Nicht gelistet',private:'Privat',SELF_ONLY:'Nur ich',MUTUAL_FOLLOW_FRIENDS:'Freunde',FOLLOWER_OF_CREATOR:'Follower'};
let owner,driveAccount=null,files=[],entry=null,selection=0,loading=false,busy=false,statusTimer,folderTimer,folderRound=0;
let chosen=params.get('asset')||'',localMedia=null;
const preview=manualVideoPreview($('mediaPreview'),$('mediaNotice'));
const transport=createOrderClient({session});
const startedOrders=new Set();
const monitor=createDeliveryMonitor({rpc,transport,platform,portalName:portals[platform],ownsOrder,errorLabels:errors});
const thumbnailClient=createSharedThumbnailClient({getSession:session,getOwnerId:()=>owner});
const clips=createPortalVideoSource({client:()=>db,owner:()=>owner});
const posters=createManualVideoThumbnails({portal:platform,clips,drive:thumbnailClient});
const thumbnails=createMediaThumbnailLoader(null,{client:posters});
const storageKey=()=>['sma-manual-delivery',owner,platform,current()?.id,current()?.revision].join('/');
function rememberOrder(id){startedOrders.add(id);try{sessionStorage.setItem(storageKey(),id);}catch{}}
function ownsOrder(id){if(!id)return false;try{return startedOrders.has(id)||sessionStorage.getItem(storageKey())===id;}catch{return startedOrders.has(id);}}
let composer=null,lastList=0;
function syncActions(){
 const scheduleAllowed=Boolean(composer?.allowsSchedule())&&!busy;
 $('schedule').disabled=$('when').disabled=!scheduleAllowed;
}
async function continueApproved(result){
 if(!result?.order||!ownsOrder(result.order)||!result.due||!result.pending||Date.parse(result.due)>Date.now()||
    Date.now()-Date.parse(result.due)>30*60000||document.hidden)return;
 const last=attempted.get(result.order);
 const stage=result.state+'/'+result.sequence;
 if(last?.stage===stage&&(last.at>Date.now()-25000||last.count>=2))return;
 const start={at:Date.now(),stage,count:last?.stage===stage?last.count+1:1};attempted.set(result.order,start);
 try{await transport.get(result.order);start.confirmed=true;}
 catch{start.failed=true;}
}
async function session(){const {data,error}=await db.auth.getSession();if(error||!data.session||owner&&data.session.user.id!==owner)throw Error(errors.AUTH_REQUIRED);return data.session;}
async function rpc(name,args){const before=await session();const {data,error}=await db.rpc(name,args).abortSignal(AbortSignal.timeout(25000));if((await session()).user.id!==before.user.id||owner!==before.user.id)throw Error(errors.AUTH_REQUIRED);if(error||data?.ok===false){const code=data?.code||error?.code;throw Object.assign(Error(errors[code]||(code?'SMA meldet: '+code:'Der Server hat den Stand nicht bestätigt.')),{code});}return data;}
function call(action,extra={}){return rpc('sma_manual_portal_v1',{p_platform:platform,p_action:action,...extra});}
function current(){return files.find(f=>f.id===chosen);}
function assetArgs(f){return {p_asset:f.id,p_revision:f.revision};}
function isDriveId(value){return typeof value==='string'&&/^[\w-]{10,200}$/.test(value);}
function driveUrl(path){
 const url=new URL(path,'https://drive.google.com');
 if(driveAccount)url.searchParams.set('authuser',driveAccount);
 return url.href;
}
function driveVideoUrl(file){
 const media=file.profile_media;
 return ['verified','private_preview_only'].includes(media?.state)&&isDriveId(media.drive_id)?driveUrl('/file/d/'+media.drive_id+'/view'):null;
}
function filterDriveVideos(){
 const search=$('videoSearch').value.trim().toLocaleLowerCase('de');
 let visible=0;
 for(const item of $('driveVideos').children){
  item.hidden=!item.querySelector('.file-title').textContent.toLocaleLowerCase('de').includes(search);
  if(!item.hidden)visible++;
 }
 $('noMatches').hidden=visible>0;
}
const clock=new Intl.DateTimeFormat('de-AT',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function localTime(value){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error(errors.INVALID_TIME);
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna'}).format(new Date());
 const candidates=['+02:00','+01:00'].map(offset=>new Date(day+'T'+value+':00'+offset)).filter(d=>clock.format(d)===value&&d.getTime()>Date.now());
 if(!candidates.length)throw Error(errors.INVALID_TIME);return candidates[candidates.length-1].toISOString();
}
function selectFile(id){
 if(busy||composer?.isWorking())return;
 chosen=id;$('dropStatus').textContent='';$('chooser').open=false;
 const url=new URL(location.href);url.searchParams.set('asset',id);history.replaceState(null,'',url);
 for(const b of $('driveVideos').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.value===id));
 void show(true);
}
async function show(fromPicker=false){
 const f=current(),v=++selection;clearTimeout(statusTimer);entry=null;syncActions();$('fileDetails').hidden=$('review').hidden=!f;
 void composer?.select(f,fromPicker);if(!f){preview.clear();$('status').textContent='Wähle ein Video aus dem Portalordner.';return;}
 const title=describeFile(f).title,media=f.profile_media,driveVideo=$('driveVideo'),href=driveVideoUrl(f);
 driveVideo.removeAttribute('href');driveVideo.hidden=!href;if(href)driveVideo.href=href;
 $('portalLabel').textContent=portals[platform];
 $('selectedName').textContent=media?.source_name||f.display?.source_name||f.name;
 void preview.render(f,owner,href,localMedia?.id===f.id&&localMedia.revision===f.revision?localMedia.file:null);
 $('headline').hidden=true;$('headline').textContent=title;$('account').textContent='';
 $('review').href='./publication-preview.html?wide=1&portal='+platform+'&asset='+encodeURIComponent(f.id)+'&manual=1';
 const previewOnly=media?.state==='private_preview_only';
 $('review').textContent=previewOnly?'Private Vorschau in SMA ansehen':'Beitrag ansehen und freigeben';
 if(previewOnly){$('status').textContent='Private Vorschau mit Logo und Musik · Versand gesperrt.';composer?.setDelivery(false);return;}
 $('status').textContent='Versandstatus wird geladen …';await readDelivery(f,v);
}
async function readDelivery(f,v,expectedOrder=null){
 const active=()=>v===selection&&current()?.id===f.id&&current()?.revision===f.revision;
 const later=id=>{if(active()){clearTimeout(statusTimer);statusTimer=setTimeout(()=>void readDelivery(f,v,id),6500);}};
 try{
  const r=await call('read',assetArgs(f));if(!active())return;
  entry=r;
  $('account').textContent=[r.account,visibility[r.visibility]].filter(Boolean).join(' · ');
  const result=await monitor.describe(r,expectedOrder,active,text=>{$('status').textContent=text;composer?.setDelivery(true);});
  if(!active()||!result)return;
  composer?.setDelivery(result.locked,result.progress);
  $('status').textContent=result.text;syncActions();
  if(result.progress)later(r.order);
 }catch(e){
  if(!active())return;
  entry=null;$('status').textContent=e.message;syncActions();
  if(expectedOrder){composer?.setDelivery(true);later(expectedOrder);}else composer?.setDelivery(false);
 }
}
async function receipt(r,f){
 if(r.accepted||r.pending){if($('publicationOrderDialog')?.open)$('publicationOrderDialog').close();rememberOrder(r.order);composer.setDelivery(true);$('status').textContent='Versand angefordert. Die Bestätigung des Portals steht aus.';}
 await readDelivery(f,selection,r.order);
}
async function list(background=false){
 const ticket=++lastList;const data=await rpc('sma_publication_files_v1',{p_action:'list',p_input:{platform}});
 if(ticket!==lastList)return false;
 if(background&&(busy||loading))return false;
 files=data.files.filter(f=>f.media_kind==='video'&&f.mime_type==='video/mp4');
 const entries=files.filter(f=>f.profile_media?.state!=='hidden_in_picker'||f.id===chosen)
  .map(file=>{
   const filename=file.profile_media?.source_name;
   const title=filename?filename.replace(/\.mp4$/i,'').replace(/_/g,' '):describeFile(file).title;
   return {file,title};
  }).sort((a,b)=>a.title.localeCompare(b.title,'de',{numeric:true}));
 thumbnails.reset();
 const items=entries.map(({file,title})=>{
  const button=document.createElement('button');button.type='button';button.value=file.id;
  const thumb=document.createElement('span');thumb.className='file-thumb';thumb.setAttribute('aria-hidden','true');
  const label=document.createElement('span');label.className='file-title';label.textContent=title;button.append(thumb,label);button.setAttribute('aria-pressed',String(file.id===chosen));
  button.addEventListener('click',()=>selectFile(file.id));
  const item=document.createElement('li');item.append(button);return item;
 });
 $('driveVideos').replaceChildren(...items);filterDriveVideos();
 entries.forEach(({file},index)=>thumbnails.observe(items[index].querySelector('.file-thumb'),file));
 if(chosen&&!current()){$('dropStatus').textContent='Die ausgewählte Datei ist in diesem Portal nicht mehr verfügbar.';chosen='';localMedia=null;const url=new URL(location.href);url.searchParams.delete('asset');history.replaceState(null,'',url);$('chooser').open=true;}
 await show();
}
async function refresh(){
 if(loading||busy||composer?.isWorking())return;clearTimeout(folderTimer);loading=true;$('reload').disabled=true;$('reload').setAttribute('aria-busy','true');
 try{
  const drive=$('drive');drive.hidden=true;drive.removeAttribute('href');
  const folder=await call('folder');driveAccount=folder.drive_account||null;
  if(isDriveId(folder.folder)){
   drive.href=driveUrl('/drive/folders/'+folder.folder);drive.hidden=false;

  }
  await list();
  $('folderStatus').textContent='Google Drive wird abgefragt …';
  const scan=await rpc('sma_refresh_portal_folder_v1',{p_platform:platform});
  await refreshMediaCatalog({owner,getSession:session,readStatus:signal=>db.rpc('sma_publication_files_v1',{p_action:'sync_status',p_input:{}}).abortSignal(signal).then(r=>{if(r.error)throw r.error;return r.data;})});
  await list();
  if(scan.refreshing){
   folderRound=0;
   const observe=async()=>{try{const r=await call('folder');
    if(r.verified_at&&r.verified_at!==scan.verified_at){await list();$('folderStatus').textContent='';}
    else if(++folderRound<15)folderTimer=setTimeout(observe,4000);
    else $('folderStatus').textContent='Letzter bestätigter Ordnerstand angezeigt. Die Drive-Abfrage ist noch offen.';
   }catch(e){$('folderStatus').textContent=e.message;}};
   folderTimer=setTimeout(observe,2500);
  }else $('folderStatus').textContent='';
  await composer?.retrySelection();
 }catch(e){$('folderStatus').textContent=e.code==='FILE_SYNC_RATE_LIMITED'?'Die Dateiliste ist neu geladen. Der nächste Drive-Abgleich ist in Kürze möglich.':e.message;}finally{loading=false;$('reload').disabled=false;$('reload').setAttribute('aria-busy','false');}
}
async function schedule(){
 const f=current(),saved=entry;if(busy||!f||!composer.allowsSchedule())return;
 busy=true;clearTimeout(statusTimer);syncActions();
 try{
  const time=localTime($('when').value);$('status').textContent='Termin wird gespeichert …';
  const r=await call('send',{...assetArgs(f),p_order:saved.order,p_request:crypto.randomUUID(),p_time:time});
  if(r.accepted)rememberOrder(saved.order);await readDelivery(f,selection,saved.order);
 }catch(e){$('status').textContent=e.message;}finally{busy=false;syncActions();}
}
const notify=message=>{$('dropStatus').textContent=message;};
if(Object.hasOwn(portals,platform)){
 $('title').textContent=portals[platform]+' · Manuell posten';
 $('reload').addEventListener('click',refresh);$('videoSearch').addEventListener('input',filterDriveVideos);
 $('schedule').addEventListener('click',schedule);
 try{
  owner=(await session()).user.id;
  db.auth.onAuthStateChange((_event,s)=>{
   if(owner&&s?.user?.id!==owner){
    clearTimeout(statusTimer);clearTimeout(folderTimer);lastList++;selection++;owner=null;files=[];chosen='';entry=null;
    thumbnails.clear();posters.clear();thumbnailClient.dispose();$('driveVideos').replaceChildren();preview.clear();composer?.dispose();
    $('fileDetails').hidden=$('review').hidden=$('drive').hidden=true;$('status').textContent=errors.AUTH_REQUIRED;
    $('reload').disabled=true;
   }
  });
  composer=mountManualComposer({doc:document,platform,owner,portalName:portals[platform],session,rpc,current,onReceipt:receipt,onChange:syncActions,
   beforeSend:id=>{const order=id||entry?.order;if(order)rememberOrder(order);},
   canSchedule:()=>!!entry?.can_send&&!busy,refreshFile:()=>rpc('sma_publication_files_v1',{p_action:'check',p_input:{asset_id:current().id,asset_revision:current().revision,platform}})});
  if(chosen)$('chooser').open=false;
  const intake=createManualIntake({doc:document,db,owner,portal:platform,getOwner:async()=>(await session()).user.id,report:notify,
   selected:async(item,localFile)=>{
    if(item.platform!==platform){location.assign(manualURL(item.platform,item.id));return;}
    if(!files.some(f=>f.id===item.id))await list();
    const file=files.find(f=>f.id===item.id&&(!item.revision||item.revision===f.revision));
    if(!file)throw Error('Die Datei wird im Portalordner noch eingelesen. Bitte aktualisiere die Dateiliste.');
    localMedia=localFile?{id:file.id,revision:file.revision,file:localFile}:null;
    selectFile(file.id);notify('');
   }});
  mountManualDrop(document,intake,notify);
  $('browse').onclick=()=>$('device').click();
  $('device').onchange=()=>{const file=$('device').files[0];$('device').value='';if(file)intake({file}).catch(e=>notify(e.message));};
  document.addEventListener('paste',e=>{if(e.target.closest('input,textarea,[contenteditable]'))return;
   const id=driveIdFromLink(e.clipboardData?.getData('text/plain'));if(id){e.preventDefault();intake({drive:id}).catch(err=>notify(err.message));}});
  await refresh();
  watchPortalCatalog({readFolder:()=>call('folder'),available:()=>!busy&&!loading,refresh:()=>list(true)});
 }catch(e){notify(e.message);}
}else{
 const id=driveOpenId(params.get('state'));
 if(!id)notify('Öffne das gewünschte Portal im SMA-Kundenbereich.');
 else try{owner=(await session()).user.id;
  const result=await rpc('sma_manual_drive_selection_v1',{p_drive:id,p_sha:null});
  if(!Object.hasOwn(portals,result?.platform)||!result?.id)throw Error('Diese Drive-Datei ist in deinen SMA-Portalordnern nicht verfügbar.');
  location.replace(manualURL(result.platform,result.id));
 }catch(e){notify(e.message);}
}
window.addEventListener('pagehide',event=>{if(event.persisted)return;clearTimeout(folderTimer);clearTimeout(statusTimer);preview.clear();thumbnails.clear();posters.clear();thumbnailClient.dispose();composer?.dispose();});
