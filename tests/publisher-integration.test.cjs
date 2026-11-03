const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const {publisherText}=require('../n8n/publishing/publisher-text.cjs');
const selection={version:1,customer_id:1,drive_file_id:'synthetic_drive_file',asset_id:'00000000-0000-4000-8000-000000000001',asset_revision:'version:1',platform:'youtube',assignment_revision:1,preview_id:'00000000-0000-4000-8000-000000000002',preview_revision:1,shop_url:'https://sma-automation.com/app/shop.html?shop=synthetic-test',media_kind:'video'};
const draft={title:'Äpfel & "Test"',body:'Ein Beitrag mit zwei Absätzen.\n\nMehr Text.',caption:'Ein Beitrag mit zwei Absätzen.\n\nMehr Text.\n\n#Test\n\n🛒 Zum Shop: '+selection.shop_url,hashtags:['Test'],review_notes:['Interne Rückfrage']};
function handoff(p='youtube',kind='video'){
 const binding={...selection,platform:p,media_kind:kind};return {ok:true,version:1,stage:'handoff_preview',can_upload:false,can_publish:false,binding,draft:{...draft,platform:p},checks:{saved_selection:'matched'},blockers:['TARGET_ACCOUNT_REQUIRED','PUBLICATION_APPROVAL_REQUIRED','PUBLICATION_RESERVATION_REQUIRED']};
}
function prepare(p,kind){const h=handoff(p,kind);return publisherText(h,h.binding);}
test('portal text mapping preserves exact title/caption and excludes internal notes',()=>{
 const routes=[['youtube','video',{snippet:{title:draft.title,description:draft.caption}}],['instagram','image',{caption:draft.caption}],['instagram','video',{caption:draft.caption}],['facebook','image',{message:draft.caption}],['facebook','video',{description:draft.caption}],['tiktok','video',{post_info:{title:draft.caption}}]];
 for(const [p,k,expected] of routes){const result=prepare(p,k);assert.deepEqual(result.adapter_fields,expected);assert.equal(result.can_upload,false);assert.equal(result.can_publish,false);assert.ok(!JSON.stringify(result.adapter_fields).includes('Interne Rückfrage'));assert.ok(result.blockers.includes('PUBLICATION_RESERVATION_REQUIRED'));}
});
test('no fallback text, forged approval, changed selection or unsupported image route',()=>{
 const h=handoff();
 for(const patch of [{version:2},{stage:'published'},{can_upload:true},{can_publish:true},{blockers:[]},{checks:{saved_selection:'unknown'}},{binding:{...h.binding,assignment_revision:2}},{draft:{...h.draft,caption:''}},{draft:{...h.draft,title:''}}])assert.equal(publisherText({...h,...patch},h.binding).ok,false);
 for(const p of ['youtube','tiktok','unknown'])assert.equal(prepare(p,'image').code,'PUBLISHER_ROUTE_UNSUPPORTED');
 for(const code of ['ACCESS_INACTIVE','HANDOFF_CHANGED','FILE_REFRESH_REQUIRED'])assert.deepEqual(publisherText({ok:false,code,private:'secret'},selection),{ok:false,stage:'publisher_preparation',can_upload:false,can_publish:false,code});
 assert.equal(publisherText({error:'secret'},selection).code,'HANDOFF_UNAVAILABLE');
});

