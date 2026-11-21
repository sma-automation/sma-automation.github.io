const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const model=import('../app/assets/media-editor-model.mjs'),history=import('../app/assets/publication-editor-history-model.mjs');
const id=n=>'ab660000-0000-4000-9000-'+String(n).padStart(12,'0');
const file={id:id(1),name:'Example.mp4',revision:'r1',media_kind:'video',mime_type:'video/mp4',duration_ms:10000,width_px:1080,height_px:1920};
test('editing recipes enforce media-specific ranges and accept Unicode text as literal content',async()=>{
 const {editorDefaults:d,readEditorSettings:read,editorValue}=await model;
 assert.deepEqual(read({...d,overlay_text:'😀'.repeat(160)},file),{...d,overlay_text:'😀'.repeat(160)});
 assert.equal(editorValue('overlay_text','__proto__'),'__proto__');
 assert.equal(read({...d,start_ms:1000,end_ms:9000,cover_ms:8999},file).cover_ms,8999);
 for(const bad of [null,{},[],{...d,extra:true},{...d,position_x:101},{...d,audio_volume:0.5},{...d,start_ms:'0'},{...d,start_ms:10000},{...d,end_ms:0},{...d,cover_ms:10000},{...d,start_ms:1000,cover_ms:999},{...d,end_ms:10001},{...d,format:'__proto__'},{...d,overlay_text:'😀'.repeat(161)},{...d,overlay_text:'line\nbreak'}])assert.throws(()=>read(bad,file));
 for(const f of [{...file,media_kind:'image',duration_ms:null},{...file,duration_ms:null}])assert.throws(()=>read({...d,start_ms:1},f));
 assert.throws(()=>read({...d,audio_volume:0},{...file,media_kind:'image'}));
});
test('editor response is bound to the exact file version and strips private extra fields',async()=>{
 const {editorDefaults:d,readEditorState:read,readEditorFiles}=await model;
 const response={ok:true,version:1,can_publish:false,asset_id:file.id,asset_revision:'r1',revision:0,settings:d,saved_at:null,changed:false};
 assert.deepEqual(read({...response,token:'private'},file),{revision:0,settings:d,saved_at:null,changed:false});
 for(const patch of [{can_publish:true},{asset_id:id(2)},{asset_revision:'r2'},{revision:1},{saved_at:'2026-11-06T12:00:00Z'},{version:2},{changed:null}])assert.throws(()=>read({...response,...patch},file));
 assert.deepEqual(readEditorFiles({ok:true,files:[{...file,user_id:'private',access_token:'private'}]}),[{...file,caption:'Example.mp4'}]);
 const catalog=Array.from({length:1001},(_,n)=>({...file,id:id(n+1)}));
 assert.equal(readEditorFiles({ok:true,files:catalog}).at(-1).id,id(1001));
 for(const files of [[file,file],[{...file,revision:''}],[{...file,duration_ms:-1}],[{...file,width_px:0}]])assert.throws(()=>readEditorFiles({ok:true,files}));
});
test('editor history requires exact differences, correct month and bounded cursor while hiding private fields',async()=>{
 const {editorDefaults:d}=await model,{readPublicationEditorHistory:read}=await history;
 const row={id:id(2),asset_id:file.id,asset_revision:'r1',file_name:'Example.mp4',media_kind:'video',revision:1,previous_settings:d,settings:{...d,format:'1:1'},changed_fields:['format'],recorded_at:'2026-11-06T12:00:00Z'};
 const reply=(entries=[row],extra={})=>({ok:true,version:1,month:'2026-11',timezone:'Europe/Vienna',total:entries.length,entries,has_more:false,next:null,...extra});
 assert.deepEqual(read(reply([{...row,user_id:'private',request_id:'private'}])).entries,[row]);
 for(const bad of [reply([row,row]),reply([{...row,changed_fields:[]}]),reply([{...row,changed_fields:['format','audio_volume']}]),reply([{...row,recorded_at:'2026-10-31T22:59:59Z'}]),reply([{...row,revision:0}]),reply([],{total:-1}),reply([],{next:{}})])assert.throws(()=>read(bad));
 const entries=Array.from({length:20},(_,n)=>({...row,id:id(n+10)})),last=entries.at(-1),next={before_at:last.recorded_at,before_id:last.id};
 assert.deepEqual(read(reply(entries,{total:21,has_more:true,next})).next,next);
 assert.throws(()=>read(reply(entries,{total:21,has_more:true,next:{...next,before_id:id(9)}})));
});
test('editor SQL source matches the migration and contains no publishing or rendering path',()=>{
 const sql=fs.readFileSync('supabase/sql/publication-editor-history.sql','utf8'),migrations=fs.readdirSync('supabase/migrations').filter(n=>n.endsWith('_publication_editor_history_v1.sql'));
 assert.equal(migrations.length,1);assert.equal(fs.readFileSync('supabase/migrations/'+migrations[0],'utf8'),sql);
 assert.doesNotMatch(sql,/\b(http_post|http_get|publication_preview_request_v1)\b/);
 assert.doesNotMatch(fs.readFileSync('app/assets/publication-editor-history-dashboard.mjs','utf8'),/innerHTML|upload\(|request\('save'/);
});
test('visual caption settings survive a history round trip alongside a legacy draft', async()=>{
 const {editorDefaults,readEditorSettings,editorValue}=await model;
 const {readPublicationEditorHistory}=await history;
 const overlay_style={x:22,y:74,size:130,color:'#ffd357',bold:true};
 const settings={...editorDefaults,overlay_text:'Hochformat',overlay_style};
 const entry={id:id(2),asset_id:file.id,asset_revision:'r1',file_name:'Example.mp4',media_kind:'video',revision:2,
  previous_settings:{...editorDefaults,overlay_text:'Hochformat'},settings,changed_fields:['overlay_style'],recorded_at:'2026-11-06T12:00:00Z'};
 const result=readPublicationEditorHistory({ok:true,version:1,month:'2026-11',timezone:'Europe/Vienna',total:1,entries:[entry],has_more:false,next:null});
 assert.deepEqual(result.entries,[entry]);assert.match(editorValue('overlay_style',overlay_style),/22 % horizontal.*Gelb/);
 for(const variant of [null,{}, {...overlay_style,color:'red'}, {...overlay_style,x:101}, {...overlay_style,y:-1}, {...overlay_style,size:49}, {...overlay_style,bold:1}, {...overlay_style,unexpected:true}]) {
  assert.throws(()=>readEditorSettings({...settings,overlay_style:variant},file),/INVALID_SETTINGS/);
 }
});
test('moving and styling text in the image uses the same geometry and paint as the export', async()=>{
 const {parseHTML}=await import('./dom-runtime/node_modules/linkedom/esm/index.js');
 const {mountEditorCaption}=await import('../app/assets/media-editor-caption.mjs');
 const {overlayPNG}=await import('../app/assets/media-export-render.mjs');
 const doc=parseHTML('<html><body><fieldset id="fields"><section id="overlayPanel"><input name="overlay_text"><input name="overlay_position" value="bottom"></section></fieldset><div id="stage"><canvas id="overlayCanvas"></canvas><span id="overlay"></span></div></body></html>').document;
 const stroke=()=>({calls:[],clearRect(){this.calls=[];},measureText(v){return {width:v.length*15};},fillRect(){},fillText(v,x,y){this.calls.push([v,x,y,this.fillStyle,this.font]);}});
 const act=(el,type,data)=>{const ev=new doc.defaultView.Event(type,{bubbles:true,cancelable:true});Object.assign(ev,data);el.dispatchEvent(ev);};
 const stage=doc.getElementById('stage'), preview=stroke(), control=k=>doc.querySelector('[name="'+k+'"]');
 stage.getBoundingClientRect=()=>({left:0,top:0,width:720,height:1280});
 doc.getElementById('overlayCanvas').getContext=()=>preview;
 let edits=0;
 const ui=mountEditorCaption({doc,stage,control,changed:()=>{edits++;}});
 ui.setActive(true);ui.paint(720,1280);
 doc.querySelector('[aria-label="Text hinzufügen"]').click();
 const input=doc.querySelector('textarea');
 input.value='Hallo SMA';act(input,'input',{});act(input,'keydown',{key:'Enter'});
 doc.querySelector('[aria-label="Gelb"]').click();doc.querySelector('[aria-label="Schrift vergrößern"]').click();
 const target=doc.querySelector('.editor-caption-target');
 act(target,'pointerdown',{clientX:360,clientY:819,button:0,pointerId:1});
 act(target,'pointermove',{clientX:216,clientY:691,pointerId:1});
 act(target,'pointerup',{pointerId:1});
 assert.equal(ui.getSetting().overlay_style.x,30);
 assert.equal(ui.getSetting().overlay_style.y,54);
 act(target,'keydown',{key:'ArrowRight'});
 assert.deepEqual(ui.getSetting(),{overlay_style:{x:31,y:54,size:110,bold:true,color:'#ffd357'}});
 const rendered=stroke(), exportDoc={createElement:()=>({getContext:()=>rendered,toBlob:cb=>cb(new Blob(['pixels']))})};
 await overlayPNG(exportDoc,{width:720,height:1280,settings:{overlay_position:'bottom',overlay_text:'Hallo SMA',...ui.getSetting()}});
 assert.deepEqual(preview.calls,rendered.calls);
 ui.fill({overlay_style:ui.getSetting().overlay_style});ui.paint(720,1280);
 assert.deepEqual(preview.calls,rendered.calls);
 assert.ok(edits>=5);doc.querySelector('[aria-label="Text entfernen"]').click();assert.deepEqual(ui.getSetting(),{});
 ui.destroy();assert.equal(doc.querySelector('.editor-caption-selection'),null);
});
