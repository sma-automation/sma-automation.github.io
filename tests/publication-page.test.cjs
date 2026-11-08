const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const source=fs.readFileSync('app/assets/publication-preview.js','utf8').replace(/^import .*;$/gm,'').replace("await import('https://esm.sh/@supabase/supabase-js@2')",'await loadClientModule()');
const originalVideoSource=fs.readFileSync('app/assets/original-video-preview.mjs','utf8').replace(/^export /gm,'');
const hashtagSource=fs.readFileSync('app/assets/publication-hashtags.mjs','utf8').replace(/^export /gm,'');
class Element{constructor(tag='div'){this.tag=tag;this.style={};this.children=[];this.events={};this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.classList={add(){},toggle(){}};}setCustomValidity(value){this.validationMessage=value}setAttribute(k,v){this[k]=v}removeAttribute(k){delete this[k]}pause(){this.paused=true}load(){this.loaded=true}showModal(){this.open=true}close(){this.open=false;this.events.close?.()}click(){this.clicked=true;return this.events.click?.()}focus(){this.focused=true}scrollIntoView(){this.scrolledIntoView=true}append(...els){this.children.push(...els)}replaceChildren(...els){this.children=els}addEventListener(k,f){this.events[k]=f}querySelectorAll(sel){const all=this.children.flatMap(c=>[c,...c.querySelectorAll('*')]);return all.filter(c=>sel==='*'||(sel==='input,textarea'&&['input','textarea'].includes(c.tag))||(sel==='textarea'&&c.tag==='textarea')||sel===c.tag||sel==='[data-field='+c.dataset.field+']')}querySelector(sel){return this.querySelectorAll(sel)[0]}}
const thumbnailSource=fs.readFileSync('app/assets/asset-thumbnail.mjs','utf8').split('// One owner-scoped')[0].replace('const endpoint=','const thumbnailEndpoint=').replace('request(endpoint,','request(thumbnailEndpoint,').replace('export async function','async function');
const metadataSource=fs.readFileSync('app/assets/media-metadata.mjs','utf8').split('// Existing owner-scoped')[0].replaceAll('export function','function');
const result={ok:true,status:'completed',id:'own-id',revision:1,preview:{can_publish:false,language:'de',shop_url:'https://sma-automation.com/app/shop.html?shop=sma-testkunde',drafts:[{platform:'youtube',title:'Testtitel',body:'Ein sachlicher Testtext.',hashtags:['Test'],caption:'Ein sachlicher Testtext.\n\n#Test\n\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=sma-testkunde',review_notes:[]}]}};
function savedTextReceipt(previous,input){
 const draft={...previous.preview.drafts[0],title:input.title,body:input.body,hashtags:input.hashtags};
 return {...previous,revision:previous.revision+1,assignment_revision:input.assignment_revision+1,preview:{...previous.preview,drafts:[draft]}};
}
async function boot({portal=null,asset=null,files=[],filesRpc=null,orderId=null,resume=false,sessionStorage=null,currentPost=false,ownerId='fixture-owner',newUuid=null,orderResponse=null,coverContext=async()=>null,magicResponse=async()=>({ok:false}),assetPreviewResponse=async()=>({ok:false}),signedIn=true,formTracksDom=false,latest={ok:true,status:'empty'},fetchResponse=async()=>result,saveResponse=result,timer=setTimeout,wide=false,beforeClientReady=null}={}){const els=new Map();const get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id)};get('media_kind').value='video';get('result').hidden=true;const checks=['youtube','instagram','facebook','tiktok'].map(p=>Object.assign(new Element('input'),{value:p,checked:p==='youtube'}));const views=[],calls=[],mediaCalls=[],createdUrls=[],revokedUrls=[],workspaces=[];let authChange,orderOptions;const win={sessionStorage,addEventListener(){},postMessage(){}};win.parent=win;win.top=win;
 const client={auth:{getSession:async()=>({data:{session:signedIn?{access_token:'private-session-token',user:{id:ownerId}}:null}}),onAuthStateChange(fn){authChange=fn;}},rpc:async(name,args)=>{calls.push({name,...args});return {data:name==='sma_publication_order_v1'?(typeof orderResponse==='function'?await orderResponse(args):orderResponse):['sma_publication_magic_v1','sma_publication_video_magic_v1'].includes(name)?await magicResponse(args):name==='sma_publication_files_v1'?(filesRpc?await filesRpc(args):{ok:true,files}):args.p_action==='latest'?latest:saveResponse}}};
 const rpc=client.rpc;
 client.rpc=(...args)=>{const request=rpc(...args);request.abortSignal=()=>request;return request;};
 const values={source_text:'Dies ist eine sachliche Beschreibung des SMA Testartikels.',audience:'Testkunden',goal:'Shop kennenlernen',media_kind:'video',language:'de'};
 if(!formTracksDom)for(const [key,value] of Object.entries(values))get(key).value=value;
 class Data{get(k){return formTracksDom?get(k).value:values[k]}getAll(){return checks.filter(c=>c.checked).map(c=>c.value)}}
 await vm.runInNewContext('(async()=>{'+originalVideoSource+hashtagSource+metadataSource+thumbnailSource+source+'})()',{...(await import('../app/assets/publication-tab-draft.mjs')),...(await import('../app/assets/publication-draft-conflict.mjs')),...(await import('../app/assets/publication-catalog-lookup.mjs')),draftDestination:(await import('../app/assets/publication-destination.mjs')).draftDestination,mountGalleryMusic:()=>({wake(){},destroy(){}}),mountExportCover:()=>({setContext:coverContext,clear(){},destroy(){}}),installOrderReview:(_doc,opts)=>{orderOptions=opts;return {lock(){},clear(){},rememberVideoChoices(order){opts.previousOrder=order;},resumePrepared(order){opts.resumeContext=opts.getContext();opts.resumeOrder=order;return true;}};},createMediaThumbnailLoader:()=>({observe(){},reset(){},clear(){}}),loadClientModule:async()=>{await beforeClientReady?.({get,calls,workspaces});return {createClient:()=>client};},createOptimizerWorkspace:(_doc,name)=>{workspaces.push(name);return {galleryVisible:()=>true,selection(){},textAvailable(){},refreshPreview(){},show(view){views.push(view)}};},ResizeObserver:class{observe(){}},requestAnimationFrame:()=>{},document:{getElementById:get,createElement:t=>new Element(t),querySelectorAll:()=>checks,querySelector:sel=>sel==='h1'?get('title'):checks[0],body:new Element()},window:win,location:{search:portal?'?embedded=1&portal='+portal+(wide?'&wide=1':'')+(asset?'&asset='+asset:'')+(orderId!==null?'&order='+orderId:'')+(resume?'&resume=1':'')+(currentPost?'&view=current':''):'',origin:'https://sma-automation.com'},URLSearchParams,Blob,atob,URL:{createObjectURL(blob){const url='blob:preview-'+createdUrls.length;createdUrls.push({blob,url});return url;},revokeObjectURL(url){revokedUrls.push(url);}},FormData:Data,crypto:{randomUUID:newUuid||(()=> '12345678-1234-4123-8123-123456789abc')},AbortSignal,AbortController,deviceFileMetadata:(f,p)=>{if(!f.size)throw Error("UPLOAD_SIZE");return {name:f.name,mime_type:f.type,size_bytes:f.size}},transferDeviceFile:async({onProgress,file})=>onProgress(file.size,file.size),fetch:async(url,options)=>{if(url.endsWith('/sma-publication-asset-preview-v1')){mediaCalls.push({url,options});return {ok:true,json:()=>assetPreviewResponse(url,options)};}calls.push({url,options});return {ok:true,json:()=>fetchResponse(url,options)}},setTimeout:timer,console});
 return {orderOptions,get,calls,views,workspaces,mediaCalls,createdUrls,revokedUrls,checks,run:()=>get('previewForm').events.submit({preventDefault(){}}),save:()=>get('save').events.click(),signOut:()=>authChange('SIGNED_OUT'),switchOwner:()=>authChange('SIGNED_IN',{user:{id:'other-owner'}})};}
test('signed-out users cannot generate or display saved customer data',async()=>{const p=await boot({signedIn:false});assert.equal(p.calls.length,0);assert.equal(p.get('inputFields').disabled,true);assert.equal(p.get('result').hidden,true);assert.match(p.get('status').textContent,/melde dich/);});
test('one generation for concurrent clicks; body contains no tenant or shop override',async()=>{let release;const p=await boot({fetchResponse:()=>new Promise(r=>release=r)});const first=p.run();await Promise.resolve();await p.run();await new Promise(r=>setImmediate(r));assert.equal(p.calls.filter(c=>c.url).length,1);assert.equal(p.get('inputFields').disabled,true);release(result);await first;assert.equal(p.get('result').hidden,false);const request=JSON.parse(p.calls.find(c=>c.url).options.body);assert.equal(request.request_id,'12345678-1234-4123-8123-123456789abc');assert.ok(!('shop_url' in request));assert.ok(!('customer_id' in request));assert.equal(p.get('inputFields').disabled,false);});
test('saved edits retain server revision, sign-out hides content',async()=>{const p=await boot({latest:result,saveResponse:{...result,revision:2}});const body=p.get('drafts').children[0].querySelector('textarea');body.value='Ein korrigierter sachlicher Testtext.';await p.save();const call=p.calls.find(c=>c.p_action==='save');assert.equal(call.p_id,'own-id');assert.equal(call.p_input.revision,1);assert.equal(call.p_input.drafts[0].body,body.value);assert.ok(!('caption' in call.p_input.drafts[0]));p.signOut();assert.equal(p.get('result').hidden,true);assert.equal(p.get('inputFields').disabled,true);});
test('save conflicts preserve user edits and show recovery guidance',async()=>{const p=await boot({latest:result,saveResponse:{ok:false,code:'REVISION_CONFLICT'}});const body=p.get('drafts').children[0].querySelector('textarea');body.value='Meine noch nicht gespeicherten Angaben.';await p.save();assert.equal(body.value,'Meine noch nicht gespeicherten Angaben.');assert.match(p.get('status').textContent,/zwischenzeitlich/);assert.match(p.get('saveStatus').textContent,/nicht gespeichert/);});
test('per-portal editor loads only its scope and keeps other saved portal texts unchanged',async()=>{const other={...result.preview.drafts[0],platform:'tiktok',title:'TikTok Ausgangstitel',body:'Unveränderter TikTok Ausgangstext.'};const combined={...result,preview:{...result.preview,drafts:[result.preview.drafts[0],other]}};const p=await boot({portal:'youtube',latest:combined,saveResponse:{...combined,revision:2}});assert.equal(p.calls.find(c=>c.p_action==='latest').p_input.platform,'youtube');assert.equal(p.get('drafts').children.length,1);assert.equal(p.get('drafts').children[0].dataset.platform,'youtube');assert.equal(p.get('sourcePanel').open,false);assert.equal(p.get('portalSelection').hidden,true);p.get('drafts').children[0].querySelector('textarea').value='Bearbeiteter YouTube-Text ohne neue Produktbehauptungen.';await p.save();const saved=p.calls.find(c=>c.p_action==='save').p_input.drafts;assert.equal(saved.length,2);assert.equal(saved[1].title,other.title);assert.equal(saved[1].body,other.body);});
test('generation from a portal card requests exactly that portal',async()=>{for(const portal of ['youtube','instagram','facebook','tiktok']){const p=await boot({portal,fetchResponse:async()=>({...result,preview:{...result.preview,drafts:[{...result.preview.drafts[0],platform:portal}]}})});await p.run();const request=JSON.parse(p.calls.find(c=>c.url).options.body);assert.deepEqual(request.platforms,[portal]);if(portal==='youtube')assert.equal(request.media_kind,'video');assert.equal(p.get('drafts').children.length,1);assert.equal(p.get('drafts').children[0].dataset.platform,portal);}});

const ownFile={id:'fa110000-0000-4000-8000-000000000001',name:'Meine Datei A.mp4',media_kind:'video',revision:'version:1',verified_at:new Date().toISOString(),assignments:[]};
test('publication order uses the selected saved revision and rejects unsaved edits and logout',async()=>{
 const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[{...ownFile,assignments:[]}]}:a.p_action==='get'?{...result,assignment_revision:4}:{ok:true,status:'empty'}});
 const context=p.orderOptions.getContext();
 assert.deepEqual(JSON.parse(JSON.stringify(context.binding)),{asset_id:ownFile.id,asset_revision:ownFile.revision,platform:'youtube',assignment_revision:4,preview_id:result.id,preview_revision:result.revision});
 p.get('drafts').children[0].events.input();assert.throws(()=>p.orderOptions.getContext(),/speichere/);
 p.signOut();assert.throws(()=>p.orderOptions.getContext(),/melde/);
});
test('file editor never falls back to unrelated latest portal text',async()=>{const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async args=>args.p_action==='list'?{ok:true,files:[ownFile]}:{ok:true,status:'empty'}});assert.equal(p.calls.some(c=>c.p_action==='latest'),false);assert.equal(p.get('result').hidden,true);assert.equal(p.get('source_text').value,'');assert.equal(p.calls.find(c=>c.p_action==='get').p_input.asset_id,ownFile.id);});
test('generation binds the returned revision to the selected file and portal',async()=>{const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async args=>args.p_action==='list'?{ok:true,files:[ownFile]}:args.p_action==='assign'?{...result,assignment_revision:1}:{ok:true,status:'empty'}});await p.run();const bind=p.calls.find(c=>c.p_action==='assign');assert.equal(bind.p_input.asset_id,ownFile.id);assert.equal(bind.p_input.asset_revision,'version:1');assert.equal(bind.p_input.platform,'youtube');assert.equal(bind.p_input.preview_id,result.id);assert.equal(bind.p_input.preview_revision,1);assert.equal(bind.p_input.assignment_revision,0);assert.match(p.get('saveStatus').textContent,/zugeordnet/);});
test('file edits carry assignment revision and cannot use the unscoped save endpoint',async()=>{const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async args=>args.p_action==='list'?{ok:true,files:[ownFile]}:{...result,assignment_revision:4}});p.get('drafts').children[0].querySelector('textarea').value='Bearbeiteter Text nur für Datei A.';await p.save();const saves=p.calls.filter(c=>c.p_action==='save');assert.equal(saves.length,1);assert.equal(saves[0].name,'sma_publication_files_v1');assert.equal(saves[0].p_input.assignment_revision,4);assert.equal(saves[0].p_input.asset_id,ownFile.id);assert.equal(saves[0].p_input.platform,'youtube');});
test('missing deep-linked file stays recoverable and shows no template as an assigned text',async()=>{const p=await boot({portal:'youtube',asset:ownFile.id});assert.equal(p.get('result').hidden,true);assert.equal(p.get('browseFiles').disabled,false);assert.equal(p.calls.some(c=>c.p_action==='latest'),false);assert.match(p.get('status').textContent,/nicht mehr/);});

