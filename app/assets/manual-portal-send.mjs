import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {createOrderClient} from './publication-order.mjs?v=34';
import {refreshMediaCatalog} from './media-metadata.mjs?v=3';
import {describeFile} from './file-description.mjs?v=2';

const db=createClient('https://bnvnmdxosbnuzedokqgh.supabase.co','sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW');
const params=new URLSearchParams(location.search),platform=params.get('portal');
const portals={youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'};
const $=id=>document.getElementById(id);
const clock=new Intl.DateTimeFormat('de-AT',{timeZone:'Europe/Vienna',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const states={approval_required:'Für dieses Video fehlt die Freigabe.',blocked:'Eine offene Prüfung blockiert den Versand. Öffne den Beitrag für die Details.',
 complete:'Das Portal hat den Beitrag bestätigt.',processing:'Das Portal verarbeitet das Video.',uploading:'Die Datei wird übertragen.',session_ready:'Das Portal ist für die Datei bereit.',failed:'Der Versand ist fehlgeschlagen.',uncertain:'Das Portal hat den letzten Versuch nicht bestätigt.',needs_review:'Der Übertragungsstand muss geklärt werden.'};
const errors={PORTAL_MEDIA_PROOF_REQUIRED:'Für diese Datei fehlt der Nachweis für das sichtbare Profillogo und die passende hörbare Musik.',AUTH_REQUIRED:'Melde dich im SMA-Kundenbereich an.',TARGET_ACCOUNT_REQUIRED:'Für dieses Portal ist kein Versandkonto verbunden.',FOLDER_OR_FILE_UNAVAILABLE:'Dieser Ordner oder diese Dateiversion ist derzeit nicht verfügbar.',INVALID_TIME:'Wähle eine spätere Uhrzeit für heute in Wien.',ORDER_CHANGED:'Die Datei oder Freigabe hat sich geändert. Lade den aktuellen Beitrag.'};
const tiktokReasons={TIKTOK_PUBLIC_AUDIT_REQUIRED:'TikTok verlangt die App-Freigabe für öffentliches Posten.',TIKTOK_ACCESS_TOKEN_INVALID:'Verbinde das TikTok-Konto erneut.',TIKTOK_SCOPE_NOT_AUTHORIZED:'TikTok hat die Berechtigung zum Veröffentlichen abgelehnt.',TIKTOK_VISIBILITY_CHANGED:'Prüfe die Sichtbarkeit im TikTok-Auftrag erneut.',TIKTOK_INVALID_PARAM:'TikTok hat die Beitragsdaten abgelehnt.',TIKTOK_APP_QUOTA:'TikToks App-Limit ist erreicht.',TIKTOK_RATE_LIMIT:'TikTok hat zu viele Anfragen erhalten.',TIKTOK_DAILY_LIMIT:'Das tägliche TikTok-Postinglimit ist erreicht.',TIKTOK_ACCOUNT_RESTRICTED:'TikTok hat dieses Konto für neue Beiträge gesperrt.'};
const visibility={PUBLIC_TO_EVERYONE:'Öffentlich',public:'Öffentlich',unlisted:'Nicht gelistet',private:'Privat',SELF_ONLY:'Nur ich',MUTUAL_FOLLOW_FRIENDS:'Freunde',FOLLOWER_OF_CREATOR:'Follower'};
let owner,files=[],entry=null,selection=0,loading=false,busy=false,statusTimer,folderTimer,folderRound=0;
const preferred=params.get('asset');
const transport=createOrderClient({session});
const attempted=new Map();
async function continueApproved(result){
 if(!result?.order||!result.due||!result.pending||Date.parse(result.due)>Date.now()||
    Date.now()-Date.parse(result.due)>30*60000||document.hidden)return;
 const last=attempted.get(result.order);
 const stage=result.state+'/'+result.sequence;
 if(last?.stage===stage&&(last.at>Date.now()-25000||last.count>=2))return;
 const start={at:Date.now(),stage,count:last?.stage===stage?last.count+1:1};attempted.set(result.order,start);
 try{await transport.get(result.order);start.confirmed=true;}
 catch{start.failed=true;}
}
async function session(){const {data,error}=await db.auth.getSession();if(error||!data.session||owner&&data.session.user.id!==owner)throw Error(errors.AUTH_REQUIRED);return data.session;}
async function rpc(name,args){await session();const {data,error}=await db.rpc(name,args);await session();if(error||data?.ok===false)throw Error(errors[data?.code]||'SMA konnte den Stand nicht bestätigen.');return data;}
function call(action,extra={}){return rpc('sma_manual_portal_v1',{p_platform:platform,p_action:action,...extra});}
function current(){return files.find(f=>f.id===$('files').value);}
function assetArgs(f){return {p_asset:f.id,p_revision:f.revision};}
function isDriveId(value){return typeof value==='string'&&/^[\w-]{10,200}$/.test(value);}
function driveVideoUrl(file){
 const media=file.profile_media;
 return ['verified','private_preview_only'].includes(media?.state)&&isDriveId(media.drive_id)?'https://drive.google.com/file/d/'+media.drive_id+'/view':null;
}
function filterDriveVideos(){
 const search=$('videoSearch').value.trim().toLocaleLowerCase('de');
 let visible=0;
 for(const item of $('driveVideos').children){
  item.hidden=!item.textContent.toLocaleLowerCase('de').includes(search);
  if(!item.hidden)visible++;
 }
 $('noMatches').hidden=visible>0;
}
function localTime(value){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error(errors.INVALID_TIME);
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Vienna'}).format(new Date());
 const candidates=['+02:00','+01:00'].map(offset=>new Date(day+'T'+value+':00'+offset)).filter(d=>clock.format(d)===value&&d.getTime()>Date.now());
 if(!candidates.length)throw Error(errors.INVALID_TIME);return candidates[candidates.length-1].toISOString();
}
async function show(){
 const f=current(),v=++selection;clearTimeout(statusTimer);entry=null;$('actions').hidden=true;$('post').hidden=!f;
 if(!f)return;
 const title=describeFile(f).title,media=f.profile_media;
 const driveVideo=$('driveVideo');
 driveVideo.removeAttribute('href');driveVideo.hidden=true;
 const href=driveVideoUrl(f);
 if(href){
  driveVideo.href=href;driveVideo.hidden=false;
 }
 $('headline').textContent=title;$('caption').textContent='';$('account').textContent='';$('status').textContent='Lade Beitrag …';
 $('review').href='./publication-preview.html?wide=1&portal='+platform+'&asset='+encodeURIComponent(f.id)+'&manual=1';
 const previewOnly=media?.state==='private_preview_only';
 $('review').textContent=previewOnly?'Private Vorschau in SMA ansehen':'Beitrag ansehen und freigeben';
 if(previewOnly){$('status').textContent='Private Vorschau mit Logo und Musik.';return;}
 try{
  const result=await call('read',assetArgs(f));if(v!==selection)return;entry=result;
  $('headline').textContent=result.title||title;$('caption').textContent=result.caption||'';
  $('account').textContent=[result.account,visibility[result.visibility]].filter(Boolean).join(' · ');
  $('actions').hidden=!result.can_send;$('status').textContent=tiktokReasons[result.provider_code]||states[result.state]||'Freigabe vorhanden.';
  if(result.due&&!['complete','failed','uncertain','needs_review','blocked'].includes(result.state)){
   $('status').textContent=states[result.state]||('Versand angefordert für '+clock.format(new Date(result.due))+' Uhr.');
  }
  if(result.pending){
    if(Date.parse(result.due)>Date.now())$('status').textContent='Für heute um '+clock.format(new Date(result.due))+' Uhr vorgemerkt.';
    else if(['uploading','session_ready','processing'].includes(result.state))$('status').textContent=states[result.state]+(result.bytes>0?' Bestätigt: '+result.bytes.toLocaleString('de-AT')+' Byte.':'');
    else $('status').textContent='Versand angefordert. Die Portalbestätigung steht aus.';
    await continueApproved(result);
    if(v!==selection)return;
    if(attempted.get(result.order)?.failed&&!['uploading','session_ready','processing'].includes(result.state))$('status').textContent='Der SMA-Versanddienst hat den Start noch nicht bestätigt.';
    else if(!result.background)$('status').textContent+=' Lass diese SMA-Seite bis zur Portalbestätigung geöffnet.';
    statusTimer=setTimeout(show,6500);
  }else if(result.due&&['processing','session_ready','uploading'].includes(result.state))statusTimer=setTimeout(show,7000);
 }catch(e){if(v===selection)$('status').textContent=e.message;}
}
async function list(){
 const prior=$('files').value,data=await rpc('sma_publication_files_v1',{p_action:'list',p_input:{platform}});
 files=data.files.filter(f=>f.media_kind==='video'&&f.mime_type==='video/mp4'&&(f.profile_media?.state!=='hidden_in_picker'||f.id===preferred));
 const entries=files.map(file=>({file,...describeFile(file),href:driveVideoUrl(file)}))
  .sort((a,b)=>a.title.localeCompare(b.title,'de',{numeric:true}));
 const links=[],options=[];
 for(const {file,title,version,href} of entries){
  if(href){
   const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=title;
   const item=document.createElement('li');item.append(link);links.push(item);
  }
  if(file.profile_media?.state!=='private_preview_only'||!href||file.id===preferred)options.push(new Option(title+' · '+version,file.id));
 }
 $('driveVideos').replaceChildren(...links);$('drivePreviews').hidden=!links.length;filterDriveVideos();
 $('smaSelection').hidden=!options.length&&links.length>0;
 $('files').replaceChildren(new Option(options.length?'Videotitel auswählen':'Keine Videos im Portalordner',''),...options);
 $('files').value=options.some(o=>o.value===prior)?prior:options.some(o=>o.value===preferred)?preferred:'';
 $('files').disabled=!options.length;await show();
}
async function refresh(){
 if(loading||busy)return;clearTimeout(folderTimer);loading=true;$('reload').disabled=true;
 try{
  const drive=$('drive');drive.hidden=true;drive.removeAttribute('href');
  const folder=await call('folder');
  if(isDriveId(folder.folder)){
   drive.href='https://drive.google.com/drive/folders/'+folder.folder;drive.hidden=false;
   drive.textContent=portals[platform]+'-Ordner in Google Drive öffnen ↗';
  }
  await list();
  $('folderStatus').textContent='Google Drive wird abgefragt …';
  const scan=await rpc('sma_refresh_portal_folder_v1',{p_platform:platform});
  await refreshMediaCatalog({owner,getSession:session,readStatus:signal=>db.rpc('sma_publication_files_v1',{p_action:'sync_status',p_input:{}}).abortSignal(signal).then(r=>{if(r.error)throw r.error;return r.data;})});
  await list();
  if(scan.refreshing){
   folderRound=0;
   const observe=async()=>{try{const r=await call('folder');
    if(r.verified_at&&r.verified_at!==scan.verified_at){await list();$('folderStatus').textContent='Portalordner aktualisiert.';}
    else if(++folderRound<15)folderTimer=setTimeout(observe,4000);
    else $('folderStatus').textContent='Letzter bestätigter Ordnerstand angezeigt. Die Drive-Abfrage ist noch offen.';
   }catch(e){$('folderStatus').textContent=e.message;}};
   folderTimer=setTimeout(observe,2500);
  }else $('folderStatus').textContent=scan.background===false?'Drive-Dateien aktualisiert. Für die aktuelle Ordneransicht öffne den Google-Drive-Link.':'Portalordner aktualisiert.';
 }catch(e){$('folderStatus').textContent=e.message;}finally{loading=false;$('reload').disabled=false;}
}
async function send(scheduled){
 const f=current(),saved=entry;if(busy||!f||!saved?.can_send)return;
 busy=true;clearTimeout(statusTimer);$('send').disabled=$('schedule').disabled=$('files').disabled=true;
 try{
  const time=scheduled?localTime($('when').value):null;
  $('status').textContent=scheduled?'Termin wird gespeichert …':'Versand wird angefordert …';
  const r=await call('send',{...assetArgs(f),p_order:saved.order,p_request:crypto.randomUUID(),p_time:time});
  if(r.accepted)attempted.delete(saved.order);await show();
 }catch(e){$('status').textContent=e.message;}finally{busy=false;$('send').disabled=$('schedule').disabled=false;$('files').disabled=!files.length;}
}
if(Object.hasOwn(portals,platform)){
 $('title').textContent=portals[platform]+' · Manuell posten';
 $('files').addEventListener('change',show);$('reload').addEventListener('click',refresh);
 $('videoSearch').addEventListener('input',filterDriveVideos);
 $('send').addEventListener('click',()=>send(false));$('schedule').addEventListener('click',()=>send(true));
 try{owner=(await session()).user.id;await refresh();}catch(e){$('folderStatus').textContent=e.message;}
}else $('folderStatus').textContent='Öffne das gewünschte Portal im SMA-Kundenbereich.';
window.addEventListener('pagehide',()=>{clearTimeout(folderTimer);clearTimeout(statusTimer);});
