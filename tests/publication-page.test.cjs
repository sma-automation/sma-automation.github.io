const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const source=fs.readFileSync('app/assets/publication-preview.js','utf8').replace(/^import .*;$/gm,'');
class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.events={};this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.classList={add(){}};}setAttribute(k,v){this[k]=v}removeAttribute(k){delete this[k]}pause(){this.paused=true}load(){this.loaded=true}showModal(){this.open=true}close(){this.open=false;this.events.close?.()}click(){this.clicked=true;return this.events.click?.()}focus(){this.focused=true}scrollIntoView(){this.scrolledIntoView=true}append(...els){this.children.push(...els)}replaceChildren(...els){this.children=els}addEventListener(k,f){this.events[k]=f}querySelectorAll(sel){const all=this.children.flatMap(c=>[c,...c.querySelectorAll('*')]);return all.filter(c=>sel==='*'||(sel==='input,textarea'&&['input','textarea'].includes(c.tag))||(sel==='textarea'&&c.tag==='textarea')||sel===c.tag||sel==='[data-field='+c.dataset.field+']')}querySelector(sel){return this.querySelectorAll(sel)[0]}}
const thumbnailSource=fs.readFileSync('app/assets/asset-thumbnail.mjs','utf8').split('// One owner-scoped')[0].replace('const endpoint=','const thumbnailEndpoint=').replace('request(endpoint,','request(thumbnailEndpoint,').replace('export async function','async function');
const result={ok:true,status:'completed',id:'own-id',revision:1,preview:{can_publish:false,language:'de',shop_url:'https://sma-automation.com/app/shop.html?shop=sma-testkunde',drafts:[{platform:'youtube',title:'Testtitel',body:'Ein sachlicher Testtext.',hashtags:['Test'],caption:'Ein sachlicher Testtext.\n\n#Test\n\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=sma-testkunde',review_notes:[]}]}};
async function boot({portal=null,asset=null,files=[],filesRpc=null,magicResponse=async()=>({ok:false}),assetPreviewResponse=async()=>({ok:false}),signedIn=true,formTracksDom=false,latest={ok:true,status:'empty'},fetchResponse=async()=>result,saveResponse=result,timer=setTimeout}={}){const els=new Map();const get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id)};get('media_kind').value='video';get('result').hidden=true;const checks=['youtube','instagram','facebook','tiktok'].map(p=>Object.assign(new Element('input'),{value:p,checked:p==='youtube'}));const calls=[],mediaCalls=[],createdUrls=[],revokedUrls=[];let authChange;const win={addEventListener(){}};win.parent=win;
 const client={auth:{getSession:async()=>({data:{session:signedIn?{access_token:'private-session-token'}:null}}),onAuthStateChange(fn){authChange=fn;}},rpc:async(name,args)=>{calls.push({name,...args});return {data:['sma_publication_magic_v1','sma_publication_video_magic_v1'].includes(name)?await magicResponse(args):name==='sma_publication_files_v1'?(filesRpc?await filesRpc(args):{ok:true,files}):args.p_action==='latest'?latest:saveResponse}}};
 const values={source_text:'Dies ist eine sachliche Beschreibung des SMA Testartikels.',audience:'Testkunden',goal:'Shop kennenlernen',media_kind:'video',language:'de'};
 if(!formTracksDom)for(const [key,value] of Object.entries(values))get(key).value=value;
 class Data{get(k){return formTracksDom?get(k).value:values[k]}getAll(){return checks.filter(c=>c.checked).map(c=>c.value)}}
 await vm.runInNewContext('(async()=>{'+thumbnailSource+source+'})()',{createMediaThumbnailLoader:()=>({observe(){},reset(){},clear(){}}),createClient:()=>client,document:{getElementById:get,createElement:t=>new Element(t),querySelectorAll:()=>checks,querySelector:sel=>sel==='h1'?get('title'):checks[0],body:new Element()},window:win,location:{search:portal?'?embedded=1&portal='+portal+(asset?'&asset='+asset:''):'',origin:'https://sma-automation.com'},URLSearchParams,Blob,atob,URL:{createObjectURL(blob){const url='blob:preview-'+createdUrls.length;createdUrls.push({blob,url});return url;},revokeObjectURL(url){revokedUrls.push(url);}},FormData:Data,crypto:{randomUUID:()=> '12345678-1234-4123-8123-123456789abc'},AbortSignal,AbortController,deviceFileMetadata:(f,p)=>{if(!f.size)throw Error("UPLOAD_SIZE");return {name:f.name,mime_type:f.type,size_bytes:f.size}},transferDeviceFile:async({onProgress,file})=>onProgress(file.size,file.size),fetch:async(url,options)=>{if(url.endsWith('/sma-publication-asset-preview-v1')){mediaCalls.push({url,options});return {ok:true,json:()=>assetPreviewResponse(url,options)};}calls.push({url,options});return {ok:true,json:()=>fetchResponse(url,options)}},setTimeout:timer,console});
 return {get,calls,mediaCalls,createdUrls,revokedUrls,checks,run:()=>get('previewForm').events.submit({preventDefault(){}}),save:()=>get('save').events.click(),signOut:()=>authChange('SIGNED_OUT')};}