test('media precheck shows server facts and failures without implying publish approval',async()=>{
 const media={can_publish:false,asset_id:ownFile.id,asset_revision:ownFile.revision,status:'needs_changes',profile:'TikTok-Video',facts:{mime_type:'video/mp4',width_px:200,height_px:300,size_bytes:1200000,duration_ms:12500},checks:[{status:'pass',message:'Datei enthält Daten.'},{status:'fail',message:'Auflösung zu klein.'},{status:'pending',message:'Inhaltsprüfung offen.'}]};
 const p=await boot({portal:'tiktok',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[ownFile]}:a.p_action==='check'?{ok:true,media_check:media}:{ok:true,status:'empty'}});
 assert.match(p.get('mediaSummary').textContent,/Überarbeitung nötig/);assert.equal(p.get('mediaPanel').open,true);assert.match(p.get('mediaFacts').textContent,/200 × 300/);assert.equal(p.get('mediaChecks').children[0].textContent,'Zu korrigieren: Auflösung zu klein.');
 const request=p.calls.find(c=>c.p_action==='check');assert.equal(request.p_input.asset_revision,ownFile.revision);assert.equal(request.p_input.platform,'tiktok');
 p.signOut();assert.equal(p.get('mediaChecks').children.length,0);assert.equal(p.get('mediaFacts').textContent,'');
});
test('media results for another file or revision are never displayed',async()=>{
 for(const override of [{asset_id:'foreign'},{asset_revision:'version:old'},{can_publish:true}]){
  const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[ownFile]}:a.p_action==='check'?{ok:true,media_check:{can_publish:false,asset_id:ownFile.id,asset_revision:ownFile.revision,status:'needs_review',checks:[{status:'pass',message:'Wrong result'}],...override}}:{ok:true,status:'empty'}});
  assert.equal(p.get('mediaChecks').children.length,0);assert.match(p.get('mediaStatus').textContent,/nicht verfügbar/);
 }
});
test('general text templates do not trigger a fabricated media inspection',async()=>{
 const p=await boot({portal:'youtube',latest:result});assert.equal(p.calls.some(c=>c.p_action==='check'),false);assert.match(p.get('mediaStatus').textContent,/zuerst eine Datei/);
});
function mediaWithReview(review){return {ok:true,media_check:{can_publish:false,asset_id:ownFile.id,asset_revision:ownFile.revision,status:'needs_review',checks:[],content_review:{asset_id:ownFile.id,asset_revision:ownFile.revision,policy_version:'visual-2026-11-01.1',can_publish:false,...review}}};}
test('completed visual screening remains pending final approval and cannot start duplicate scan',async()=>{const r=mediaWithReview({status:'completed',result:{outcome:'clear',can_publish:false,categories:[],frames_checked:2}});const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[ownFile]}:a.p_action==='check'?r:{ok:true,status:'empty'}});assert.match(p.get('contentReviewStatus').textContent,/endgültige Freigabe steht noch aus/);assert.match(p.get('contentReviewStatus').textContent,/Ton ist nicht enthalten/);assert.equal(p.get('reviewContent').disabled,true);await p.get('reviewContent').events.click();assert.equal(p.calls.some(c=>c.url),false);});
test('flagged content shows review categories without automatic approval',async()=>{const r=mediaWithReview({status:'completed',result:{outcome:'needs_review',can_publish:false,categories:['weapons'],frames_checked:2}});const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[ownFile]}:a.p_action==='check'?r:{ok:true,status:'empty'}});assert.match(p.get('contentReviewStatus').textContent,/mögliche Auffälligkeiten/);assert.match(p.get('contentReviewStatus').textContent,/Waffen/);});
test('review request uses only selected file identity and rejects foreign cached results',async()=>{const p=await boot({portal:'instagram',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[{...ownFile,media_kind:'image'}]}:a.p_action==='check'?mediaWithReview({status:'unreviewed'}):{ok:true,status:'empty'},fetchResponse:async()=>({ok:true,review:{asset_id:'foreign',asset_revision:ownFile.revision,policy_version:'visual-2026-11-01.1',can_publish:false,status:'completed',result:{outcome:'clear',can_publish:false}}})});await p.get('reviewContent').events.click();const req=p.calls.find(c=>c.url);assert.deepEqual(JSON.parse(req.options.body),{asset_id:ownFile.id,asset_revision:ownFile.revision});assert.match(p.get('contentReviewStatus').textContent,/vollständiges Ergebnis/);assert.equal(p.get('reviewContent').disabled,false);});

test('video screening is visibly blocked when provider plan does not permit video analysis',async()=>{const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[ownFile]}:a.p_action==='check'?mediaWithReview({status:'unreviewed'}):{ok:true,status:'empty'}});assert.match(p.get('contentReviewStatus').textContent,/Tarif nicht freigeschaltet/);assert.equal(p.get('reviewContent').disabled,true);await p.get('reviewContent').events.click();assert.equal(p.calls.some(c=>c.url),false);});

test('portal recommendations remain separate from failures, preserve status and clear on sign-out',async()=>{
 const r=mediaWithReview({status:'unreviewed'});Object.assign(r.media_check,{facts_source:'drive_metadata',facts:{width_px:1920,height_px:1080},scope_notice:'Instagram-Reel: weitere Prüfung offen.',recommendations:[{status:'suggested',message:'Hochformat 9:16 empfohlen.'},null,{status:'pass',message:'Unsupported approval status'}]});
 const p=await boot({portal:'instagram',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[ownFile]}:a.p_action==='check'?r:{ok:true,status:'empty'}});
 assert.match(p.get('mediaFacts').textContent,/Von Drive gemeldete/);assert.match(p.get('mediaScope').textContent,/Instagram-Reel/);
 assert.equal(p.get('mediaRecommendationsPanel').hidden,false);assert.equal(p.get('mediaRecommendations').children.length,1);
 assert.equal(p.get('mediaRecommendations').children[0].textContent,'Hochformat 9:16 empfohlen.');
 assert.equal(p.get('mediaChecks').children.length,0);assert.match(p.get('mediaSummary').textContent,/weitere Prüfung nötig/);assert.equal(p.get('mediaPanel').open,false);
 p.signOut();assert.equal(p.get('mediaRecommendations').children.length,0);assert.equal(p.get('mediaRecommendationsPanel').hidden,true);assert.equal(p.get('mediaScope').textContent,'');
});
test('stale media responses cannot display scope or recommendations',async()=>{
 const r=mediaWithReview({status:'unreviewed'});Object.assign(r.media_check,{asset_revision:'stale',scope_notice:'Foreign scope',recommendations:[{status:'matches',message:'Foreign recommendation'}]});
 const p=await boot({portal:'instagram',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[ownFile]}:a.p_action==='check'?r:{ok:true,status:'empty'}});
 assert.equal(p.get('mediaScope').textContent,'');assert.equal(p.get('mediaRecommendations').children.length,0);assert.equal(p.get('mediaRecommendationsPanel').hidden,true);
});

const photo={...ownFile,name:'Foto.jpg',media_kind:'image',mime_type:'image/jpeg',revision:'sha256:'+ 'a'.repeat(64)+':1'};
const magicAnalysis={asset_id:photo.id,asset_revision:photo.revision,policy_version:'magic-photo-2026-11-02.1',can_publish:false,status:'completed',result:{subject_type:'product',description:'Eine blaue Schale steht auf einer hellen Tischfläche.',source_text:'Automatische Fotoerkennung: Eine blaue Schale steht auf einer hellen Tischfläche.',uncertainties:['Material nicht sicher erkennbar.'],requires_confirmation:true,can_publish:false}};
const photoFiles=a=>a.p_action==='list'?{ok:true,files:[photo]}:{ok:true,status:'empty'};
test('reopening an in-progress photo resumes reading the result without starting another analysis',async()=>{
 let reads=0;
 const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>photoFiles(a),timer:fn=>setImmediate(fn),magicResponse:async()=>({ok:true,analysis:++reads===1?{...magicAnalysis,status:'processing',result:null}:magicAnalysis})});
 assert.equal(reads,2);assert.equal(p.calls.filter(c=>c.url).length,0);
 assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);
});
test('photo polling can be resumed after its wait limit without another analysis request',async()=>{
 let completed=false;
 const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>photoFiles(a),timer:fn=>setImmediate(fn),magicResponse:async()=>({ok:true,analysis:completed?magicAnalysis:{...magicAnalysis,status:'processing',result:null}})});
 assert.equal(p.get('recognizePhoto').disabled,false);assert.equal(p.get('recognizePhoto').textContent,'Erkennungsstand laden');
 completed=true;await p.get('recognizePhoto').events.click();
 assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);assert.equal(p.calls.filter(c=>c.url).length,0);
});
test('resuming an expired analysis shows a usable retry without replacing customer input',async()=>{
 let reads=0;
 const saved={...result,input:{source_text:'Meine gesicherten Angaben bleiben hier erhalten.',media_kind:'image',platforms:['instagram']},preview:{...result.preview,drafts:[{...result.preview.drafts[0],platform:'instagram'}]}};
 const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[photo]}:a.p_action==='get'?saved:{ok:true,status:'empty'},timer:fn=>setImmediate(fn),magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,status:++reads===1?'processing':'failed',result:null,error_code:'MAGIC_TIMEOUT'}})});
 assert.equal(p.get('recognizePhoto').disabled,false);assert.equal(p.get('recognizePhoto').textContent,'Foto erneut erkennen');assert.match(p.get('magicStatus').textContent,/nicht rechtzeitig/);
 assert.equal(p.get('source_text').value,saved.input.source_text);assert.equal(p.calls.filter(c=>c.url).length,0);
});
test('a malformed completed result cannot disable recovery or supply content',async()=>{
 const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>photoFiles(a),magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,result:{...magicAnalysis.result,source_text:null}}}),fetchResponse:async()=>({ok:true,analysis:magicAnalysis})});
 assert.equal(p.get('source_text').value,'');assert.equal(p.get('applyMagic').hidden,true);assert.equal(p.get('recognizePhoto').disabled,false);
 await p.get('recognizePhoto').events.click();assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);
});
test('unsupported photo metadata gives a clear next step without requesting paid analysis',async()=>{
 for(const patch of [{mime_type:'image/heic'},{mime_type:'image/gif'},{size_bytes:12000001}]){
  const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[{...photo,...patch}]}:{ok:true,status:'empty'},magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,status:'unrecognized',result:null}})});
  assert.equal(p.calls.filter(c=>c.url).length,0);assert.equal(p.get('recognizePhoto').disabled,true);assert.match(p.get('magicStatus').textContent,/JPG, PNG oder WebP.*12 MB/);
  assert.equal(p.get('inputFields').disabled,false);
 }
});
test('Magic Effect starts automatically for a selected new photo and fills its recognized content',async()=>{
 const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>photoFiles(a),magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,status:'unrecognized',result:null}}),fetchResponse:async()=>({ok:true,analysis:magicAnalysis})});
 assert.equal(p.calls.filter(c=>c.url).length,1);const call=p.calls.find(c=>c.url);
 assert.match(call.url,/sma-publication-magic-effect-v1$/);assert.deepEqual(JSON.parse(call.options.body),{asset_id:photo.id,asset_revision:photo.revision});
 assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);assert.match(p.get('magicSummary').textContent,/Material nicht sicher/);assert.equal(p.get('recognizePhoto').disabled,true);
 p.signOut();assert.equal(p.get('source_text').value,'');assert.equal(p.get('magicSummary').textContent,'');
});
test('cached photo analysis never overwrites an existing customer description automatically',async()=>{
 const saved={...result,input:{source_text:'Meine gesicherte eigene Beschreibung dieses Motivs.',audience:'Kunden',goal:'Informieren',language:'de',media_kind:'image',platforms:['instagram']},preview:{...result.preview,drafts:[{...result.preview.drafts[0],platform:'instagram'}]}};
 const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[photo]}:a.p_action==='get'?saved:{ok:true,status:'empty'},magicResponse:async()=>({ok:true,analysis:magicAnalysis})});
 assert.equal(p.get('source_text').value,saved.input.source_text);assert.equal(p.calls.filter(c=>c.url).length,0);
 await p.get('applyMagic').events.click();assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);assert.equal(p.get('sourcePanel').open,true);assert.equal(p.get('sourcePanel').scrolledIntoView,true);assert.equal(p.get('source_text').focused,true);assert.equal(p.get('magicApplied').hidden,false);assert.match(p.get('magicApplied').textContent,/Text optimieren/);
});
test('foreign, stale and falsely approved photo results cannot supply source content',async()=>{
 for(const patch of [{asset_id:'foreign'},{asset_revision:'old'},{can_publish:true}]){
  const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>photoFiles(a),magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,...patch}})});
  assert.equal(p.get('source_text').value,'');assert.equal(p.get('magicSummary').textContent,'');assert.match(p.get('magicStatus').textContent,/kein vollständiges/);
 }
});
test('uncertain photo identification asks for content instead of inventing it',async()=>{
 const p=await boot({portal:'instagram',asset:photo.id,filesRpc:async a=>photoFiles(a),magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,result:{...magicAnalysis.result,subject_type:'unclear'}}})});
 assert.equal(p.get('source_text').value,'');assert.equal(p.get('applyMagic').hidden,true);assert.match(p.get('magicStatus').textContent,/nicht sicher erkennbar/);
});


test('customer file browser selects the actual photo by ID and loads its recognized content',async()=>{
 const p=await boot({portal:'instagram',filesRpc:async a=>photoFiles(a),magicResponse:async()=>({ok:true,analysis:magicAnalysis})});
 p.get('browseFiles').events.click();assert.equal(p.get('filePicker').open,true);
 const row=p.get('filePickerList').children[0];assert.equal(row.querySelector('strong').textContent,photo.name);
 await row.querySelector('button').events.click();assert.equal(p.get('filePicker').open,false);
 assert.equal(p.get('selectedFileName').textContent,photo.name);
 assert.equal(p.calls.find(c=>c.name==='sma_publication_files_v1'&&c.p_action==='get').p_input.asset_id,photo.id);
 assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);
 assert.equal(p.calls.filter(c=>c.url).length,0);
});
test('optimizer gallery pages four files and searches across every page',async()=>{
 const files=Array.from({length:9},(_,i)=>({...ownFile,id:'file-'+i,name:'Clip '+i+'.mp4'}));
 const p=await boot({portal:'youtube',wide:true,files});
 assert.equal(p.get('filePickerList').children.length,4);
 p.get('fileNext').click();p.get('fileNext').click();
 assert.equal(p.get('filePickerList').children.length,1);
 assert.equal(p.get('filePageCount').textContent,'Seite 3 von 3');
 p.get('fileSearch').value='Clip 0';p.get('fileSearch').events.input();
 assert.equal(p.get('filePageCount').textContent,'Seite 1 von 1');
 assert.match(p.get('filePickerList').querySelector('strong').textContent,/Clip 0/);
});
test('file browser searches filenames, paginates ten at a time, and never turns names into markup',async()=>{
 const files=Array.from({length:12},(_,i)=>({...ownFile,id:'file-'+i,name:i===11?'<img src=x onerror=alert(1)>.mp4':'Clip '+i+'.mp4'}));
 const p=await boot({portal:'instagram',files});p.get('browseFiles').events.click();
 assert.equal(p.get('filePickerList').children.length,10);p.get('fileNext').events.click();assert.equal(p.get('filePickerList').children.length,2);
 assert.equal(p.get('filePickerList').children[1].querySelector('strong').textContent,files[11].name);
 assert.equal(p.get('filePickerList').querySelectorAll('img').length,0);
 p.get('fileSearch').value='CLIP 4';p.get('fileSearch').events.input();assert.equal(p.get('filePickerList').children.length,1);assert.equal(p.get('filePageCount').textContent,'Seite 1 von 1');
 assert.equal(p.get('filePickerList').children[0].querySelector('strong').textContent,'Clip 4.mp4');
 p.get('fileSearch').value='missing';p.get('fileSearch').events.input();assert.equal(p.get('filePickerList').children.length,0);assert.match(p.get('filePickerCount').textContent,/Keine Datei/);
});
test('unsupported photo remains visible with an explanation in video-only portal paths',async()=>{
 const p=await boot({portal:'youtube',files:[photo,ownFile]});p.get('browseFiles').events.click();const row=p.get('filePickerList').children[0];
 assert.equal(row.querySelector('strong').textContent,photo.name);assert.match(row.querySelectorAll('small')[1].textContent,/YouTube.*Videodatei/);assert.equal(row.querySelector('button').disabled,true);
 await row.querySelector('button').events.click();assert.equal(p.calls.some(c=>c.name==='sma_publication_files_v1'&&c.p_action==='get'),false);
 assert.equal(p.get('filePicker').open,true);
});
test('file switch preserves caption edits until the user explicitly discards them',async()=>{
 const saved={...result,preview:{...result.preview,drafts:[{...result.preview.drafts[0],platform:'instagram'}]}};
 const p=await boot({portal:'instagram',filesRpc:async a=>photoFiles(a),latest:saved,magicResponse:async()=>({ok:true,analysis:magicAnalysis})});
 const card=p.get('drafts').children[0];const title=card.querySelector('input');title.value=photo.name;card.events.input();
 p.get('browseResultFiles').events.click();await p.get('filePickerList').children[0].querySelector('button').events.click();
 assert.equal(p.get('fileSwitchNotice').hidden,false);assert.equal(p.get('result').hidden,false);assert.equal(title.value,photo.name);assert.equal(p.calls.some(c=>c.name==='sma_publication_files_v1'&&c.p_action==='get'),false);
 p.get('cancelFileSwitch').events.click();assert.equal(p.get('fileSwitchNotice').hidden,true);assert.equal(title.value,photo.name);
 await p.get('filePickerList').children[0].querySelector('button').events.click();await p.get('confirmFileSwitch').events.click();
 assert.equal(p.get('selectedFileName').textContent,photo.name);assert.equal(p.get('drafts').children.length,0);assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);
 assert.equal(p.calls.some(c=>c.p_action==='save'),false);
});
test('source edits also survive cancelled file selection and sign-out clears the open picker',async()=>{
 const p=await boot({portal:'instagram',files:[ownFile]});p.get('source_text').value='Meine neue Beschreibung';p.get('previewForm').events.input();p.get('browseFiles').events.click();
 await p.get('filePickerList').children[0].querySelector('button').events.click();assert.equal(p.get('fileSwitchNotice').hidden,false);p.get('cancelFileSwitch').events.click();assert.equal(p.get('source_text').value,'Meine neue Beschreibung');
 p.signOut();assert.equal(p.get('filePicker').open,false);assert.equal(p.get('filePickerList').children.length,0);assert.equal(p.get('fileSwitchMessage').textContent,'');assert.equal(p.get('source_text').value,'');assert.equal(p.get('browseFiles').disabled,true);
});
test('file browser refresh loads newly catalogued files through the existing authenticated endpoint',async()=>{
 let synced=false;const p=await boot({portal:'instagram',filesRpc:async a=>a.p_action==='list'?{ok:true,files:synced?[ownFile]:[]}:{ok:true,status:'empty'},fetchResponse:async()=>{synced=true;return {ok:true};}});
 p.get('browseFiles').events.click();assert.match(p.get('filePickerCount').textContent,/Noch keine Dateien/);
 await p.get('pickerRefresh').events.click();assert.equal(p.get('filePickerList').children.length,1);assert.equal(p.get('filePicker').open,true);assert.match(p.get('filePickerStatus').textContent,/aktualisiert/);
 const call=p.calls.find(c=>c.url);assert.match(call.url,/sma-publication-files-v1$/);assert.match(call.options.headers.Authorization,/^Bearer /);
});

