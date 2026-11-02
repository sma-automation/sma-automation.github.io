const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const source=fs.readFileSync('app/assets/publication-preview.js','utf8').replace(/^import .*;$/m,'');
class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.events={};this.dataset={};this.value='';this.hidden=false;this.disabled=false;this.textContent='';this.classList={add(){}};}setAttribute(k,v){this[k]=v}showModal(){this.open=true}close(){this.open=false;this.events.close?.()}focus(){this.focused=true}scrollIntoView(){this.scrolledIntoView=true}append(...els){this.children.push(...els)}replaceChildren(...els){this.children=els}addEventListener(k,f){this.events[k]=f}querySelectorAll(sel){const all=this.children.flatMap(c=>[c,...c.querySelectorAll('*')]);return all.filter(c=>sel==='*'||(sel==='input,textarea'&&['input','textarea'].includes(c.tag))||(sel==='textarea'&&c.tag==='textarea')||sel===c.tag||sel==='[data-field='+c.dataset.field+']')}querySelector(sel){return this.querySelectorAll(sel)[0]}}
const result={ok:true,status:'completed',id:'own-id',revision:1,preview:{can_publish:false,language:'de',shop_url:'https://sma-automation.com/app/shop.html?shop=sma-testkunde',drafts:[{platform:'youtube',title:'Testtitel',body:'Ein sachlicher Testtext.',hashtags:['Test'],caption:'Ein sachlicher Testtext.\n\n#Test\n\n🛒 Zum Shop: https://sma-automation.com/app/shop.html?shop=sma-testkunde',review_notes:[]}]}};
async function boot({portal=null,asset=null,files=[],filesRpc=null,magicResponse=async()=>({ok:false}),signedIn=true,latest={ok:true,status:'empty'},fetchResponse=async()=>result,saveResponse=result}={}){const els=new Map();const get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id)};get('media_kind').value='video';get('result').hidden=true;const checks=['youtube','instagram','facebook','tiktok'].map(p=>Object.assign(new Element('input'),{value:p,checked:p==='youtube'}));const calls=[];let authChange;const win={addEventListener(){}};win.parent=win;
 const client={auth:{getSession:async()=>({data:{session:signedIn?{access_token:'private-session-token'}:null}}),onAuthStateChange(fn){authChange=fn;}},rpc:async(name,args)=>{calls.push({name,...args});return {data:name==='sma_publication_magic_v1'?await magicResponse(args):name==='sma_publication_files_v1'?(filesRpc?await filesRpc(args):{ok:true,files}):args.p_action==='latest'?latest:saveResponse}}};
 const values={source_text:'Dies ist eine sachliche Beschreibung des SMA Testartikels.',audience:'Testkunden',goal:'Shop kennenlernen',media_kind:'video',language:'de'};
 class Data{get(k){return values[k]}getAll(){return checks.filter(c=>c.checked).map(c=>c.value)}}
 await vm.runInNewContext('(async()=>{'+source+'})()',{createClient:()=>client,document:{getElementById:get,createElement:t=>new Element(t),querySelectorAll:()=>checks,querySelector:sel=>sel==='h1'?get('title'):checks[0],body:new Element()},window:win,location:{search:portal?'?embedded=1&portal='+portal+(asset?'&asset='+asset:''):'',origin:'https://sma-automation.com'},URLSearchParams,FormData:Data,crypto:{randomUUID:()=> '12345678-1234-4123-8123-123456789abc'},AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:()=>fetchResponse(url,options)}},setTimeout,console});
 return {get,calls,checks,run:()=>get('previewForm').events.submit({preventDefault(){}}),save:()=>get('save').events.click(),signOut:()=>authChange('SIGNED_OUT')};}