test('signed-out users cannot generate or display saved customer data',async()=>{const p=await boot({signedIn:false});assert.equal(p.calls.length,0);assert.equal(p.get('inputFields').disabled,true);assert.equal(p.get('result').hidden,true);assert.match(p.get('status').textContent,/melde dich/);});
test('one generation for concurrent clicks; body contains no tenant or shop override',async()=>{let release;const p=await boot({fetchResponse:()=>new Promise(r=>release=r)});const first=p.run();await Promise.resolve();await p.run();await new Promise(r=>setImmediate(r));assert.equal(p.calls.filter(c=>c.url).length,1);assert.equal(p.get('inputFields').disabled,true);release(result);await first;assert.equal(p.get('result').hidden,false);const request=JSON.parse(p.calls.find(c=>c.url).options.body);assert.equal(request.request_id,'12345678-1234-4123-8123-123456789abc');assert.ok(!('shop_url' in request));assert.ok(!('customer_id' in request));assert.equal(p.get('inputFields').disabled,false);});
test('saved edits retain server revision, sign-out hides content',async()=>{const p=await boot({latest:result,saveResponse:{...result,revision:2}});const body=p.get('drafts').children[0].querySelector('textarea');body.value='Ein korrigierter sachlicher Testtext.';await p.save();const call=p.calls.find(c=>c.p_action==='save');assert.equal(call.p_id,'own-id');assert.equal(call.p_input.revision,1);assert.equal(call.p_input.drafts[0].body,body.value);assert.ok(!('caption' in call.p_input.drafts[0]));p.signOut();assert.equal(p.get('result').hidden,true);assert.equal(p.get('inputFields').disabled,true);});
test('save conflicts preserve user edits and show recovery guidance',async()=>{const p=await boot({latest:result,saveResponse:{ok:false,code:'REVISION_CONFLICT'}});const body=p.get('drafts').children[0].querySelector('textarea');body.value='Meine noch nicht gespeicherten Angaben.';await p.save();assert.equal(body.value,'Meine noch nicht gespeicherten Angaben.');assert.match(p.get('status').textContent,/zwischenzeitlich/);assert.match(p.get('saveStatus').textContent,/nicht gespeichert/);});
test('per-portal editor loads only its scope and keeps other saved portal texts unchanged',async()=>{const other={...result.preview.drafts[0],platform:'tiktok',title:'TikTok Ausgangstitel',body:'Unveränderter TikTok Ausgangstext.'};const combined={...result,preview:{...result.preview,drafts:[result.preview.drafts[0],other]}};const p=await boot({portal:'youtube',latest:combined,saveResponse:{...combined,revision:2}});assert.equal(p.calls.find(c=>c.p_action==='latest').p_input.platform,'youtube');assert.equal(p.get('drafts').children.length,1);assert.equal(p.get('drafts').children[0].dataset.platform,'youtube');assert.equal(p.get('sourcePanel').open,false);assert.equal(p.get('portalSelection').hidden,true);p.get('drafts').children[0].querySelector('textarea').value='Bearbeiteter YouTube-Text ohne neue Produktbehauptungen.';await p.save();const saved=p.calls.find(c=>c.p_action==='save').p_input.drafts;assert.equal(saved.length,2);assert.equal(saved[1].title,other.title);assert.equal(saved[1].body,other.body);});
test('generation from a portal card requests exactly that portal',async()=>{for(const portal of ['youtube','instagram','facebook','tiktok']){const p=await boot({portal,fetchResponse:async()=>({...result,preview:{...result.preview,drafts:[{...result.preview.drafts[0],platform:portal}]}})});await p.run();const request=JSON.parse(p.calls.find(c=>c.url).options.body);assert.deepEqual(request.platforms,[portal]);if(portal==='youtube')assert.equal(request.media_kind,'video');assert.equal(p.get('drafts').children.length,1);assert.equal(p.get('drafts').children[0].dataset.platform,portal);}});

const ownFile={id:'fa110000-0000-4000-8000-000000000001',name:'Meine Datei A.mp4',media_kind:'video',revision:'version:1',verified_at:new Date().toISOString(),assignments:[]};
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
const videoAnalysis={...magicAnalysis,asset_id:supportedVideo.id,asset_revision:supportedVideo.revision,policy_version:'magic-video-2026-11-02.1',result:{...magicAnalysis.result,policy_version:'magic-video-2026-11-02.1',description:'Ein blaues Quadrat bewegt sich von links nach rechts.',source_text:'Automatische Videoerkennung: Ein blaues Quadrat bewegt sich von links nach rechts. Das Video enthält keine Tonspur.',audio_status:'no_audio_stream',content_comparison:'model_checked_sampled_evidence',evidence:{source_sha256:'a'.repeat(64)}}};
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
 const p=await boot({portal:'youtube',asset:ownFile.id,filesRpc:async a=>a.p_action==='list'?{ok:true,files:[freshFile({verified_at:++listed===1?staleTime:new Date().toISOString(),assignments:[{platform:'youtube',revision:4,status:'assigned'}]})]}:a.p_action==='get'?{...result,assignment_revision:4}:a.p_action==='save'?{...result,assignment_revision:5}:{ok:true,status:'empty'},fetchResponse:async()=>({ok:true})});
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