test('a delayed catalog response after sign-out cannot reopen or refill customer file controls',async()=>{
 let defer=false,release;const p=await boot({portal:'instagram',filesRpc:async a=>a.p_action==='list'?(defer?new Promise(r=>release=r):{ok:true,files:[]}):{ok:true,status:'empty'},fetchResponse:async()=>({ok:true})});
 p.get('browseFiles').events.click();defer=true;const refreshing=p.get('pickerRefresh').events.click();await new Promise(r=>setImmediate(r));
 p.signOut();release({ok:true,files:[ownFile]});await refreshing;
 assert.equal(p.get('filePicker').open,false);assert.equal(p.get('filePickerList').children.length,0);assert.equal(p.get('browseFiles').disabled,true);assert.equal(p.get('inputFields').disabled,true);
});

test('device browse opens native chooser directly for all portals without changing text',async()=>{for(const portal of ['instagram','facebook','youtube','tiktok']){const p=await boot({portal});p.get('source_text').value='Mein Text';p.get('deviceBrowse').events.click();assert.equal(p.get('deviceFile').clicked,true);assert.equal(p.get('deviceFile').accept,['youtube','tiktok'].includes(portal)?'video/*':'image/*,video/*');assert.equal(p.get('source_text').value,'Mein Text');assert.equal(p.get('filePicker').open,undefined);}});
test('successful device upload selects the returned owned file and runs existing Magic Effect',async()=>{let done=false;const id='12345678-1234-4123-8123-123456789abc';const p=await boot({portal:'instagram',filesRpc:async a=>a.p_action==='list'?{ok:true,files:done?[photo]:[]}:{ok:true,status:'empty'},magicResponse:async()=>({ok:true,analysis:magicAnalysis}),fetchResponse:async(url,options)=>{const b=JSON.parse(options.body);if(b.action==='finish'){done=true;return {ok:true,status:'completed',upload_id:id,asset_id:photo.id,can_publish:false};}return {ok:true,status:'ready',upload_id:id,upload_url:'test',can_publish:false};}});p.get('deviceFile').files=[{name:'Foto.jpg',type:'image/jpeg',size:42}];await p.get('deviceFile').events.change();assert.equal(p.get('selectedFileName').textContent,photo.name);assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);assert.equal(p.get('uploadProgress').value,100);assert.equal(p.get('retryUpload').hidden,true);assert.equal(p.get('deviceBrowse').disabled,false);const calls=p.calls.filter(c=>c.url?.includes('device-upload'));assert.deepEqual(calls.map(c=>JSON.parse(c.options.body).action),['start','finish']);assert.ok(calls.every(c=>c.options.headers.Authorization.startsWith('Bearer ')));});
test('retrying upload initialization preserves upload identity and dirty customer text',async()=>{let first=true,done=false;const p=await boot({portal:'instagram',filesRpc:async a=>a.p_action==='list'?{ok:true,files:done?[photo]:[]}:{ok:true,status:'empty'},fetchResponse:async(url,options)=>{const b=JSON.parse(options.body);if(first){first=false;throw Error('lost network');}done=true;return {ok:true,status:'completed',upload_id:b.upload_id,asset_id:photo.id,can_publish:false};}});p.get('source_text').value='Nicht überschreiben';p.get('previewForm').events.input();p.get('deviceFile').files=[{name:'Foto.jpg',type:'image/jpeg',size:42}];await p.get('deviceFile').events.change();assert.equal(p.get('retryUpload').hidden,false);await p.get('retryUpload').events.click();assert.equal(p.get('source_text').value,'Nicht überschreiben');assert.equal(p.get('fileSwitchNotice').hidden,false);const calls=p.calls.filter(c=>c.url?.includes('device-upload'));assert.equal(JSON.parse(calls[0].options.body).upload_id,JSON.parse(calls[1].options.body).upload_id);});
test('logout aborts an in-flight upload and rejects a late completion',async()=>{let release;const p=await boot({portal:'instagram',fetchResponse:()=>new Promise(r=>release=r)});p.get('deviceFile').files=[{name:'Foto.jpg',type:'image/jpeg',size:42}];const work=p.get('deviceFile').events.change();await new Promise(r=>setImmediate(r));p.signOut();release({ok:true,status:'completed',upload_id:'12345678-1234-4123-8123-123456789abc',asset_id:photo.id,can_publish:false});await work;assert.equal(p.get('uploadPanel').hidden,true);assert.equal(p.get('source_text').value,'');assert.equal(p.get('deviceBrowse').disabled,true);assert.notEqual(p.get('selectedFileName').textContent,photo.name);});

const thumbnail={ok:true,asset_id:ownFile.id,asset_revision:ownFile.revision,media_kind:'video',mime_type:'image/png',image_base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',can_publish:false};
test('selected media is displayed visually with collapsed filename and revoked on sign-out',async()=>{
 const p=await boot({portal:'instagram',asset:ownFile.id,files:[ownFile],assetPreviewResponse:async()=>thumbnail});await new Promise(r=>setImmediate(r));
 assert.equal(p.get('fileDetails').open,false);assert.equal(p.get('selectedFileName').textContent,ownFile.name);
 assert.equal(p.get('assetPreviewMedia').children[0].tag,'img');assert.equal(p.get('assetPreviewKind').textContent,'Video');assert.equal(p.createdUrls.length,1);
 const request=JSON.parse(p.mediaCalls[0].options.body);assert.deepEqual(request,{asset_id:ownFile.id,asset_revision:ownFile.revision});
 p.signOut();assert.equal(p.get('assetPreviewMedia').children.length,0);assert.deepEqual(p.revokedUrls,['blob:preview-0']);
});
test('wrong-asset, stale, active-content and oversized preview responses never render',async()=>{
 for(const patch of [{asset_id:'foreign'},{asset_revision:'old'},{media_kind:'image'},{can_publish:true},{mime_type:'image/svg+xml'},{image_base64:'a'.repeat(2666669)}]){
  const p=await boot({portal:'instagram',asset:ownFile.id,files:[ownFile],assetPreviewResponse:async()=>({...thumbnail,...patch})});await new Promise(r=>setImmediate(r));
  assert.equal(p.createdUrls.length,0);assert.equal(p.get('retryAssetPreview').hidden,false);assert.match(p.get('assetPreviewStatus').textContent,/bleibt ausgewählt/);
 }
});
test('a late thumbnail cannot reappear after sign-out or switching to a general template',async()=>{
 for(const action of ['signOut','clear']){
  let release;const p=await boot({portal:'instagram',asset:ownFile.id,files:[ownFile],assetPreviewResponse:()=>new Promise(r=>release=r)});
  if(action==='signOut')p.signOut();else await p.get('chooseGeneralTemplate').events.click();
  release(thumbnail);await new Promise(r=>setImmediate(r));assert.equal(p.createdUrls.length,0);assert.equal(p.get('assetPreviewMedia').children.length,0);
 }
});
test('a completed device upload uses the selected local video and removes long progress text',async()=>{
 const longName='a'.repeat(250)+'.mp4',file={...ownFile,name:longName};
 const p=await boot({portal:'instagram',files:[file],fetchResponse:async()=>({ok:true,status:'completed',asset_id:file.id,upload_id:'12345678-1234-4123-8123-123456789abc',can_publish:false})});
 const local={name:longName,size:123,type:'video/mp4'};p.get('deviceFile').files=[local];await p.get('deviceFile').events.change();
 const media=p.get('assetPreviewMedia').children[0];assert.equal(media.tag,'video');assert.equal(media.controls,true);assert.equal(media.playsInline,true);assert.equal(p.createdUrls[0].blob,local);
 assert.equal(p.get('uploadStatus').textContent,'✓ Datei hochgeladen');assert.equal(p.get('uploadProgress').hidden,true);assert.equal(p.get('uploadKeepOpen').hidden,true);assert.equal(p.mediaCalls.length,0);
 p.signOut();assert.equal(media.paused,true);assert.equal(media.src,undefined);assert.equal(p.revokedUrls.length,1);
});

const instagramResult={...result,preview:{...result.preview,drafts:[{...result.preview.drafts[0],platform:'instagram'}]}};
const supportedVideo={...ownFile,mime_type:'video/mp4',size_bytes:1000,duration_ms:10000,revision:'sha256:'+'a'.repeat(64)+':1'};
const videoAnalysis={...magicAnalysis,asset_id:supportedVideo.id,asset_revision:supportedVideo.revision,policy_version:'magic-video-2026-11-03.1',result:{...magicAnalysis.result,policy_version:'magic-video-2026-11-03.1',description:'Ein blaues Quadrat bewegt sich von links nach rechts.',source_text:'Automatische Videoerkennung: Ein blaues Quadrat bewegt sich von links nach rechts. Das Video enthält keine Tonspur.',audio_status:'no_audio_stream',content_comparison:'model_checked_sampled_evidence',evidence:{source_sha256:'a'.repeat(64)}}};
const videoFiles=async a=>a.p_action==='list'?{ok:true,files:[supportedVideo]}:a.p_action==='assign'?{...instagramResult,assignment_revision:1}:{ok:true,status:'empty'};
test('new video waits for explicit Magic click, then recognizes, generates and assigns to the exact video',async()=>{
 let started=false,reads=0;
 const p=await boot({portal:'instagram',asset:supportedVideo.id,filesRpc:videoFiles,formTracksDom:true,timer:fn=>setImmediate(fn),
 magicResponse:async()=>({ok:true,analysis:started&&++reads>0?videoAnalysis:{...videoAnalysis,status:'unrecognized',result:null}}),
 fetchResponse:async url=>{if(url.endsWith('sma-publication-video-magic-effect-v1')){started=true;return {ok:true,analysis:{...videoAnalysis,status:'processing',result:null}};}return instagramResult;}});
 assert.equal(p.calls.some(c=>c.url),false);assert.equal(p.get('magicText').disabled,false);assert.equal(p.get('recognizePhoto').textContent,'Video erkennen');
 await p.get('magicText').click();
 const requests=p.calls.filter(c=>c.url);assert.equal(requests.length,2);assert.match(requests[0].url,/video-magic-effect-v1$/);assert.equal(JSON.parse(requests[1].options.body).source_text,videoAnalysis.result.source_text);
 assert.equal(JSON.parse(requests[1].options.body).media_kind,'video');assert.equal(p.calls.find(c=>c.p_action==='assign').p_input.asset_revision,supportedVideo.revision);
 assert.match(p.get('magicSummary').textContent,/keine Tonspur/);assert.equal(p.get('result').hidden,false);
});
test('cached video recognition survives reopen without provider call and respects existing customer edits',async()=>{
 const p=await boot({portal:'instagram',asset:supportedVideo.id,filesRpc:videoFiles,formTracksDom:true,magicResponse:async()=>({ok:true,analysis:videoAnalysis})});
 assert.equal(p.get('source_text').value,videoAnalysis.result.source_text);assert.equal(p.calls.some(c=>c.url),false);
 p.get('source_text').value='Eigener Inhalt bleibt stehen.';p.get('previewForm').events.input();await p.get('magicSource').click();assert.equal(p.get('magicReplaceNotice').hidden,false);assert.equal(p.get('source_text').value,'Eigener Inhalt bleibt stehen.');
});
test('cached video must match video policy, source hash and comparison result',async()=>{
 for(const patch of [{policy_version:'magic-photo-2026-11-02.1'},{result:{...videoAnalysis.result,evidence:{source_sha256:'b'.repeat(64)}}},{result:{...videoAnalysis.result,content_comparison:null}}]){
  const p=await boot({portal:'instagram',asset:supportedVideo.id,filesRpc:videoFiles,formTracksDom:true,magicResponse:async()=>({ok:true,analysis:{...videoAnalysis,...patch}})});
  assert.equal(p.get('source_text').value,'');assert.equal(p.calls.some(c=>c.url),false);assert.match(p.get('magicStatus').textContent,/kein vollständiges/);
 }
});
const automaticFiles=async a=>a.p_action==='list'?{ok:true,files:[photo]}:a.p_action==='assign'?{...instagramResult,assignment_revision:1}:{ok:true,status:'empty'};
const automaticOptions={portal:'instagram',asset:photo.id,filesRpc:automaticFiles,formTracksDom:true,magicResponse:async()=>({ok:true,analysis:magicAnalysis}),fetchResponse:async()=>instagramResult};
test('one Magic click prepares recognized content without asking for a caption or audience',async()=>{
 const p=await boot(automaticOptions);p.get('language').value='de';
 await p.get('magicSource').click();
 assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);
 assert.equal(p.calls.some(c=>c.url),false);
 assert.match(p.get('status').textContent,/Inhalt ist übernommen/);
 // Moving from generated source to generated caption must not ask to discard "own" edits.
 await p.get('magicText').click();assert.equal(p.get('magicReplaceNotice').hidden,true);
 assert.equal(p.calls.filter(c=>c.url?.endsWith('sma-publication-preview-v1')).length,1);
});
test('automatic caption uses exact recognized source and binding with the fixed relevant-reach goal',async()=>{
 const p=await boot(automaticOptions);p.get('language').value='de';
 await p.get('magicText').click();const req=JSON.parse(p.calls.find(c=>c.url).options.body);
 assert.equal(req.source_text,magicAnalysis.result.source_text);assert.equal(req.audience,'Interessierte am gezeigten Inhalt');assert.match(req.goal,/relevante Reichweite/);
 assert.deepEqual(req.platforms,['instagram']);assert.equal(req.media_kind,'image');assert.ok(!('can_publish' in req));
 const bind=p.calls.find(c=>c.p_action==='assign');assert.equal(bind.p_input.asset_id,photo.id);assert.equal(bind.p_input.asset_revision,photo.revision);
 assert.equal(p.get('result').hidden,false);assert.match(p.get('saveStatus').textContent,/zugeordnet/);assert.equal(p.get('magicText').disabled,false);
});
test('automatic run cannot be duplicated by rapid clicks on either Magic button',async()=>{
 let release;const p=await boot({...automaticOptions,fetchResponse:()=>new Promise(r=>release=r)});
 const first=p.get('magicText').click();await new Promise(r=>setImmediate(r));
 assert.equal(p.get('magicText').disabled,true);assert.equal(p.get('magicSource').disabled,true);
 await p.get('magicText').click();await p.get('magicSource').click();assert.equal(p.calls.filter(c=>c.url).length,1);
 release(instagramResult);await first;assert.equal(p.get('magicText').disabled,false);
});
test('new captions use the simplified defaults even after loading legacy audience and goal settings',async()=>{
 for(const language of ['de','en']){
  const saved={...result,input:{source_text:'Ein gesichert beschriebenes Motiv für unseren Beitrag.',audience:'Alte spezielle Auswahl',goal:'Altes Kampagnenziel',language,media_kind:'video',platforms:['youtube']}};
  const p=await boot({portal:'youtube',latest:saved});await p.run();
  const body=JSON.parse(p.calls.find(c=>c.url).options.body);
  assert.equal(body.source_text,saved.input.source_text);assert.equal(body.language,language);
  assert.equal(body.audience,language==='en'?'People interested in the content shown':'Interessierte am gezeigten Inhalt');
  assert.match(body.goal,language==='en'?/relevant reach/:/relevante Reichweite/);
 }
 const html=fs.readFileSync('app/publication-preview.html','utf8');
 assert.doesNotMatch(html,/(?:id|name)="(?:audience|goal)"/);
});
test('Magic preserves unsaved customer changes until the explicit replacement action',async()=>{
 const p=await boot(automaticOptions);p.get('source_text').value='Meine eigenen neuen Angaben bleiben erhalten.';p.get('previewForm').events.input();
 await p.get('magicText').click();assert.equal(p.get('magicReplaceNotice').hidden,false);assert.equal(p.calls.some(c=>c.url),false);
 p.get('cancelMagicReplace').click();assert.equal(p.get('source_text').value,'Meine eigenen neuen Angaben bleiben erhalten.');
 await p.get('magicText').click();await p.get('confirmMagicReplace').click();assert.equal(p.get('source_text').value,magicAnalysis.result.source_text);
 assert.equal(p.calls.filter(c=>c.url).length,1);
});
test('unsupported video and photo never start automatic recognition or caption',async()=>{
 for(const file of [ownFile,{...photo,mime_type:'image/heic'}]){
  const p=await boot({...automaticOptions,asset:file.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[file]}:{ok:true,status:'empty'}});
  assert.equal(p.get('magicSource').disabled,true);assert.equal(p.get('magicText').disabled,true);
  await p.get('magicText').click();assert.equal(p.calls.some(c=>c.url),false);assert.equal(p.get('source_text').value,'');
  assert.match(p.get('magicTextHint').textContent,file.media_kind==='video'?/MP4 bis 24 MB/:/JPG, PNG oder WebP/);
 }
});
test('unclear recognition cannot become an automatic caption',async()=>{
 const p=await boot({...automaticOptions,magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,result:{...magicAnalysis.result,subject_type:'unclear'}}})});
 await p.get('magicText').click();assert.equal(p.calls.some(c=>c.url),false);assert.equal(p.get('source_text').value,'');assert.match(p.get('status').textContent,/nicht sicher erkennbar/);
});
test('logout during recognition prevents later caption, assignment or content reappearance',async()=>{
 let release;const p=await boot({...automaticOptions,magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,status:'failed',result:null,error_code:'MAGIC_TIMEOUT'}}),fetchResponse:()=>new Promise(r=>release=r)});
 const run=p.get('magicText').click();await new Promise(r=>setImmediate(r));p.signOut();release({ok:true,analysis:magicAnalysis});await run;
 assert.equal(p.calls.filter(c=>c.url).length,1);assert.match(p.calls.find(c=>c.url).url,/magic-effect/);assert.equal(p.calls.some(c=>c.p_action==='assign'),false);
 assert.equal(p.get('source_text').value,'');assert.equal(p.get('magicText').disabled,true);assert.equal(p.get('result').hidden,true);
});
test('missing or unknown recognition subject cannot feed automatic content',async()=>{
 for(const subject_type of [null,'invented']){
  const p=await boot({...automaticOptions,magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,result:{...magicAnalysis.result,subject_type}}}),fetchResponse:async()=>({ok:true,analysis:{...magicAnalysis,result:{...magicAnalysis.result,subject_type}}})});
  await p.get('magicText').click();assert.equal(p.calls.some(c=>c.url?.endsWith('sma-publication-preview-v1')),false);assert.equal(p.get('source_text').value,'');
 }
});