test('signed-out users cannot generate or display saved customer data',async()=>{const p=await boot({signedIn:false});assert.equal(p.calls.length,0);assert.equal(p.get('inputFields').disabled,true);assert.equal(p.get('result').hidden,true);assert.match(p.get('status').textContent,/melde dich/);});
test('one generation for concurrent clicks; body contains no tenant or shop override',async()=>{let release;const p=await boot({fetchResponse:()=>new Promise(r=>release=r)});const first=p.run();await Promise.resolve();await p.run();await new Promise(r=>setImmediate(r));assert.equal(p.calls.filter(c=>c.url).length,1);assert.equal(p.get('inputFields').disabled,true);release(result);await first;assert.equal(p.get('result').hidden,false);const request=JSON.parse(p.calls.find(c=>c.url).options.body);assert.equal(request.request_id,'12345678-1234-4123-8123-123456789abc');assert.ok(!('shop_url' in request));assert.ok(!('customer_id' in request));assert.equal(p.get('inputFields').disabled,false);});
test('saved edits retain server revision, sign-out hides content',async()=>{const p=await boot({latest:result,saveResponse:{...result,revision:2}});const body=p.get('drafts').children[0].querySelector('textarea');body.value='Ein korrigierter sachlicher Testtext.';await p.save();const call=p.calls.find(c=>c.p_action==='save');assert.equal(call.p_id,'own-id');assert.equal(call.p_input.revision,1);assert.equal(call.p_input.drafts[0].body,body.value);assert.ok(!('caption' in call.p_input.drafts[0]));p.signOut();assert.equal(p.get('result').hidden,true);assert.equal(p.get('inputFields').disabled,true);});
test('save conflicts preserve user edits and show recovery guidance',async()=>{const p=await boot({latest:result,saveResponse:{ok:false,code:'REVISION_CONFLICT'}});const body=p.get('drafts').children[0].querySelector('textarea');body.value='Meine noch nicht gespeicherten Angaben.';await p.save();assert.equal(body.value,'Meine noch nicht gespeicherten Angaben.');assert.match(p.get('status').textContent,/zwischenzeitlich/);assert.match(p.get('saveStatus').textContent,/nicht gespeichert/);});
test('per-portal editor loads only its scope and keeps other saved portal texts unchanged',async()=>{const other={...result.preview.drafts[0],platform:'tiktok',title:'TikTok Ausgangstitel',body:'Unveränderter TikTok Ausgangstext.'};const combined={...result,preview:{...result.preview,drafts:[result.preview.drafts[0],other]}};const p=await boot({portal:'youtube',latest:combined,saveResponse:{...combined,revision:2}});assert.equal(p.calls.find(c=>c.p_action==='latest').p_input.platform,'youtube');assert.equal(p.get('drafts').children.length,1);assert.equal(p.get('drafts').children[0].dataset.platform,'youtube');assert.equal(p.get('sourcePanel').open,false);assert.equal(p.get('portalSelection').hidden,true);p.get('drafts').children[0].querySelector('textarea').value='Bearbeiteter YouTube-Text ohne neue Produktbehauptungen.';await p.save();const saved=p.calls.find(c=>c.p_action==='save').p_input.drafts;assert.equal(saved.length,2);assert.equal(saved[1].title,other.title);assert.equal(saved[1].body,other.body);});
test('generation from a portal card requests exactly that portal',async()=>{for(const portal of ['youtube','instagram','facebook','tiktok']){const p=await boot({portal,fetchResponse:async()=>({...result,preview:{...result.preview,drafts:[{...result.preview.drafts[0],platform:portal}]}})});await p.run();const request=JSON.parse(p.calls.find(c=>c.url).options.body);assert.deepEqual(request.platforms,[portal]);if(portal==='youtube')assert.equal(request.media_kind,'video');assert.equal(p.get('drafts').children.length,1);assert.equal(p.get('drafts').children[0].dataset.platform,portal);}});

const ownFile={id:'fa110000-0000-4000-8000-000000000001',name:'Meine Datei A.mp4',media_kind:'video',revision:'version:1',assignments:[]};
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