function sourceFixture(){
 const make=(name,type,parameters)=>({name,id:name,type:'n8n-nodes-base.'+type,typeVersion:1,parameters,position:[0,0]});
 return {id:'qwdTLh2rVmMkwhxb',active:false,versionId:'synthetic-source-version',name:'Synthetic customer publisher',pinData:{private:'must disappear'},staticData:{private:'must disappear'},nodes:[
  make('SMA – Posting starten','webhook',{path:'production-webhook'}),
  make('Kunden-Upload – Zeitplan','scheduleTrigger',{}),
  make('Kundendaten – Publishing','set',{assignments:{assignments:[{name:'kunden_id',value:'keep-existing-customer-binding'}]},includeOtherFields:true}),
  make('YouTube – Upload starten','httpRequest',{method:'POST',url:'https://www.googleapis.com/upload/youtube/v3/videos',jsonBody:"={{ {snippet:{title: $('Kundendaten – Publishing').item.json.title || $('Kundendaten – Publishing').item.json.name || 'SMA Kunden-Video',description: $('Kundendaten – Publishing').item.json.description || '',categoryId:'22'},status:{privacyStatus:'private',selfDeclaredMadeForKids:false}} }}"}),
  ...['Instagram – Media Container erstellen','Instagram – Bild Container erstellen'].map(name=>make(name,'httpRequest',{method:'POST',url:'https://graph.instagram.com/v25.0/synthetic/media',queryParameters:{parameters:[{name:'image_url',value:'existing-source'}]}})),
  ...['Facebook – Bild veröffentlichen','Facebook – Video veröffentlichen'].map(name=>make(name,'httpRequest',{method:'POST',url:'https://graph.facebook.com/v25.0/synthetic/photos',bodyParameters:{parameters:[{name:'published',value:'true'}]}})),
  make('TikTok – Video-Upload initialisieren','httpRequest',{method:'POST',url:'https://open.tiktokapis.com/v2/post/publish/video/init/',jsonBody:"={{ {post_info: {privacy_level:$json.tiktok_privacy_level},source_info:{source:$json.tiktok_source}} }}"})
 ],connections:{'SMA – Posting starten':{main:[[{node:'Kundendaten – Publishing',type:'main',index:0}]]},'Kundendaten – Publishing':{main:[[{node:'YouTube – Upload starten',type:'main',index:0}]]}}};
}
function build(source=sourceFixture()){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sma-publisher-integration-'));
 const input=path.join(dir,'source.json'),output=path.join(dir,'prepared.json');fs.writeFileSync(input,JSON.stringify(source));
 try {execFileSync('python',['n8n/publishing/build-publisher-integration.py','--source',input,'--output',output],{stdio:'pipe'});assert.deepEqual(JSON.parse(fs.readFileSync(input)),source);return JSON.parse(fs.readFileSync(output));}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const generated=build(),nodes=Object.fromEntries(generated.nodes.map(n=>[n.name,n]));
function expression(value,data,local={}){assert.ok(value.startsWith('={{ ')&&value.endsWith(' }}'));return vm.runInNewContext('('+value.slice(4,-3)+')',{$json:local,$:name=>{assert.equal(name,'SMA – Portaltext bereitstellen');return {first:()=>({json:data})};}});}
const plain=x=>JSON.parse(JSON.stringify(x));
test('real publisher-node templates receive the prepared text, without replacement values',()=>{
 const yt=plain(expression(nodes['YouTube – Upload starten'].parameters.jsonBody,prepare('youtube','video')));assert.deepEqual(yt.snippet,{title:draft.title,description:draft.caption,categoryId:'22'});assert.deepEqual(yt.status,{privacyStatus:'private',selfDeclaredMadeForKids:false});
 for(const [name,p,kind,container,field] of [['Instagram – Media Container erstellen','instagram','video','queryParameters','caption'],['Instagram – Bild Container erstellen','instagram','image','queryParameters','caption'],['Facebook – Bild veröffentlichen','facebook','image','bodyParameters','message'],['Facebook – Video veröffentlichen','facebook','video','bodyParameters','description']]){
  const values=nodes[name].parameters[container].parameters;assert.equal(values.filter(x=>x.name===field).length,1);assert.equal(expression(values.find(x=>x.name===field).value,prepare(p,kind)),draft.caption);
 }
 const tt=plain(expression(nodes['TikTok – Video-Upload initialisieren'].parameters.jsonBody,prepare('tiktok','video'),{tiktok_privacy_level:'SELF_ONLY',tiktok_source:'FILE_UPLOAD'}));assert.deepEqual(tt.post_info,{title:draft.caption,privacy_level:'SELF_ONLY'});assert.deepEqual(tt.source_info,{source:'FILE_UPLOAD'});
});
test('source stays intact; working copy has no old trigger and no runnable path to an upload',()=>{
 assert.equal(generated.active,false);assert.equal(generated.id,undefined);assert.equal(generated.staticData,undefined);assert.deepEqual(generated.pinData,{});
 const active=generated.nodes.filter(n=>!n.disabled);assert.equal(active.length,5);
 assert.deepEqual(active.map(n=>n.type),['n8n-nodes-base.executeWorkflowTrigger','n8n-nodes-base.code','n8n-nodes-base.executeWorkflow','n8n-nodes-base.code','n8n-nodes-base.code']);
 const queue=[active[0].name],reached=new Set();while(queue.length){const name=queue.pop();if(reached.has(name))continue;reached.add(name);assert.ok(!nodes[name].disabled);for(const port of generated.connections[name]?.main||[])for(const edge of port)queue.push(edge.node);}
 assert.equal(reached.size,5);assert.equal([...reached].some(n=>nodes[n].type.endsWith('.httpRequest')),false);
 assert.equal(active[2].parameters.workflowId.value,'LxayneKkUusok0Q8');assert.equal(active[2].parameters.options.waitForSubWorkflow,true);
 assert.equal(generated.settings.callerPolicy,'workflowsFromSameOwner');assert.equal(generated.settings.saveManualExecutions,false);
 assert.equal(generated.settings.saveDataSuccessExecution,'none');assert.equal(generated.settings.saveDataErrorExecution,'none');
});
test('generated preparation and final gate run in n8n shape and never authorize uploads',()=>{
 const h=handoff(),run=(name,json)=>plain(vm.runInNewContext('(function(){'+nodes[name].parameters.jsCode+'})()',{$input:{all:()=>[{json}],first:()=>({json})},$:()=>({first:()=>({json:h.binding})})}))[0].json;
 const result=run('SMA – Portaltext bereitstellen',h);assert.deepEqual(result,publisherText(h,h.binding));assert.deepEqual(run('SMA – Freigabestand zurückgeben',result),result);
 assert.throws(()=>run('SMA – Freigabestand zurückgeben',{...result,can_upload:true}),/APPROVAL_UNAVAILABLE/);
});
test('patch refuses changed source templates or another workflow instead of guessing',()=>{
 for(const source of [{...sourceFixture(),id:'protected-production'},{...sourceFixture(),active:true},(()=>{const s=sourceFixture();s.nodes.find(n=>n.name==='YouTube – Upload starten').parameters.jsonBody='changed';return s;})()])assert.throws(()=>build(source));
});