const staleTime=new Date(Date.now()-20*60*1000).toISOString();
const freshFile=(overrides={})=>({...ownFile,assignments:[],verified_at:new Date().toISOString(),...overrides});
const isCatalog=url=>url?.endsWith('/sma-publication-files-v1');
const isCaption=url=>url?.endsWith('/sma-publication-preview-v1');
test('stale, missing and future timestamps refresh before generation without reloading or losing source edits',async()=>{
 for(const verified_at of [staleTime,undefined,new Date(Date.now()+60*60*1000).toISOString()]){
  let listed=0;
  const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[freshFile({verified_at:++listed===1?verified_at:new Date().toISOString()})]}:a.p_action==='assign'?{...result,assignment_revision:1}:{ok:true,status:'empty'},fetchResponse:async url=>isCatalog(url)?{ok:true}:result});
  const sourceText='Meine gesicherten Angaben zu diesem Video bleiben unverändert.';
  p.get('source_text').value=sourceText;p.get('previewForm').events.input();await p.run();
  assert.deepEqual(p.calls.filter(c=>c.url).map(c=>isCatalog(c.url)?'sync':'caption'),['sync','caption']);
  assert.equal(JSON.parse(p.calls.find(c=>isCaption(c.url)).options.body).source_text,sourceText);
  assert.equal(p.get('source_text').value,sourceText);assert.equal(p.calls.filter(c=>c.p_action==='get').length,1);
  assert.match(p.get('saveStatus').textContent,/zugeordnet/);assert.equal(p.get('inputFields').disabled,false);
 }
});
test('automatic refresh before saving preserves edited title, body and source fields',async()=>{
 let listed=0;
 const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[freshFile({verified_at:++listed===1?staleTime:new Date().toISOString(),assignments:[{platform:'youtube',revision:4,status:'assigned'}]})]}:a.p_action==='get'?{...result,assignment_revision:4}:a.p_action==='save'?savedTextReceipt(result,a.p_input):{ok:true,status:'empty'},fetchResponse:async()=>({ok:true})});
 const card=p.get('drafts').children[0];card.querySelector('[data-field=title]').value='Mein bearbeiteter Titel';card.querySelector('textarea').value='Mein bearbeiteter Beitragstext bleibt erhalten.';card.events.input();
 p.get('source_text').value='Meine zusätzlichen eigenen gesicherten Angaben.';p.get('previewForm').events.input();
 await p.save();const save=p.calls.find(c=>c.p_action==='save');
 assert.equal(save.p_input.title,'Mein bearbeiteter Titel');assert.equal(save.p_input.body,'Mein bearbeiteter Beitragstext bleibt erhalten.');assert.equal(save.p_input.assignment_revision,4);
 assert.equal(p.get('source_text').value,'Meine zusätzlichen eigenen gesicherten Angaben.');assert.equal(p.calls.filter(c=>c.p_action==='get').length,1);
 assert.equal(p.calls.filter(c=>isCatalog(c.url)).length,1);assert.match(p.get('status').textContent,/Änderungen gespeichert/);
});
test('cached Magic content also checks a stale file before generating and binding its caption',async()=>{
 let listed=0;
 const p=await boot({...automaticOptions,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[{...photo,assignments:[],verified_at:++listed===1?staleTime:new Date().toISOString()}]}:a.p_action==='assign'?{...instagramResult,assignment_revision:1}:{ok:true,status:'empty'},fetchResponse:async url=>isCatalog(url)?{ok:true}:instagramResult});
 await p.get('magicText').click();
 assert.deepEqual(p.calls.filter(c=>c.url).map(c=>isCatalog(c.url)?'sync':'caption'),['sync','caption']);
 assert.equal(JSON.parse(p.calls.find(c=>isCaption(c.url)).options.body).source_text,magicAnalysis.result.source_text);
 assert.equal(p.calls.find(c=>c.p_action==='assign').p_input.asset_revision,photo.revision);assert.equal(p.get('magicText').disabled,false);
});
test('removed or changed files and concurrent assignments stop before generation and keep the customer input',async()=>{
 for(const [after,expected] of [[[],/nicht mehr/],[[freshFile({revision:'version:2'})],/Datei wurde geändert/],[[freshFile({assignments:[{platform:'youtube',revision:1,status:'assigned'}]})],/Zuordnung wurde inzwischen/]]){
  let listed=0;
  const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:++listed===1?[freshFile({verified_at:staleTime})]:after}:{ok:true,status:'empty'},fetchResponse:async()=>({ok:true})});
  p.get('source_text').value='Meine ursprünglichen gesicherten Angaben.';p.get('previewForm').events.input();await p.run();
  assert.equal(p.calls.some(c=>isCaption(c.url)||c.p_action==='assign'),false);assert.equal(p.get('source_text').value,'Meine ursprünglichen gesicherten Angaben.');assert.match(p.get('status').textContent,expected);assert.equal(p.get('inputFields').disabled,false);
 }
});
test('a rejected catalog refresh preserves the edited draft and does not save stale data',async()=>{
 const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[freshFile({verified_at:staleTime})]}:a.p_action==='get'?{...result,assignment_revision:1}:{ok:true,status:'empty'},fetchResponse:async()=>({ok:false,code:'FILE_SYNC_RATE_LIMITED'})});
 const body=p.get('drafts').children[0].querySelector('textarea');body.value='Meine ungespeicherten Änderungen bleiben hier.';await p.save();
 assert.equal(p.calls.some(c=>c.p_action==='save'),false);assert.equal(body.value,'Meine ungespeicherten Änderungen bleiben hier.');assert.match(p.get('status').textContent,/warte kurz/);assert.match(p.get('saveStatus').textContent,/noch nicht gespeichert/);assert.equal(p.get('save').disabled,false);
});
test('server freshness rejection refreshes and retries the same assignment once without generating a second caption',async()=>{
 for(const rejectsTwice of [false,true]){
  let assigns=0;
  const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[freshFile()]}:a.p_action==='assign'?(++assigns===1||rejectsTwice?{ok:false,code:'FILE_REFRESH_REQUIRED'}:{...result,assignment_revision:1}):{ok:true,status:'empty'},fetchResponse:async url=>isCatalog(url)?{ok:true}:result});
  await p.run();assert.equal(assigns,2);assert.equal(p.calls.filter(c=>isCatalog(c.url)).length,1);assert.equal(p.calls.filter(c=>isCaption(c.url)).length,1);
  const binds=p.calls.filter(c=>c.p_action==='assign');assert.deepEqual(binds[0].p_input,binds[1].p_input);assert.equal(p.get('result').hidden,rejectsTwice);
 }
});
test('retry after a failed assignment reuses the completed caption; an intentional new generation is separate',async()=>{
 let assigns=0;
 const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[freshFile()]}:a.p_action==='assign'?(++assigns===1?{ok:false,code:'FILE_SYNC_UNAVAILABLE'}:{...result,assignment_revision:assigns}):{ok:true,status:'empty'}});
 await p.run();assert.equal(p.get('result').hidden,true);await p.run();
 assert.equal(p.calls.filter(c=>isCaption(c.url)).length,1);const binds=p.calls.filter(c=>c.p_action==='assign');assert.deepEqual(binds[0].p_input,binds[1].p_input);assert.equal(p.get('result').hidden,false);
 await p.run();assert.equal(p.calls.filter(c=>isCaption(c.url)).length,2);
});
test('Magic retries a server freshness rejection with the same file identity and no duplicate successful recognition',async()=>{
 let starts=0;
 const p=await boot({...automaticOptions,magicResponse:async()=>({ok:true,analysis:{...magicAnalysis,status:'failed',result:null,error_code:'MAGIC_TIMEOUT'}}),fetchResponse:async url=>isCatalog(url)?{ok:true}:url.endsWith('/sma-publication-magic-effect-v1')?(++starts===1?{ok:false,code:'FILE_REFRESH_REQUIRED'}:{ok:true,analysis:magicAnalysis}):instagramResult});
 await p.get('magicText').click();assert.equal(starts,2);assert.equal(p.calls.filter(c=>isCatalog(c.url)).length,1);assert.equal(p.calls.filter(c=>isCaption(c.url)).length,1);
 const posts=p.calls.filter(c=>c.url?.endsWith('/sma-publication-magic-effect-v1'));assert.equal(posts[0].options.body,posts[1].options.body);assert.match(p.get('saveStatus').textContent,/zugeordnet/);
});
test('logout while refreshing blocks caption generation and cannot restore customer content',async()=>{
 let release;
 const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[freshFile({verified_at:staleTime})]}:{ok:true,status:'empty'},fetchResponse:()=>new Promise(resolve=>release=resolve)});
 p.get('source_text').value='Eigene Angaben, die bei Abmeldung verschwinden müssen.';
 const run=p.run();await new Promise(resolve=>setImmediate(resolve));p.signOut();release({ok:true});await run;
 assert.equal(p.calls.some(c=>isCaption(c.url)||c.p_action==='assign'),false);assert.equal(p.calls.filter(c=>c.p_action==='list').length,1);assert.equal(p.get('source_text').value,'');assert.equal(p.get('result').hidden,true);assert.equal(p.get('inputFields').disabled,true);assert.match(p.get('status').textContent,/melde dich/);
});

test('relocated language control stays locked during generation and after logout',async()=>{
 let release;const p=await boot({fetchResponse:()=>new Promise(r=>release=r)});
 const pending=p.run();await new Promise(r=>setImmediate(r));assert.equal(p.get('language').disabled,true);
 release(result);await pending;assert.equal(p.get('language').disabled,false);
 p.signOut();assert.equal(p.get('language').disabled,true);
});
test('language changes preserve unsaved customer choices before a Magic replacement',async()=>{
 const p=await boot(automaticOptions);p.get('language').value='en';p.get('language').events.change();
 await p.get('magicText').click();assert.equal(p.get('magicReplaceNotice').hidden,false);assert.equal(p.calls.some(c=>c.url),false);
 p.get('cancelMagicReplace').click();assert.equal(p.get('language').value,'en');
});


test('all four portal workspaces exist before a delayed account client can resolve',async()=>{
 for(const [portal,label] of Object.entries({youtube:'YouTube',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok'})){
  const p=await boot({portal,wide:true,beforeClientReady:async({get,calls,workspaces})=>{
   assert.deepEqual(workspaces,[label]);assert.equal(calls.length,0);
   assert.equal(get('deviceBrowse').disabled,true);assert.equal(get('inputFields').disabled,true);
   assert.match(get('portalStatus').textContent,/Dateien werden geladen/);
   await new Promise(resolve=>setImmediate(resolve));
   assert.deepEqual(workspaces,[label]);assert.equal(calls.length,0);
  }});
  assert.equal(p.get('deviceBrowse').disabled,false);
  assert.equal(p.calls.find(c=>c.p_action==='latest').p_input.platform,portal);
 }
});
test('failed account-client loading retains every portal workspace and blocks actions',async()=>{
 for(const portal of ['youtube','instagram','facebook','tiktok']){
  const p=await boot({portal,wide:true,beforeClientReady:()=>{throw Error('network unavailable');}});
  assert.equal(p.workspaces.length,1);assert.equal(p.calls.length,0);
  assert.equal(p.get('inputFields').disabled,true);assert.equal(p.get('deviceBrowse').disabled,true);
  assert.match(p.get('portalStatus').textContent,/Ansicht konnte nicht geladen/);
  assert.equal(p.get('source_text').value,'Dies ist eine sachliche Beschreibung des SMA Testartikels.');
 }
});

test('targeted video metadata refresh retains source and caption edits without analysis or saving',async()=>{
 let ready=false;const file={...ownFile,duration_ms:null,width_px:null,height_px:null,assignments:[]};
 const p=await boot({portal:'youtube',asset:file.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[ready?{...file,duration_ms:3000,width_px:320,height_px:240}:file]}:a.p_action==='get'?{...result,assignment_revision:0}:{ok:true},fetchResponse:async()=>{ready=true;return {ok:true};}});
 assert.equal(p.get('videoMetadataPanel').hidden,false);const body=p.get('drafts').children[0].querySelector('textarea');body.value='Meine ungespeicherten Angaben.';p.get('source_text').value='Eigene Beschreibung';const before=p.calls.length;
 await p.get('refreshVideoMetadata').events.click();assert.equal(p.get('videoMetadataPanel').hidden,true);assert.equal(body.value,'Meine ungespeicherten Angaben.');assert.equal(p.get('source_text').value,'Eigene Beschreibung');const added=p.calls.slice(before);assert.equal(added.filter(c=>c.url).length,1);assert.ok(added.find(c=>c.url).url.endsWith('/sma-publication-files-v1'));assert.deepEqual(added.filter(c=>c.name).map(c=>c.p_action),['list']);assert.match(p.get('status').textContent,/Eingaben bleiben erhalten/);
});
test('targeted metadata refresh reports pending or changed file and never replaces current text',async()=>{
 for(const changed of [false,true]){let refresh=false;const file={...ownFile,duration_ms:null};const p=await boot({portal:'youtube',asset:file.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[{...file,revision:refresh&&changed?'new-revision':file.revision}]}:{ok:true,status:'empty'},fetchResponse:async()=>{refresh=true;return {ok:true};}});p.get('source_text').value='Behalten';await p.get('refreshVideoMetadata').events.click();assert.equal(p.get('source_text').value,'Behalten');assert.equal(p.get('videoMetadataPanel').hidden,false);assert.match(p.get('status').textContent,changed?/Datei wurde geändert/:/noch nicht bereitgestellt/);assert.equal(p.get('refreshVideoMetadata').disabled,false);}
});
test('targeted metadata refresh serializes clicks and discards signed-out responses',async()=>{let release;const file={...ownFile,duration_ms:null};const p=await boot({portal:'youtube',asset:file.id,files:[file],fetchResponse:()=>new Promise(r=>release=r)});const first=p.get('refreshVideoMetadata').events.click();await new Promise(r=>setImmediate(r));await p.get('refreshVideoMetadata').events.click();assert.equal(p.calls.filter(c=>c.url).length,1);p.signOut();release({ok:true});await first;assert.equal(p.get('videoMetadataPanel').hidden,true);assert.equal(p.get('refreshVideoMetadata').disabled,true);assert.match(p.get('status').textContent,/melde dich/);});

