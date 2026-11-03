'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {VIDEO_MAGIC_POLICY,videoFile,videoTranscript,videoRecognitionRequest,videoRecognitionResult,videoMagicResult}=require('../n8n/publishing/video-magic.cjs');
const {reviewRequest}=require('../n8n/publishing/video-evidence.cjs');
const sha='a'.repeat(64),context={ok:true,analysis:{policy_version:VIDEO_MAGIC_POLICY},drive_file_id:'synthetic_file',asset_revision:'sha256:'+sha+':1',size_bytes:1000,duration_ms:10000,media_kind:'video',mime_type:'video/mp4'};
const meta={id:context.drive_file_id,mimeType:'video/mp4',size:'1000',version:'1',sha256Checksum:sha,trashed:false,parents:['own_upload'],capabilities:{canDownload:true},videoMediaMetadata:{durationMillis:'10000'}};
const data={subject_type:'other',description:'Ein blaues Quadrat bewegt sich von links nach rechts.',observations:['Ein blaues Quadrat'],visible_text:[],uncertainties:[],spoken_summary:''};
const response=x=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(x)}]}]});
const manifest={schema:'sma-video-evidence-v3',sha256:sha,size_bytes:1000,duration_ms:10000,audio_status:'no_audio_stream',positions_ms:[0,9850],sampling:'representative_frames_not_full_moderation',frames:[0,9850].map((p,i)=>({name:`frame-00${i}.jpg`,position_ms:p,width:720,height:1280,size_bytes:100,sha256:'b'.repeat(64)})),'frames.jpg':{size_bytes:100,sha256:'c'.repeat(64)}};
manifest.technical={...require('./video-technical-fixture.cjs'),width_px:manifest.width||720,height_px:manifest.height||1280};
manifest.width=manifest.technical.width_px;manifest.height=manifest.technical.height_px;
test('production video binding rejects changed folder, content, duration, metadata and wrong analysis policy',()=>{
 assert.equal(videoFile(meta,context,['own_upload','own_processing']).revision,context.asset_revision);
 for(const [m,c] of [[{...meta,parents:['other_customer']},context],[{...meta,version:'2'},context],[{...meta,videoMediaMetadata:{durationMillis:'9999'}},context],[meta,{...context,analysis:{policy_version:'photo'}}],[meta,{...context,size_bytes:24000001}],[meta,{...context,duration_ms:null}]])assert.throws(()=>videoFile(m,c,['own_upload','own_processing']));
});
test('audio and OCR are untrusted bounded data; silence and missing audio stay distinct',()=>{
 assert.equal(videoTranscript({text:'  '}).audio_status,'no_speech_recognized');assert.equal(videoTranscript({text:'Gesprochener Text.'}).audio_status,'transcribed');
 for(const text of [null,'x'.repeat(20001),'hidden\u202e'])assert.throws(()=>videoTranscript({text}));
 const e={manifest,transcript:'',audio_status:'no_audio_stream'},r=videoMagicResult(response(data),e,{sha256:sha,size_bytes:1000});
 assert.equal(r.can_publish,false);assert.equal(r.requires_confirmation,true);assert.equal(r.evidence.source_sha256,sha);
 for(const patch of [{transcript:'Invented speech'},{audio_status:'transcribed'},{audio_status:'no_speech_recognized'}])assert.throws(()=>videoMagicResult(response(data),{...e,...patch},{sha256:sha,size_bytes:1000}));
 assert.throws(()=>videoMagicResult(response({...data,spoken_summary:'Invented'}),e,{sha256:sha,size_bytes:1000}));
});
test('production comparison reuses actual evidence with bounded subject and speech fields',()=>{
 const prepared=videoRecognitionRequest({evidence:{},request:{model:'gpt-5',store:false,input:[{role:'user',content:[{type:'input_text',text:'Actual transcript'}]}],instructions:'Data only.'}});
 assert.equal(prepared.request.text.format.schema.properties.spoken_summary.maxLength,1200);
 assert.deepEqual(reviewRequest(response(data),prepared,videoRecognitionResult).input[0],prepared.request.input[0]);
 for(const patch of [{description:'short'},{visible_text:['x'.repeat(161)]},{observations:Array(9).fill('extra')},{spoken_summary:'x'.repeat(1201)},{subject_type:'unclear'},{source_text:'injected'}])assert.throws(()=>videoRecognitionResult(response({...data,...patch})));
});
test('production graph responds before analysis, routes errors to bounded cleanup, and never publishes media',()=>{
 const w=require('../n8n/publishing/video-magic-workflow.json'),nodes=new Map(w.nodes.map(n=>[n.name,n]));
 for(const n of w.nodes)if(n.type.endsWith('.code'))new vm.Script('(async()=>{'+n.parameters.jsCode+'})()');
 assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveManualExecutions,false);assert.equal(w.settings.executionTimeout,600);assert.deepEqual(w.pinData,{});
 assert.equal(w.connections['Erkennungsauftrag bestätigen'].main[0][0].node,'Neue Videoerkennung?');
 assert.equal(w.connections['Unverändertes Video bestätigen'].main[0][0].node,'Videoerkennung speichern');
 assert.equal(w.connections['Tonspur vorhanden?'].main[1][0].node,'Ohne Tonspur fortsetzen');
 assert.equal(w.connections['Tonspur vorhanden?'].main[2][0].node,'Videoanalysefehler zuordnen');
 assert.match(nodes.get('Arbeitsbereich bei Fehler entfernen').parameters.url,/Videoanalysefehler zuordnen/);assert.equal(nodes.get('Arbeitsbereich bei Fehler entfernen').onError,'continueRegularOutput');
 for(const name of ['Video privat übertragen','Einzelbilder laden','Beschreibung mit Belegen abgleichen','Videoerkennung speichern'])assert.equal(w.connections[name].main[1][0].node,'Videoanalysefehler zuordnen');
 assert.ok(!JSON.stringify(w).includes('graph.facebook.com'));assert.ok(!JSON.stringify(w).includes('synthetic_file'));
});