const confirmedProduct={
 state:'matched',method:'media',asset_id:supportedVideo.id,asset_revision:supportedVideo.revision,
 name:'Mobiler Türgriff fürs Hotel',topic:'Reisehygiene',purpose:'Die gemeinsam genutzte Klinke lässt sich ohne direkten Handkontakt betätigen.',
 visual:'Eine Hand setzt ein rotes Zusatzgerät an eine verchromte Türklinke.'
};
function productFiles(product,saved={ok:true,status:'empty'}){
 return a=>['get','product'].includes(a.p_action)?{...saved,product_context:product}:videoFiles(a);
}
test('a confirmed video reuses its reviewed scene and supplies product facts to the portal writer',async()=>{
 const p=await boot({portal:'instagram',asset:supportedVideo.id,filesRpc:productFiles(confirmedProduct),
  formTracksDom:true,fetchResponse:async()=>instagramResult});
 assert.match(p.get('productContext').textContent,/Reisehygiene/);
 await p.get('magicText').click();
 const requests=p.calls.filter(c=>c.url);
 assert.equal(requests.length,1);assert.ok(isCaption(requests[0].url));
 const input=JSON.parse(requests[0].options.body);
 assert.ok(input.source_text.includes(confirmedProduct.purpose));
 assert.ok(input.source_text.endsWith(confirmedProduct.visual));
 assert.deepEqual(input.platforms,['instagram']);
 assert.equal(p.get('source_text').value,confirmedProduct.visual);
 p.signOut();assert.equal(p.get('productContext').hidden,true);
 assert.equal(p.get('productContext').textContent,'');
 const saved={...instagramResult,input:{...input}};
 const reopened=await boot({portal:'instagram',asset:supportedVideo.id,filesRpc:productFiles(confirmedProduct,saved)});
 assert.equal(reopened.get('source_text').value,confirmedProduct.visual);
});
test('ambiguous products ask in the source field and allow an explicit customer description',async()=>{
 const p=await boot({portal:'instagram',asset:supportedVideo.id,
  filesRpc:productFiles({...confirmedProduct,state:'ambiguous'}),formTracksDom:true,fetchResponse:async()=>instagramResult});
 await p.get('magicText').click();
 assert.equal(p.calls.some(c=>c.url),false);assert.equal(p.get('source_text').focused,true);
 p.get('source_text').value='Die gezeigte Reisetasche hat einen Schultergurt.';
 p.get('previewForm').events.input();await p.run();
 assert.equal(JSON.parse(p.calls.find(c=>isCaption(c.url)).options.body).source_text,p.get('source_text').value);
});
test('a product result from another file revision cannot supply draft facts',async()=>{
 const p=await boot({portal:'instagram',asset:supportedVideo.id,filesRpc:productFiles({...confirmedProduct,asset_revision:'other'}),
  fetchResponse:async()=>instagramResult});
 assert.equal(p.get('productContext').hidden,true);
 p.get('source_text').value='Ein Reisender hält eine Tasche mit Schultergurt.';
 await p.run();const input=JSON.parse(p.calls.find(c=>isCaption(c.url)).options.body);
 assert.equal(input.source_text,p.get('source_text').value);
});

test('optimizer gallery shows a searchable human title and version before a file is chosen',async()=>{
 const opaque='AQMhklsQz6e9lapBGlhaRyVnvjCXzquTPscWTmICBtNzIqjE1F';
 const original={...supportedVideo,name:opaque+'.mp4',duration_ms:10041,
  display:{product:'Mobiler Türgriff fürs Hotel',draft_title:'Mein Griff für unterwegs',variant:'original'}};
 const clip={...original,id:'export-clip',name:'SMA-Export-2.mp4',duration_ms:2999,display:{...original.display,variant:'clip'}};
 const p=await boot({portal:'youtube',wide:true,files:[original,clip,{...photo,name:'Sommer_am_See.jpg'}]});
 assert.ok(p.calls.find(c=>c.p_action==='list'&&c.p_input.platform==='youtube'));
 const search=value=>{p.get('fileSearch').value=value;p.get('fileSearch').events.input();return p.get('filePickerList').children;};
 const hits=search('türgriff');assert.equal(hits.length,2);
 assert.equal(hits[0].querySelector('strong').textContent,'Mobiler Türgriff fürs Hotel');
 assert.equal(hits[0].querySelector('small').textContent,'Originalvideo · 10 Sek.');
 assert.equal(hits[1].querySelector('small').textContent,'Videoausschnitt · 3 Sek.');
 assert.match(hits[0].querySelector('button')['aria-label'],/Mobiler Türgriff.*Originalvideo/);
 assert.equal(search('AQMhkl').length,1);assert.equal(search('unterwegs').length,2);
 assert.equal(search('Sommer am See')[0].querySelector('strong').textContent,'Sommer am See');
});
test('optimizer falls back to media and date for unknown generated filenames',async()=>{
 const p=await boot({portal:'youtube',wide:true,files:[{...supportedVideo,name:'SMA-Export-c6428ddf-06a0-4d2c-a239-e10037a7ad0b.mp4',modified_at:'2026-11-01T12:34:00Z'}]});
 const row=p.get('filePickerList').children[0];
 assert.match(row.querySelector('strong').textContent,/^Video vom/);
 assert.doesNotMatch(row.querySelector('button')['aria-label'],/c6428ddf/);
 assert.match(row.querySelector('details').querySelector('strong').textContent,/Dateiname: SMA-Export/);
});

const historyOrderId='a77a0000-0000-4000-8000-000000000010';
const historySaved={...result,id:'a77a0000-0000-4000-8000-000000000011',status:'completed',assignment_revision:4};
const historyFile={...ownFile,assignments:[{platform:'youtube',revision:4,status:'assigned'}]};
const historyOrder={ok:true,id:historyOrderId,state:'prepared',approved_at:null,can_publish:false,can_upload:false,
 draft:historySaved.preview.drafts[0],binding:{platform:'youtube',asset_id:historyFile.id,asset_revision:historyFile.revision,
 assignment_revision:4,preview_id:historySaved.id,preview_revision:historySaved.revision,shop_url:historySaved.preview.shop_url}};
function historyView({order=historyOrder,file=historyFile,saved=historySaved,orderId=historyOrderId,...rest}={}){
 return boot({portal:'youtube',wide:true,orderId,orderResponse:order,filesRpc:async a=>a.p_action==='list'?
  {ok:true,files:file?[file]:[]}:a.p_action==='get'?saved:{ok:true},...rest});
}
test('history opens the specific prepared order directly as a saved post preview',async()=>{
 const p=await historyView();assert.deepEqual(p.views,['preview']);assert.equal(p.get('result').hidden,false);
 assert.equal(p.calls.find(c=>c.name==='sma_publication_order_v1').p_input.id,historyOrderId);
 assert.equal(p.calls.some(c=>c.url||!['get','list','check'].includes(c.p_action)),false);
 assert.equal(p.orderOptions.getContext().binding.preview_id,historySaved.id);assert.equal(p.orderOptions.previousOrder.id,historyOrderId);
});
const cancelledOrder={...historyOrder,state:'cancelled',approval_token:null,approval_review:null,check_error:'ORDER_CHANGED'};
const expiredWindow={status:'expired',expires_at:'2026-11-07T10:00:00Z'};
test('expired preparations open the latest assigned text of the same file without resuming the old ID',async()=>{
 for(const portal of ['youtube','tiktok'])for(const state of ['prepared','preparing']){
  const pending=state==='preparing';
  const order={...historyOrder,state,approval_token:null,target:pending?null:{platform:portal,id:'test-target'},
   binding:{...historyOrder.binding,platform:portal},draft:{...historyOrder.draft,platform:portal},
   [pending?'preparation_window':'approval_window']:expiredWindow,check_error:'ORDER_CHANGED'};
  const file={...historyFile,assignments:[{platform:portal,revision:8,status:'assigned'}]};
  const draft={...order.draft,body:'Heute gespeicherter Beitrag für diese Datei.'};
  const saved={...historySaved,assignment_revision:8,id:'a77a0000-0000-4000-8000-000000000023',revision:3,preview:{...historySaved.preview,drafts:[draft]}};
  const p=await historyView({portal,order,file,saved});
  assert.deepEqual(p.views,['preview']);assert.equal(p.get('drafts').querySelector('textarea').value,draft.body);
  assert.equal(p.orderOptions.getContext().binding.preview_id,saved.id);assert.equal(p.orderOptions.getContext().binding.assignment_revision,8);
  assert.equal(p.orderOptions.previousOrder,undefined);assert.equal(p.orderOptions.resumeOrder,undefined);
  assert.match(p.get('status').textContent,/Vorbereitung ist abgelaufen/);
  assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
 }
});
test('an unchanged expired YouTube draft retains optional video suggestions and starts with a closed order dialog',async()=>{
 const order={...historyOrder,approval_token:null,approval_window:expiredWindow};
 const p=await historyView({order,resume:true});assert.deepEqual(p.views,['preview']);
 assert.equal(p.orderOptions.previousOrder.id,order.id);assert.equal(p.orderOptions.resumeOrder,undefined);
 assert.equal(p.get('back').href,'dashboard.html#auftrag/'+order.id);
});
test('expiry during a resume lookup opens the current revision without a stale approval dialog',async()=>{
 let reads=0;
 const p=await historyView({resume:true,orderResponse:async()=>++reads===1?historyOrder:{...historyOrder,approval_token:null,approval_window:expiredWindow}});
 assert.deepEqual(p.views,['preview']);assert.equal(p.orderOptions.resumeOrder,undefined);assert.match(p.get('status').textContent,/abgelaufen/);
 assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
});
test('expired history never applies the old video answers to a different caption or opens an invalid order',async()=>{
 const order={...historyOrder,approval_token:null,approval_window:expiredWindow};
 const updated={...historyOrder.draft,body:'Ein geänderter Text mit denselben Revisionsangaben.'};
 const p=await historyView({order,saved:{...historySaved,preview:{...historySaved.preview,drafts:[updated]}}});
 assert.deepEqual(p.views,['preview']);assert.equal(p.orderOptions.previousOrder,undefined);
 for(const patch of [
  {approval_token:'old-token'},{approval_review:{}},{approved_at:'2026-11-07T09:00:00Z'},
  {approval_window:{...expiredWindow,expires_at:'invalid'}},{preparation_window:expiredWindow},
  {state:'approved'},{can_publish:true},{can_upload:true},{check_error:'FILE_UNAVAILABLE'},{check_error:'UNKNOWN_ERROR'}
 ]){
  const bad=await historyView({order:{...order,...patch},resume:true});
  assert.deepEqual(bad.views,[]);assert.equal(bad.orderOptions.previousOrder,undefined);assert.equal(bad.orderOptions.resumeOrder,undefined);
 }
 const replaced=await historyView({order,file:{...historyFile,revision:'other-version'}});
 assert.deepEqual(replaced.views,[]);assert.equal(replaced.get('result').hidden,true);
});
test('an old date on the device cannot unlock a newer text while the server still reports active or recheck',async()=>{
 for(const status of ['active','recheck']){
  const p=await historyView({order:{...historyOrder,approval_window:{...expiredWindow,status},check_error:'ORDER_CHANGED'},
   file:{...historyFile,assignments:[{platform:'youtube',status:'assigned',revision:6}]},saved:{...historySaved,assignment_revision:6}});
  assert.deepEqual(p.views,[]);assert.equal(p.get('result').hidden,true);
  assert.equal(p.orderOptions.previousOrder,undefined);assert.equal(p.orderOptions.resumeOrder,undefined);
  assert.ok(p.calls.every(c=>c.name==='sma_publication_order_v1'&&c.p_action==='get'));
 }
});
test('expiry after the folder refresh can open the newer text of the original file',async()=>{
 let refreshed=false;
 const order={...historyOrder,approval_token:null,approval_window:expiredWindow};
 const p=await historyView({orderResponse:()=>({...order,check_error:refreshed?'ORDER_CHANGED':'FILE_CHANGED'}),
  fetchResponse:async()=>{refreshed=true;return {ok:true};},file:{...historyFile,assignments:[{platform:'youtube',revision:6,status:'assigned'}]},
  saved:{...historySaved,assignment_revision:6},resume:true});
 assert.deepEqual(p.views,['preview']);assert.equal(p.orderOptions.getContext().binding.assignment_revision,6);
 assert.equal(p.orderOptions.previousOrder,undefined);assert.equal(p.orderOptions.resumeOrder,undefined);
 assert.deepEqual(p.calls.filter(c=>c.url).map(c=>new URL(c.url).pathname),['/webhook/sma-publication-files-v1']);
});
test('a cancelled order opens the current saved draft of the same file and portal without restoring any preparation',async()=>{
 for(const portal of ['youtube','tiktok']){
  const order={...cancelledOrder,binding:{...historyOrder.binding,platform:portal},draft:{...historyOrder.draft,platform:portal}};
  const file={...historyFile,assignments:[{platform:portal,revision:8,status:'assigned'}]};
  const draft={...order.draft,title:'Heutiger Titel',body:'Aktuelle Fassung für diese Datei.'};
  const saved={...historySaved,assignment_revision:8,id:'a77a0000-0000-4000-8000-000000000021',revision:3,preview:{...historySaved.preview,drafts:[draft]}};
  const p=await historyView({portal,order,file,saved,currentPost:true});
  assert.deepEqual(p.views,['preview']);assert.equal(p.get('drafts').querySelector('textarea').value,draft.body);
  assert.equal(p.orderOptions.getContext().binding.preview_id,saved.id);assert.equal(p.orderOptions.getContext().binding.assignment_revision,8);
  assert.equal(p.orderOptions.previousOrder,undefined);assert.equal(p.orderOptions.resumeOrder,undefined);
  assert.equal(p.get('back').href,'dashboard.html#auftrag/'+order.id);
  assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
 }
});
test('editing after cancellation saves the current assignment and never writes to the old order',async()=>{
 const file={...historyFile,assignments:[{platform:'youtube',revision:8,status:'assigned'}]};
 const saved={...historySaved,assignment_revision:8};
 const p=await historyView({currentPost:true,order:cancelledOrder,filesRpc:async a=>{
  if(a.p_action==='list')return {ok:true,files:[file]};
  if(a.p_action==='get')return saved;
  if(a.p_action==='save')return savedTextReceipt(saved,a.p_input);
  return {ok:true};
 }});
 assert.equal(p.get('result').hidden,false);
 p.get('drafts').querySelector('textarea').value='Neu bearbeiteter Beitrag der aktuellen Version.';
 await p.save();
 const write=p.calls.find(c=>c.p_action==='save');
 assert.equal(write.name,'sma_publication_files_v1');assert.equal(write.p_input.asset_id,file.id);
 assert.equal(write.p_input.assignment_revision,8);assert.match(write.p_input.body,/Neu bearbeiteter Beitrag/);
 assert.deepEqual(p.calls.filter(c=>c.name==='sma_publication_order_v1').map(c=>c.p_action),['get']);
 assert.equal(p.orderOptions.getContext().binding.assignment_revision,9);
});
test('retry after an edit during lookup opens only the latest confirmed assignment',async()=>{
 let revision=4;
 const p=await historyView({currentPost:true,order:cancelledOrder,filesRpc:async req=>{
  if(req.p_action==='get')return {...historySaved,assignment_revision:revision};
  if(req.p_action==='list'){revision=5;return {ok:true,files:[{...historyFile,assignments:[{platform:'youtube',revision,status:'assigned'}]}]};}
  return {ok:true};
 }});
 assert.deepEqual(p.views,[]);const retry=p.get('refreshFiles');assert.equal(retry.disabled,false);
 await retry.click();assert.deepEqual(p.views,['preview']);assert.equal(p.orderOptions.getContext().binding.assignment_revision,5);
 assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
});
test('current-post route uses the current product and offers repair when it was removed',async()=>{
 const draft={...historyOrder.draft,product_id:'aktueller-artikel'};
 const saved={...historySaved,product_link_available:false,preview:{...historySaved.preview,drafts:[draft]}};
 const p=await historyView({currentPost:true,order:cancelledOrder,saved});
 assert.deepEqual(p.views,['source']);assert.equal(p.get('draftLinkEditor').open,true);
 assert.equal(p.orderOptions.previousOrder,undefined);assert.equal(p.orderOptions.resumeOrder,undefined);
 assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
});
test('current-post link fails closed on changed files, stale assignments, invalid drafts and other order states',async()=>{
 for(const options of [
  {resume:true},{order:historyOrder},{order:{...cancelledOrder,approved_at:'2026-11-08T10:00:00Z'}},
  {order:{...cancelledOrder,approval_token:'active'}},{order:{...cancelledOrder,approval_review:{}}},
  {order:{...cancelledOrder,binding:{...historyOrder.binding,platform:'tiktok'}}},
  {order:{ok:false,code:'ORDER_UNAVAILABLE'}},{file:null},{file:{...historyFile,revision:'replaced'}},
  {file:{...historyFile,assignments:[]}},{file:{...historyFile,assignments:[{platform:'youtube',status:'changed',revision:4}]}},
  {saved:{ok:true,status:'empty'}},{saved:{...historySaved,assignment_revision:7}},
  {saved:{...historySaved,id:'invalid'}},{saved:{...historySaved,preview:{...historySaved.preview,drafts:[{...historyOrder.draft,platform:'tiktok'}]}}}
 ]){
  const p=await historyView({order:cancelledOrder,currentPost:true,...options});
  assert.deepEqual(p.views,[]);assert.equal(p.get('result').hidden,true);assert.equal(p.get('inputFields').disabled,true);
  assert.equal(p.orderOptions.resumeOrder,undefined);assert.ok(p.calls.every(c=>!c.url));
 }
});
test('only a valid order preview links back to the same history order',async()=>{
 const p=await historyView();assert.equal(p.get('back').href,'dashboard.html#auftrag/'+historyOrderId);assert.equal(p.get('back').textContent,'← Zurück zum Auftrag');
 const bad=await historyView({orderId:'invalid'});assert.doesNotMatch(bad.get('back').href||'',/#auftrag/);
 const normal=await boot({portal:'youtube',wide:true});assert.doesNotMatch(normal.get('back').href||'',/#auftrag/);
});
test('unfinished history previews use only reads and reject inconsistent account evidence',async()=>{
 const pending={...historyOrder,state:'preparing',target:null,approval_token:null,preparation_window:{status:'active',expires_at:new Date(Date.now()+60000).toISOString()}};
 const p=await historyView({resume:true,order:pending});
 assert.equal(p.orderOptions.resumeOrder.id,historyOrderId);assert.deepEqual(p.views,['preview']);
 assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
 for(const patch of [{target:{id:'foreign'}},{approved_at:'today'},{approval_token:'token'},{account_check:{}},
     {preparation_window:null},{preparation_window:{status:'active',expires_at:'invalid'}}]){
  const bad=await historyView({resume:true,order:{...pending,...patch}});
  assert.deepEqual(bad.views,[]);assert.equal(bad.orderOptions.resumeOrder,undefined);
 }
});
test('resuming a preparation reads the same order and exact text before opening the dialog',async()=>{
 let reads=0;
 const p=await historyView({resume:true,orderResponse:async()=>({...historyOrder,approval_token:'fixture-'+(++reads)})});
 assert.equal(reads,2);assert.equal(p.orderOptions.resumeOrder.id,historyOrderId);
 assert.equal(p.orderOptions.resumeOrder.approval_token,'fixture-2');
 assert.equal(p.orderOptions.resumeContext.binding.asset_id,historyFile.id);
 assert.deepEqual(p.views,['preview']);
 assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
 const ordinary=await historyView();assert.equal(ordinary.orderOptions.resumeOrder,undefined);
});
test('a concurrently cancelled, approved or changed order cannot resume',async()=>{
 for(const patch of [{state:'cancelled'},{approved_at:new Date().toISOString()},{check_error:'FILE_CHANGED'},
  {binding:{...historyOrder.binding,preview_revision:2}},{draft:{...historyOrder.draft,caption:'Changed'}}]){
  let reads=0;
  const p=await historyView({resume:true,orderResponse:async()=>++reads===1?historyOrder:{...historyOrder,...patch}});
  assert.equal(reads,2);assert.deepEqual(p.views,[]);
  assert.equal(p.orderOptions.resumeOrder,undefined);assert.equal(p.get('status').dataset.error,'true');
  assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
 }
});
test('approval recovery reads only the exact order and discards a result after logout',async()=>{
 let release;
 const p=await boot({portal:'youtube',orderResponse:()=>new Promise(resolve=>{release=resolve;})});
 const before=p.calls.length;
 const pending=p.orderOptions.readStoredOrder(historyOrderId);
 await new Promise(r=>setImmediate(r));
 p.signOut();release(historyOrder);
 await assert.rejects(pending,/melde/);
 assert.deepEqual(JSON.parse(JSON.stringify(p.calls.slice(before))),[{name:'sma_publication_order_v1',p_action:'get',p_input:{id:historyOrderId}}]);
 await assert.rejects(p.orderOptions.readStoredOrder(historyOrderId));assert.equal(p.calls.length,before+1);
});
test('explicit cancellation uses the owner-scoped order RPC and rejects stale sessions',async()=>{
 let release;
 const p=await boot({portal:'youtube',orderResponse:()=>new Promise(resolve=>{release=resolve;})});
 const before=p.calls.length;
 await assert.rejects(p.orderOptions.cancelStoredOrder('invalid'));
 assert.equal(p.calls.length,before);
 const pending=p.orderOptions.cancelStoredOrder(historyOrderId);
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(JSON.parse(JSON.stringify(p.calls.slice(before))),[{name:'sma_publication_order_v1',p_action:'cancel',p_input:{id:historyOrderId}}]);
 p.signOut();release(historyOrder);await assert.rejects(pending,/melde/);
 await assert.rejects(p.orderOptions.cancelStoredOrder(historyOrderId));assert.equal(p.calls.length,before+1);
});
test('history deep link fails safely on stale media, stale text, wrong account and invalid links',async()=>{
 for(const options of [{orderId:'invalid'}, {order:{ok:false,code:'ORDER_UNAVAILABLE'}},{order:{...historyOrder,state:'cancelled'}},
   {order:{...historyOrder,binding:{...historyOrder.binding,platform:'tiktok'}}},{file:null},
   {file:{...historyFile,revision:'new'}},{file:{...historyFile,assignments:[]}},{saved:{...historySaved,id:historyOrderId}},
   {saved:{...historySaved,revision:7}},{saved:{...historySaved,assignment_revision:8}},
   {order:{...historyOrder,draft:{...historyOrder.draft,caption:'Anderer Beitrag'}}}]){
  const p=await historyView(options);assert.deepEqual(p.views,[]);assert.equal(p.get('result').hidden,true);assert.equal(p.orderOptions.previousOrder,undefined);
  assert.equal(p.get('status').dataset.error,'true');assert.equal(p.calls.some(c=>c.url),false);
 }
});
test('history uses the server freshness check regardless of the device clock',async()=>{
 for(const check_error of ['FILE_CHANGED','FILE_REFRESH_REQUIRED',null]){
  let synced=false;
  const p=await historyView({file:{...historyFile,verified_at:staleTime},
   orderResponse:async()=>({...historyOrder,check_error:synced?null:check_error}),
   fetchResponse:async()=>{synced=true;return {ok:true};}});
  assert.deepEqual(p.views,['preview']);
  const syncs=p.calls.filter(c=>c.url).map(c=>new URL(c.url).pathname);
  assert.deepEqual(syncs,check_error?['/webhook/sma-publication-files-v1']:[]);
  assert.equal(p.calls.filter(c=>c.name==='sma_publication_order_v1').length,check_error?2:1);
 }
});
test('history retry reopens the same order after a temporary sync failure and serializes clicks',async()=>{
 let synced=false,release,attempts=0;
 const p=await historyView({orderResponse:async()=>({...historyOrder,check_error:synced?null:'FILE_REFRESH_REQUIRED'}),
  fetchResponse:async()=>{if(++attempts===1)return {ok:false,code:'FILE_SYNC_RUNNING'};
   await new Promise(resolve=>{release=resolve;});synced=true;return {ok:true};}});
 const button=p.get('refreshFiles');
 assert.equal(button.disabled,false);assert.equal(button.textContent,'Vorschau erneut laden');
 assert.deepEqual(p.views,[]);assert.equal(p.get('inputFields').disabled,true);
 const retry=button.click();await new Promise(resolve=>setImmediate(resolve));await button.click();
 assert.equal(button.disabled,true);assert.equal(attempts,2);
 release();await retry;
 assert.deepEqual(p.views,['preview']);assert.equal(button.textContent,'Dateien aktualisieren');
 assert.ok(p.calls.filter(c=>c.name==='sma_publication_order_v1').every(c=>c.p_input.id===historyOrderId));
 assert.equal(p.calls.some(c=>c.p_action&&!['get','list','check'].includes(c.p_action)),false);
});
test('a timed-out folder request leaves the order preview retry available until sign-out',async()=>{
 const p=await historyView({order:{...historyOrder,check_error:'FILE_REFRESH_REQUIRED'},
  fetchResponse:async()=>{throw new DOMException('Timeout','TimeoutError');}});
 assert.equal(p.get('refreshFiles').disabled,false);assert.deepEqual(p.views,[]);
 p.signOut();assert.equal(p.get('refreshFiles').disabled,true);
 await p.get('refreshFiles').click();assert.equal(p.calls.filter(c=>c.url).length,1);
});
test('history refuses an outdated binding even when the folder sync succeeds',async()=>{
 for(const error of ['ORDER_CHANGED','FILE_CHANGED','FILE_REFRESH_REQUIRED']){
  let synced=false;
  const p=await historyView({orderResponse:async()=>({...historyOrder,check_error:synced?error:'FILE_REFRESH_REQUIRED'}),
   fetchResponse:async()=>{synced=true;return {ok:true};}});
  assert.deepEqual(p.views,[]);assert.equal(p.get('result').hidden,true);
  assert.equal(p.get('refreshFiles').disabled,error!=='FILE_REFRESH_REQUIRED');
  assert.equal(p.calls.filter(c=>c.url).length,1);
 }
});

test('YouTube and TikTok display the bound export cover on the post and the player',async()=>{
 const blob=new Blob(['cover'],{type:'image/png'});
 for(const [portal,caption] of [['youtube','Geplantes YouTube-Titelbild'],['tiktok','TikTok-Covervorschau · Bild bei 1 Sek.']]){
  const p=await boot({portal,asset:supportedVideo.id,files:[supportedVideo],coverContext:async()=>({cover:{position_ms:1000},blob})});
  await new Promise(resolve=>setImmediate(resolve));
  const image=p.get('assetPreviewMedia').querySelector('img'),video=p.get('assetPreview').querySelector('video');
  assert.equal(image.alt,caption);assert.equal(p.get('assetPreviewStatus').textContent,caption);
  assert.equal(p.createdUrls[0].blob,blob);assert.equal(video.poster,image.src);assert.equal(p.mediaCalls.length,0);
  p.switchOwner();
  assert.equal(video.poster,undefined);assert.equal(p.get('assetPreviewMedia').children.length,0);
  assert.deepEqual(p.revokedUrls,['blob:preview-0']);
 }
});
test('a failed cover can be retried without showing a different video frame',async()=>{
 let result={unavailable:true};
 const p=await boot({portal:'youtube',asset:ownFile.id,files:[ownFile],coverContext:async()=>result,assetPreviewResponse:async()=>thumbnail});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(p.mediaCalls.length,0);assert.equal(p.get('retryAssetPreview').hidden,false);
 assert.equal(p.get('assetPreviewMedia').children.length,0);
 result=null;
 await p.get('retryAssetPreview').click();
 assert.equal(p.mediaCalls.length,1);assert.equal(p.get('assetPreviewMedia').querySelector('img').alt,'Vorschaubild des ausgewählten Videos');
});
test('clearing a selection discards its pending export cover',async()=>{
 let finish;
 const p=await boot({portal:'tiktok',asset:supportedVideo.id,files:[supportedVideo],coverContext:()=>new Promise(resolve=>{finish=resolve;})});
 await p.get('chooseGeneralTemplate').click();
 finish({cover:{position_ms:500},blob:new Blob(['cover'])});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(p.createdUrls.length,0);assert.equal(p.mediaCalls.length,0);
});

test('the optimizer labels a receipted renamed music version; a lookalike filename stays a video',async()=>{
 const music={...supportedVideo,name:'Fertige-Fassung.mp4',display:{product:'Testlampe',variant:'soundtrack'}};
 const ordinary={...supportedVideo,id:'other-file',name:'Bühne – mit SMA-Musik.mp4'};
 const p=await boot({portal:'youtube',wide:true,files:[music,ordinary]});
 const [first,second]=p.get('filePickerList').children;
 assert.equal(first.querySelector('strong').textContent,'Testlampe');
 assert.match(first.querySelector('small').textContent,/^Video mit SMA-Musik/);
 assert.equal(second.querySelector('strong').textContent,'Bühne – mit SMA-Musik');
 assert.doesNotMatch(second.querySelector('small').textContent,/SMA-Musik/);
});

const productChoices=[
 {product_id:'lamp-a',name:'Testlampe',sku:'LAMPE',purpose:'Die Lampe leuchtet in Grün.'},
 {product_id:'lamp-b',name:'Testlampe',sku:'LAMPE',purpose:'Die Lampe leuchtet in Blau.'}
];
const ambiguousVideo={asset_id:supportedVideo.id,asset_revision:supportedVideo.revision,state:'ambiguous',choices:productChoices};
test('a new video draft uses the explicitly chosen matching shop article and restores the choice on reopening',async()=>{
 const options={portal:'instagram',asset:supportedVideo.id,wide:true,formTracksDom:true,filesRpc:productFiles(ambiguousVideo),
  magicResponse:async()=>({ok:true,analysis:videoAnalysis}),fetchResponse:async()=>instagramResult};
 const p=await boot(options),select=p.get('productChoice');
 assert.equal(p.get('productChoiceField').hidden,false);assert.equal(select.value,'');
 assert.equal(select.children[1].textContent,'Testlampe · LAMPE · lamp-a');
 assert.equal(select.children[2].textContent,'Testlampe · LAMPE · lamp-b');
 await p.get('magicText').click();assert.equal(select.focused,true);assert.equal(p.calls.some(c=>c.url),false);
 select.value='lamp-b';p.get('previewForm').events.input({target:select});
 await p.get('magicText').click();
 const input=JSON.parse(p.calls.find(c=>isCaption(c.url)).options.body);
 const [header,description]=input.source_text.split('\nDateiinhalt: ');
 assert.equal(description,videoAnalysis.result.source_text);
 assert.deepEqual(JSON.parse(header.replace('SMA-Produktauswahl (Kunden-/Katalogdaten): ','')),{Produkt:'Testlampe',Thema:'',Einsatzzweck:productChoices[1].purpose,Artikelnummer:'lamp-b'});
 assert.equal(p.calls.filter(c=>c.p_action==='assign').length,1);
 const reopened=await boot({...options,filesRpc:productFiles(ambiguousVideo,{...instagramResult,input,assignment_revision:1})});
 assert.equal(reopened.get('productChoice').value,'lamp-b');
 assert.equal(reopened.get('source_text').value,description);
 reopened.signOut();assert.equal(reopened.get('productChoiceField').hidden,true);assert.equal(reopened.get('productChoice').children.length,0);
});
test('a choice lost between display and generation requires a new decision',async()=>{
 const p=await boot({portal:'instagram',asset:supportedVideo.id,filesRpc:a=>a.p_action==='product'?
  {ok:true,product_context:{...ambiguousVideo,choices:[productChoices[0]]}}:productFiles(ambiguousVideo)(a)});
 p.get('productChoice').value='lamp-b';await p.run();
 assert.match(p.get('status').textContent,/Artikelauswahl hat sich geändert/);
 assert.equal(p.get('productChoice').value,'');assert.equal(p.calls.some(c=>c.url),false);
});

test('a customer can write a description for an ambiguous video and keep the general shop link',async()=>{
 const p=await boot({portal:'instagram',asset:supportedVideo.id,formTracksDom:true,
  filesRpc:productFiles(ambiguousVideo),fetchResponse:async()=>instagramResult});
 p.get('source_text').value='Zwei Leuchten stehen auf dem Tisch vor der Kamera.';
 p.get('previewForm').events.input({target:p.get('source_text')});await p.run();
 const sent=JSON.parse(p.calls.find(c=>isCaption(c.url)).options.body);
 assert.equal(sent.source_text,p.get('source_text').value);
 assert.equal(p.get('shopLink').href,result.preview.shop_url);
});

test('an unrecognized video can use an explicitly selected shop item and reopen it without a catalogue call',async()=>{
 const item={product_id:'sku_3',name:'Grüne Leuchte',sku:'L-03',purpose:'Beleuchtet eine Arbeitsfläche.'};
 const opts={portal:'instagram',asset:supportedVideo.id,wide:true,formTracksDom:true,
  magicResponse:async()=>({ok:true,analysis:videoAnalysis}),fetchResponse:async()=>instagramResult};
 const files=(saved={ok:true,status:'empty'})=>a=>a.p_action==='catalog_search'?{ok:true,choices:[item],more:false}:productFiles(null,saved)(a);
 const p=await boot({...opts,filesRpc:files()});
 assert.equal(p.get('catalogLookup').hidden,false);assert.ok(!p.calls.some(c=>c.p_action==='catalog_search'));
 p.get('catalogQuery').value='L-03';await p.get('catalogSearch').click();
 assert.equal(p.get('catalogProduct').value,'');p.get('catalogProduct').value='sku_3';
 await p.get('magicText').click();const input=JSON.parse(p.calls.find(c=>isCaption(c.url)).options.body);
 assert.ok(input.source_text.startsWith('SMA-Artikelauswahl aus dem Shop: '));
 assert.ok(input.source_text.includes(item.purpose));assert.ok(input.source_text.endsWith(videoAnalysis.result.source_text));
 assert.ok(p.calls.some(c=>c.p_action==='catalog_search'&&c.p_input.product_id==='sku_3'));
 const reopened=await boot({...opts,filesRpc:files({...instagramResult,input,assignment_revision:1})});
 assert.equal(reopened.get('catalogProduct').value,'sku_3');assert.equal(reopened.get('source_text').value,videoAnalysis.result.source_text);
 assert.ok(!reopened.calls.some(c=>c.p_action==='catalog_search'));
 reopened.signOut();assert.equal(reopened.get('catalogLookup').hidden,true);assert.equal(reopened.get('catalogProduct').children.length,0);
});
test('catalogue search and pagination never select a product, and a late result after sign-out is ignored',async()=>{
 const item={product_id:'art-1',sku:null,name:'Leuchte',purpose:'Eine Leuchte'};
 let release;
 const p=await boot({portal:'youtube',asset:supportedVideo.id,filesRpc:a=>a.p_action==='catalog_search'?
   a.p_input.after?new Promise(r=>release=r):{ok:true,choices:[item],more:true}:productFiles(null)(a)});
 await p.get('catalogSearch').click();assert.equal(p.get('catalogProduct').value,'');
 const pending=p.get('catalogMore').click();p.signOut();release({ok:true,choices:[{...item,product_id:'art-2'}],more:false});await pending;
 assert.equal(p.get('catalogProduct').children.length,0);assert.equal(p.get('catalogLookup').hidden,true);
});
test('a withdrawn manually selected product stops generation, while leaving the picker blank uses the normal flow',async()=>{
 const item={product_id:'art-1',name:'Artikel',sku:null,purpose:'Für den Test.'};
 const p=await boot({portal:'instagram',asset:supportedVideo.id,formTracksDom:true,fetchResponse:async()=>instagramResult,
  filesRpc:a=>a.p_action==='catalog_search'?{ok:true,choices:a.p_input.product_id?[]:[item],more:false}:productFiles(null)(a)});
 p.get('source_text').value='Die Kamera zeigt einen Gegenstand auf einem Tisch.';
 await p.get('catalogSearch').click();p.get('catalogProduct').value='art-1';await p.run();
 assert.match(p.get('status').textContent,/Artikel hat sich geändert/);assert.ok(!p.calls.some(c=>isCaption(c.url)));
 await p.run();assert.equal(JSON.parse(p.calls.find(c=>isCaption(c.url)).options.body).source_text,p.get('source_text').value);
});

test('a staged switch to the shop home page is visible, reversible and saved without generating new text',async()=>{
 const d={...instagramResult.preview.drafts[0],product_id:'art-1'};
 d.caption=d.caption.replace('Zum Shop: ','Zum Produkt: ')+'&produkt=art-1';
 const existing={...instagramResult,assignment_revision:3,preview:{...instagramResult.preview,drafts:[d]}};
 const p=await boot({portal:'instagram',asset:supportedVideo.id,wide:true,filesRpc:a=>a.p_action==='get'?existing:
  a.p_action==='save'?{...instagramResult,assignment_revision:4}:videoFiles(a)});
 const shop=existing.preview.shop_url;
 assert.equal(p.get('draftLinkEditor').hidden,false);
 await p.get('draftLinkShop').click();
 assert.equal(p.get('shopLink').href,shop);assert.equal(p.get('draftLinkUndo').hidden,false);
 const caption=p.get('drafts').children[0].querySelectorAll('div').find(el=>el.className==='caption');
 assert.ok(caption.textContent.endsWith('🛒 Zum Shop: '+shop));
 assert.throws(()=>p.orderOptions.getContext(),/speichere/);
 await p.get('draftLinkUndo').click();assert.equal(p.get('draftLinkValue').href,shop+'&produkt=art-1');
 assert.equal(p.orderOptions.getContext().binding.assignment_revision,3);
 await p.get('draftLinkShop').click();await p.save();
 const call=p.calls.find(c=>c.p_action==='save');assert.equal(call.p_input.link_target,null);
 assert.equal(call.p_input.body,d.body);assert.equal(p.get('shopLink').href,shop);
 assert.equal(p.calls.filter(c=>isCaption(c.url)).length,0);
});
test('editing a saved link uses the current catalogue choice and retains unsaved text on rejection',async()=>{
 const item={product_id:'new-id',name:'Neue Lampe',sku:'AL-3',purpose:'Licht am Arbeitsplatz.'};
 const original={...instagramResult,assignment_revision:2,link_product:null};
 const p=await boot({portal:'instagram',asset:supportedVideo.id,wide:true,
  filesRpc:a=>a.p_action==='catalog_search'?{ok:true,choices:[item],more:false}:a.p_action==='save'?
    {ok:false,code:'PRODUCT_SELECTION_CHANGED'}:productFiles(null,original)(a)});
 await p.get('draftLinkProduct').click();assert.equal(p.get('catalogLookup').open,true);
 await p.get('catalogSearch').click();
 p.get('catalogProduct').value=item.product_id;await p.get('catalogProduct').events.change();
 assert.equal(p.get('shopLink').href,result.preview.shop_url+'&produkt=new-id');
 const body=p.get('drafts').children[0].querySelector('textarea');body.value='Meine überarbeitete Beschreibung der Lampe.';
 p.get('drafts').children[0].events.input();await p.save();
 const target=p.calls.find(c=>c.p_action==='save').p_input.link_target;
 assert.deepEqual(JSON.parse(JSON.stringify(target)),{product_id:'new-id',name:item.name,purpose:item.purpose,source:'catalog'});
 assert.equal(body.value,'Meine überarbeitete Beschreibung der Lampe.');assert.equal(p.get('draftLinkUndo').hidden,false);
 await p.get('draftLinkUndo').click();assert.equal(p.get('shopLink').href,result.preview.shop_url);
 assert.throws(()=>p.orderOptions.getContext(),/speichere/);
 assert.equal(p.calls.some(c=>isCaption(c.url)),false);
});

test('an unavailable saved product opens the link editor; staging, undo and saving update the warning and href',async()=>{
 const d={...instagramResult.preview.drafts[0],product_id:'art-1'};
 d.caption=d.caption.replace('Zum Shop: ','Zum Produkt: ')+'&produkt=art-1';
 const existing={...instagramResult,assignment_revision:2,product_link_available:false,preview:{...result.preview,drafts:[d]}};
 const p=await boot({portal:'instagram',asset:supportedVideo.id,wide:true,filesRpc:a=>a.p_action==='get'?existing:
   a.p_action==='save'?{...instagramResult,assignment_revision:3,product_link_available:null}:videoFiles(a)});
 assert.equal(p.get('draftLinkEditor').open,true);assert.equal(p.get('draftLinkIssue').hidden,false);
 for(const id of ['draftLinkValue','shopLink']){assert.equal(p.get(id).href,undefined);assert.ok(p.get(id).textContent.endsWith('&produkt=art-1'));}
 await p.get('draftLinkShop').click();assert.equal(p.get('draftLinkIssue').hidden,true);assert.equal(p.get('shopLink').href,result.preview.shop_url);
 await p.get('draftLinkUndo').click();assert.equal(p.get('draftLinkIssue').hidden,false);assert.equal(p.get('shopLink').href,undefined);
 await p.get('draftLinkShop').click();await p.save();assert.equal(p.get('draftLinkIssue').hidden,true);assert.equal(p.get('draftLinkEditor').open,false);
 assert.equal(p.calls.filter(c=>c.url).length,0);
});
test('a product that disappears after opening is detected on a scoped re-read; stale and failed reads cannot authorize a target check',async()=>{
 const d={...instagramResult.preview.drafts[0],product_id:'art-1'};
 let response={...instagramResult,assignment_revision:2,product_link_available:true,preview:{...result.preview,drafts:[d]}};
 const p=await boot({portal:'instagram',asset:supportedVideo.id,wide:true,filesRpc:a=>a.p_action==='get'?response:videoFiles(a)});
 const options=p.orderOptions,context=options.getContext();
 assert.equal(context.productId,'art-1');assert.equal(context.binding.productId,undefined);
 response={...response,product_link_available:false};
 await assert.rejects(options.verifyProductLink(context),{code:'PRODUCT_LINK_UNAVAILABLE'});
 assert.equal(p.get('draftLinkIssue').hidden,false);assert.equal(p.get('shopLink').href,undefined);
 options.onUnavailableLink();assert.equal(p.views.at(-1),'source');assert.equal(p.get('draftLinkEditor').open,true);
 response={...response,product_link_available:true};await options.verifyProductLink(context);
 assert.equal(p.get('draftLinkIssue').hidden,true);assert.ok(p.get('shopLink').href.endsWith('&produkt=art-1'));
 response={...response,product_link_available:null};await assert.rejects(options.verifyProductLink(context),/Produktlink gerade nicht prüfen/);
 response={...response,assignment_revision:3,product_link_available:true};await assert.rejects(options.verifyProductLink(context),{code:'ASSIGNMENT_CHANGED'});
 assert.equal(p.calls.filter(c=>c.url).length,0);
});
test('history with a withdrawn product opens only the verified saved draft for correction, including a resume link',async()=>{
 const d={...historyOrder.draft,product_id:'art-1',caption:historyOrder.draft.caption.replace('Zum Shop: ','Zum Produkt: ')+'&produkt=art-1'};
 const saved={...historySaved,product_link_available:false,preview:{...historySaved.preview,drafts:[d]}};
 const order={...historyOrder,draft:d,check_error:'ASSIGNMENT_CHANGED'};
 for(const resume of [false,true]){
  const p=await historyView({saved,order,resume});assert.deepEqual(p.views,['source']);assert.equal(p.orderOptions.resumeOrder,undefined);
  assert.equal(p.get('draftLinkIssue').hidden,false);assert.equal(p.get('draftLinkProduct').focused,true);
  assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
 }
 for(const invalid of [{...saved,product_link_available:true},{...saved,assignment_revision:5},
    {...saved,preview:{...saved.preview,drafts:[{...d,title:'Anderer Stand'}]}}]){
  const p=await historyView({saved:invalid,order,resume:true});assert.deepEqual(p.views,[]);assert.equal(p.get('result').hidden,true);
 }
});

function sharedDraft(portal){
 const file={...supportedVideo};
 let draft={...result.preview.drafts[0],platform:portal,product_id:'alter-artikel'},revision=1,assign=4,previewId=historySaved.id;
 const writes=[];
 const view=()=>({ok:true,status:'completed',id:previewId,revision,assignment_revision:assign,product_link_available:!!draft.product_id,
  preview:{...result.preview,drafts:[structuredClone(draft)]}});
 function change(patch){draft={...draft,...patch};revision++;assign++;}
 async function rpc({p_action,p_input}){
  if(p_action==='list')return {ok:true,files:[{...file,assignments:[{platform:portal,revision:assign,status:'assigned'}]}]};
  if(p_action==='get')return view();
  if(p_action==='save'){
   if(p_input.assignment_revision!==assign)return {ok:false,code:'ASSIGNMENT_CONFLICT'};
   writes.push(p_input);const {title,body,hashtags}=p_input;change({title,body,hashtags});
   if(Object.hasOwn(p_input,'link_target')){
    if(p_input.link_target)draft.product_id=p_input.link_target.product_id;else delete draft.product_id;
   }
   return view();
  }
  return {ok:true};
 }
 return {open:(filesRpc=rpc,options={})=>boot({portal,asset:file.id,wide:true,filesRpc,...options}),rpc,writes,change,view,
  replaceFile(){file.revision='replaced';},replacePreview(){previewId=historyOrderId;}};
}
function editPortalField(p,key,value){
 const card=p.get('drafts').children[0];card.querySelector('[data-field='+key+']').value=value;card.events.input();
}
const compareTick=()=>new Promise(resolve=>setImmediate(resolve));
test('two editors combine independent changes on the latest revision only after explicit save',async()=>{
 for(const platform of ['youtube','tiktok']){
  const f=sharedDraft(platform),a=await f.open(),b=await f.open();
  editPortalField(a,'title','Vom ersten Tab');await a.save();
  editPortalField(b,'body','Ein anderer Beitragstext aus Tab zwei.');
  await b.get('draftLinkShop').click();await b.save();
  assert.equal(f.writes.length,1);assert.equal(b.get('compareDraft').hidden,false);
  const comparing=b.get('compareDraft').click();await compareTick();
  assert.equal(b.get('draftConflictDialog').open,true);assert.equal(b.get('draftConflictApply').disabled,false);
  await b.get('draftConflictApply').click();await comparing;
  const card=b.get('drafts').children[0];
  assert.equal(card.querySelector('input').value,'Vom ersten Tab');assert.match(card.querySelector('textarea').value,/Tab zwei/);
  assert.equal(f.writes.length,1);assert.throws(()=>b.orderOptions.getContext(),/speichere/);
  await b.save();assert.equal(f.writes.length,2);assert.equal(f.writes[1].assignment_revision,5);assert.equal(f.writes[1].link_target,null);
  assert.equal(f.view().preview.drafts[0].title,'Vom ersten Tab');assert.equal(b.get('compareDraft').hidden,true);
 }
});
test('conflicting text, tags and product require individual choices and Back keeps local edits',async()=>{
 const f=sharedDraft('youtube'),p=await f.open();
 editPortalField(p,'body','Text aus diesem Tab zum Vergleichen.');editPortalField(p,'hashtags','');
 await p.get('draftLinkShop').click();
 f.change({body:'Gespeicherte Fassung aus dem anderen Tab.',hashtags:['Dort'],product_id:'anderer-artikel'});
 await p.save();const first=p.get('compareDraft').click();await compareTick();
 await p.get('draftConflictBack').click();await first;
 assert.equal(p.get('drafts').querySelector('textarea').value,'Text aus diesem Tab zum Vergleichen.');
 assert.equal(p.get('shopLink').href,result.preview.shop_url);assert.equal(f.writes.length,0);
 const second=p.get('compareDraft').click();await compareTick();
 const fields=p.get('draftConflictFields');assert.equal(p.get('draftConflictApply').disabled,true);
 await p.get('draftConflictApply').click();assert.equal(p.get('draftConflictDialog').open,true);
 for(const group of fields.children){
  const radios=group.querySelectorAll('input');if(!radios.length)continue;
  const selected=radios[0].name.endsWith('hashtags')?radios[0]:radios[1];selected.checked=true;selected.events.change();
 }
 assert.equal(p.get('draftConflictApply').disabled,false);
 await p.get('draftConflictApply').click();await second;
 assert.equal(p.get('drafts').querySelector('textarea').value,'Gespeicherte Fassung aus dem anderen Tab.');
 assert.match(p.get('shopLink').href,/anderer-artikel/);
 await p.save();assert.equal(f.writes[0].hashtags.length,0);assert.equal(Object.hasOwn(f.writes[0],'link_target'),false);
});
test('a later concurrent save requires another comparison and replacing the file or draft blocks adoption',async()=>{
 const f=sharedDraft('tiktok'),p=await f.open();
 editPortalField(p,'body','Meine lokalen Änderungen am Beitrag.');
 f.change({title:'Erster externer Titel'});await p.save();
 const compare=p.get('compareDraft').click();await compareTick();f.change({title:'Zweiter externer Titel'});
 await p.get('draftConflictApply').click();await compare;await p.save();assert.equal(p.get('compareDraft').hidden,false);assert.equal(f.writes.length,0);
 for(const method of ['replaceFile','replacePreview']){
  const changed=sharedDraft('youtube'),tab=await changed.open();
  editPortalField(tab,'body','Lokal erhaltener Text für die ursprüngliche Datei.');
  changed.change({title:'Eine Änderung'});await tab.save();changed[method]();await tab.get('compareDraft').click();
  assert.ok(!tab.get('draftConflictDialog').open);assert.match(tab.get('drafts').querySelector('textarea').value,/Lokal erhaltener/);assert.equal(changed.writes.length,0);
 }
});
test('account change closes the comparison and clears both versions',async()=>{
 const f=sharedDraft('youtube'),p=await f.open();
 editPortalField(p,'body','Privater lokaler Testtext zum Vergleichen.');f.change({body:'Gespeicherter privater Testtext.'});
 await p.save();const compare=p.get('compareDraft').click();await compareTick();
 assert.equal(p.get('draftConflictDialog').open,true);
 p.switchOwner();await compare;assert.equal(p.get('draftConflictDialog').open,false);assert.equal(p.get('draftConflictFields').children.length,0);
 assert.equal(p.get('result').hidden,true);assert.equal(p.get('compareDraft').hidden,true);assert.equal(f.writes.length,0);
});

test('lost and malformed save replies confirm a committed portal draft by reading only',async()=>{
 for(const [portal,loss] of [['youtube','transport'],['tiktok','empty'],['youtube','wrong-fields']]){
  const f=sharedDraft(portal);const p=await f.open(async req=>{
   const reply=await f.rpc(req);
   if(req.p_action!=='save')return reply;
   if(loss==='transport')throw new Error('Network connection lost');
   if(loss==='empty')return null;
   reply.preview.drafts[0].body='Ein anderer Beitragstext.';return reply;
  });
  editPortalField(p,'body','Ein gespeicherter Beitrag nach Netzunterbrechung.');
  editPortalField(p,'hashtags','#Neu');await p.get('draftLinkShop').click();
  const before=p.calls.length;await p.save();
  assert.deepEqual(p.calls.slice(before).map(c=>c.p_action),['save','get','list']);assert.equal(f.writes.length,1);
  assert.match(p.get('status').textContent,/Fassung im Formular ist.*gespeichert/);assert.equal(p.get('checkDraftSave').hidden,true);
  assert.equal(p.orderOptions.getContext().binding.assignment_revision,5);assert.equal(p.get('shopLink').href,result.preview.shop_url);
 }
});
test('a lost uncommitted request preserves the form and retries only after clicking save again',async()=>{
 const f=sharedDraft('tiktok');let dropped=true;
 const p=await f.open(req=>{if(req.p_action==='save'&&dropped){dropped=false;throw new Error('Offline');}return f.rpc(req);});
 editPortalField(p,'body','Noch nicht gespeicherter lokaler Text.');
 await p.save();assert.match(p.get('saveStatus').textContent,/erneut speichern/);assert.equal(f.writes.length,0);
 assert.match(p.get('drafts').querySelector('textarea').value,/lokaler Text/);assert.equal(p.get('save').hidden,false);
 await p.save();assert.equal(f.writes.length,1);assert.equal(f.writes[0].assignment_revision,4);
});
test('an unavailable receipt enables only status reads; newer input survives a later confirmation',async()=>{
 const f=sharedDraft('youtube');let offline=false;
 const p=await f.open(async req=>{
  if(req.p_action==='get'&&offline)throw Error('offline');
  const reply=await f.rpc(req);
  if(req.p_action==='save'){offline=true;throw Error('lost');}
  return reply;
 });
 editPortalField(p,'body','Mein abgesendeter Entwurf in diesem Tab.');await p.save();
 assert.equal(p.get('save').hidden,true);assert.equal(p.get('checkDraftSave').hidden,false);assert.match(p.get('saveStatus').textContent,/unklar/);
 assert.throws(()=>p.orderOptions.getContext(),/speichere/);
 const start=p.calls.length;await p.get('checkDraftSave').click();await p.save();
 assert.deepEqual(p.calls.slice(start).map(c=>c.p_action),['get']);
 editPortalField(p,'body','Weitere lokale Eingabe nach dem ersten Speichern.');offline=false;
 await p.get('checkDraftSave').click();assert.equal(f.writes.length,1);assert.equal(p.get('compareDraft').hidden,true);
 assert.match(p.get('saveStatus').textContent,/gesendete Fassung ist gespeichert/);
 assert.match(p.get('drafts').querySelector('textarea').value,/Weitere lokale Eingabe/);
 await p.save();assert.equal(f.writes.length,2);assert.equal(f.writes[1].assignment_revision,5);
});
test('a different saved field or link never confirms the sent version',async()=>{
 for(const patch of [{title:'Neuer Titel'},{body:'Ein weiterer bearbeiteter Text.'},{hashtags:['Andere']},{product_id:'anderer-artikel'}]){
  const f=sharedDraft('tiktok');const p=await f.open(async req=>{
   const reply=await f.rpc(req);if(req.p_action==='save'){f.change(patch);throw Error('lost');}return reply;
  });
  editPortalField(p,'body','Meine lokale Beschreibung zum Vergleichen.');await p.save();
  assert.equal(f.writes.length,1);assert.equal(p.get('compareDraft').hidden,false);assert.match(p.get('saveStatus').textContent,/andere Fassung/);
  assert.match(p.get('drafts').querySelector('textarea').value,/Meine lokale Beschreibung/);
 }
});
test('file replacement and a different draft never supply a receipt; logout discards a late read',async()=>{
 for(const replace of ['replaceFile','replacePreview']){
  const f=sharedDraft('youtube');const p=await f.open(async req=>{
   const reply=await f.rpc(req);if(req.p_action==='save'){f[replace]();throw Error('lost');}return reply;
  });
  editPortalField(p,'body','Text für die ursprüngliche Datei.');await p.save();
  assert.equal(f.writes.length,1);assert.equal(p.get('checkDraftSave').hidden,false);assert.match(p.get('saveStatus').textContent,/nicht mehr zugeordnet/);
  assert.equal(p.get('compareDraft').hidden,true);
 }
 let release,reading=false;const f=sharedDraft('youtube');const p=await f.open(async req=>{
  if(req.p_action==='get'&&reading)return new Promise(r=>{release=r;});
  const reply=await f.rpc(req);if(req.p_action==='save'){reading=true;throw Error('lost');}return reply;
 });
 editPortalField(p,'body','Privater Text für den alten Zugriff.');const done=p.save();await compareTick();p.signOut();release(f.view());await done;
 assert.equal(p.get('checkDraftSave').hidden,true);assert.equal(p.get('result').hidden,true);assert.match(p.get('status').textContent,/melde/);
 assert.equal(f.writes.length,1);
});

test('a no-op receipt may keep its revision; a definitive save rejection does not start a receipt read',async()=>{
 const f=sharedDraft('youtube');let reject=false;
 const p=await f.open(req=>{
  if(req.p_action!=='save')return f.rpc(req);
  if(reject)return {ok:false,code:'INVALID_EDIT'};
  throw new Error('no reply for identical draft');
 });
 await p.save();assert.match(p.get('status').textContent,/Fassung im Formular ist.*gespeichert/);
 assert.equal(p.orderOptions.getContext().binding.assignment_revision,4);
 editPortalField(p,'body','Text mit ungültigem Testinhalt.');reject=true;
 const before=p.calls.length;await p.save();assert.deepEqual(p.calls.slice(before).map(c=>c.p_action),['save']);
 assert.equal(p.get('checkDraftSave').hidden,true);assert.equal(f.writes.length,0);
});
test('a timed-out save that reaches the database after the read cannot create a second revision',async()=>{
 const f=sharedDraft('tiktok');let delayed;
 const p=await f.open(req=>{
  if(req.p_action==='save'&&!delayed){delayed=req;throw Error('timeout');}
  return f.rpc(req);
 });
 editPortalField(p,'body','Eine verspätet gespeicherte Fassung.');await p.save();
 assert.equal(f.writes.length,0);assert.match(p.get('saveStatus').textContent,/erneut speichern/);
 await f.rpc(delayed);await p.save();assert.equal(f.writes.length,1);assert.equal(p.get('compareDraft').hidden,false);
});

function tabStorage(){
 const rows=new Map();
 return {rows,getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k)};
}
function interruptedDraft(portal,commit,extra={}){
 const f=sharedDraft(portal),sessionStorage=tabStorage();
 const options={sessionStorage,...extra};
 let offline=false;
 const first=()=>f.open(async req=>{
  if(offline&&req.p_action==='get')throw Error('Offline');
  if(req.p_action!=='save')return f.rpc(req);
  if(commit)await f.rpc(req);offline=true;throw Error('Lost reply');
 },options);
 return {...f,sessionStorage,first,reload:(rpc=f.rpc)=>f.open(rpc,options)};
}
test('reloading an interrupted save restores the correct file and waits for an explicit save',async()=>{
 for(const portal of ['youtube','tiktok']){
  const f=interruptedDraft(portal,false),old=await f.first();
  editPortalField(old,'body','Text aus einem unterbrochenen Speicherversuch.');await old.get('draftLinkShop').click();await old.save();
  assert.equal(f.sessionStorage.rows.size,1);
  const stored=[...f.sessionStorage.rows.values()][0];assert.doesNotMatch(stored,/private-session-token|access_token|approval_token|source_text/);
  const p=await f.reload();assert.equal(f.writes.length,0);assert.deepEqual(p.views,['text']);
  assert.match(p.get('drafts').querySelector('textarea').value,/unterbrochenen/);assert.equal(p.get('shopLink').href,result.preview.shop_url);
  assert.throws(()=>p.orderOptions.getContext(),/speichere/);assert.equal(p.orderOptions.resumeOrder,undefined);
  assert.ok(p.calls.every(c=>!c.url&&['get','list','check'].includes(c.p_action)));
  await p.save();assert.equal(f.writes.length,1);assert.equal(f.writes[0].assignment_revision,4);assert.equal(f.writes[0].link_target,null);
  assert.equal(f.sessionStorage.rows.size,0);
 }
});
test('a committed save is confirmed after reload without a second write; later raw input is preserved',async()=>{
 for(const more of [false,true]){
  const f=interruptedDraft('youtube',true),old=await f.first();
  editPortalField(old,'body','Meine bereits gespeicherte Fassung.');await old.save();
  if(more)editPortalField(old,'hashtags','#Neu #Noch-offen');
  const p=await f.reload();assert.equal(f.writes.length,1);
  if(more){
   assert.equal(p.get('drafts').querySelector('[data-field=hashtags]').value,'#Neu #Noch-offen');
   assert.equal(p.get('compareDraft').hidden,true);assert.match(p.get('saveStatus').textContent,/wiederhergestellt/);
  }else{
   assert.match(p.get('status').textContent,/aus diesem Tab.*gespeichert/);
   assert.equal(p.orderOptions.getContext().binding.assignment_revision,5);assert.equal(f.sessionStorage.rows.size,0);
  }
 }
});
test('a newer concurrent draft requires comparison before restored input can be saved',async()=>{
 const f=interruptedDraft('tiktok',false),old=await f.first();
 editPortalField(old,'body','Eigene Eingabe aus dem früheren Tabstand.');await old.save();f.change({title:'Titel aus dem zweiten Tab'});
 const p=await f.reload();assert.equal(p.get('compareDraft').hidden,false);assert.equal(p.get('save').disabled,true);
 await p.save();assert.equal(f.writes.length,0);
 const compare=p.get('compareDraft').click();await compareTick();await p.get('draftConflictBack').click();await compare;
 assert.equal(p.get('save').disabled,true);assert.match(p.get('drafts').querySelector('textarea').value,/Eigene Eingabe/);
 const choose=p.get('compareDraft').click();await compareTick();await p.get('draftConflictApply').click();await choose;
 assert.equal(p.get('drafts').querySelector('input').value,'Titel aus dem zweiten Tab');
 assert.match(p.get('drafts').querySelector('textarea').value,/Eigene Eingabe/);assert.equal(p.get('save').disabled,false);
 await p.save();assert.equal(f.writes[0].assignment_revision,5);
});
test('failed recovery reads can be retried; replaced files, different drafts and logout do not restore cached inputs',async()=>{
 for(const variant of ['retry','file','draft','logout']){
  const f=interruptedDraft('youtube',false),old=await f.first();
  editPortalField(old,'body','Lokaler Testtext nur für die ursprüngliche Zuordnung.');await old.save();
  if(variant==='file')f.replaceFile();if(variant==='draft')f.replacePreview();if(variant==='logout')old.signOut();
  let fail=variant==='retry';
  const p=await f.reload(req=>{if(fail&&req.p_action==='get')throw Error('offline');return f.rpc(req);});
  if(variant==='retry'){
   assert.equal(f.sessionStorage.rows.size,1);fail=false;await p.get('refreshFiles').click();
   assert.match(p.get('drafts').querySelector('textarea').value,/Lokaler Testtext/);
  }else{
   assert.doesNotMatch(p.get('drafts').querySelector('textarea')?.value||'',/Lokaler Testtext/);
   assert.equal(f.sessionStorage.rows.size,0);
  }
  assert.equal(f.writes.length,0);
 }
});
test('a save already in flight survives reload and its late completion cannot clear the restored form',async()=>{
 const store=tabStorage(),opts={sessionStorage:store,newUuid:require('node:crypto').randomUUID};
 const f=sharedDraft('youtube');let release;
 const old=await f.open(req=>req.p_action==='save'?new Promise(resolve=>{release=async()=>resolve(await f.rpc(req));}):f.rpc(req),opts);
 editPortalField(old,'body','Zwischengesicherte Fassung während der Antwort.');const writing=old.save();await compareTick();
 assert.equal(store.rows.size,1);
 const p=await f.open(f.rpc,opts);assert.match(p.get('drafts').querySelector('textarea').value,/Zwischengesicherte/);
 await release();await writing;assert.equal(f.writes.length,1);assert.equal(store.rows.size,1);
 const again=await f.open(f.rpc,opts);assert.match(again.get('status').textContent,/aus diesem Tab.*gespeichert/);assert.equal(store.rows.size,0);
});
test('history recovery checks the original order and restores the latest assigned draft without resuming or writing',async()=>{
 const f=interruptedDraft('tiktok',false,{orderId:historyOrderId,currentPost:true,
  orderResponse:{...cancelledOrder,binding:{...cancelledOrder.binding,platform:'tiktok',asset_revision:supportedVideo.revision}}});
 const old=await f.first();editPortalField(old,'body','Änderungen am heutigen TikTok-Text.');await old.save();
 const p=await f.reload();
 assert.match(p.get('drafts').querySelector('textarea').value,/heutigen TikTok/);assert.equal(p.orderOptions.resumeOrder,undefined);
 assert.equal(p.get('back').href,'dashboard.html#auftrag/'+historyOrderId);
 assert.deepEqual(p.calls.filter(c=>c.name==='sma_publication_order_v1').map(c=>c.p_action),['get']);assert.equal(f.writes.length,0);
});
test('a different account or route cannot restore a prior form and disabled session storage permits normal saving',async()=>{
 for(const other of [{ownerId:'another-owner'},{asset:'another-file'}]){
  const f=interruptedDraft('youtube',false),old=await f.first();
  editPortalField(old,'body','Eigenes lokales Formular nur für diesen Einstieg.');await old.save();
  const p=await f.open(f.rpc,{sessionStorage:f.sessionStorage,...other});
  assert.doesNotMatch(p.get('drafts').querySelector('textarea')?.value||'',/Eigenes lokales/);
  if(other.ownerId)assert.equal(f.sessionStorage.rows.size,0);
 }
 const storage=tabStorage();storage.setItem=()=>{throw Error('quota exceeded');};
 const f=sharedDraft('tiktok'),p=await f.open(f.rpc,{sessionStorage:storage});
 editPortalField(p,'body','Speichern bei gesperrtem Sitzungszugriff.');await p.save();assert.equal(f.writes.length,1);
});
