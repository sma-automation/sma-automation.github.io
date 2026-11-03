const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const {orderRequest,orderTarget,orderDrive,orderCheck,orderFailure}=require('../n8n/publishing/publisher-order.cjs');
const id='fa660000-0000-4000-8000-000000000010';
const context={ok:true,id,lease_id:'fa660000-0000-4000-8000-000000000020',n8n_kunde_id:'synthetic-owner',kunde_email:'owner@example.invalid',binding:{platform:'youtube',drive_file_id:'synthetic_file',asset_revision:'version:7',media_kind:'video'}};
const row={id:1,kunde_id:'synthetic-owner',kunde_email:'owner@example.invalid',zugang_aktiv:true,demo_delta_aktiv:true,youtube_channel_id:'synthetic_channel',youtube_channel_title:'Synthetic channel',youtube_access_token:'DO_NOT_DISCLOSE'};
test('webhook requires auth and a bounded, typed action',()=>{
 for(const item of [{},{headers:{authorization:'invalid'}},{headers:{authorization:'Bearer '+ 'x'.repeat(30)},body:{action:'publish',input:{id}}}])assert.throws(()=>orderRequest(item));
 assert.equal(orderRequest({headers:{authorization:'Bearer '+ 'x'.repeat(30)},body:{action:'prepare',input:{id}}}).input.id,id);
});
test('target derives from the unique active customer row, without tokens',()=>{
 const r=orderTarget([row],context);assert.equal(r.target.id,row.youtube_channel_id);assert.match(r.target.source_revision,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(r).includes('DO_NOT_DISCLOSE'));
 for(const rows of [[],[row,row],[{...row,kunde_id:'other'}],[{...row,kunde_email:'other@example.invalid'}],[{...row,zugang_aktiv:false}],[{...row,demo_delta_aktiv:false}],[{...row,youtube_channel_id:''}]])assert.throws(()=>orderTarget(rows,context),/TARGET_ACCOUNT_REQUIRED/);
 assert.throws(()=>orderTarget([{...row,youtube_channel_id:'changed_channel'}],{...context,...r}),/TARGET_ACCOUNT_CHANGED/);
});
test('all four target identities are bound separately',()=>{
 for(const [p,key] of [['youtube','youtube_channel_id'],['instagram','instagram_user_id'],['facebook','facebook_page_id'],['tiktok','tiktok_open_id']])assert.equal(orderTarget([{...row,[key]:'target_'+p}],{...context,binding:{...context.binding,platform:p}}).target.id,'target_'+p);
});
const metadata={id:'synthetic_file',version:'7',parents:['synthetic_folder'],trashed:false,mimeType:'video/mp4',capabilities:{canDownload:true}};
test('Drive read verifies exact revision, customer folder, type, and download access',()=>{
 assert.deepEqual(orderDrive(metadata,context,['synthetic_folder']),{drive_verified:true});
 for(const patch of [{id:'other'},{version:'8'},{parents:['foreign']},{trashed:true},{mimeType:'image/png'},{capabilities:{canDownload:false}},{sha256Checksum:'a'.repeat(64)}])assert.throws(()=>orderDrive({...metadata,...patch},context,['synthetic_folder']),/FILE_CHANGED/);
});
test('the worker never converts missing preparation or text notes to an upload grant',()=>{
 const prepared={ok:true,stage:'publisher_preparation',can_upload:false,can_publish:false,binding:context.binding,draft:{review_notes:[]}};
 const data=orderCheck(prepared,context,orderTarget([row],context),{drive_verified:true});assert.equal(data.p_data.text_verified,true);assert.equal(data.p_data.drive_verified,true);assert.ok(!('can_publish' in data));
 assert.equal(orderCheck({...prepared,can_publish:true},context,null,null).p_data.text_verified,false);
 assert.deepEqual(orderCheck({...prepared,draft:{review_notes:['Check statement']}},context,null,null).p_data.blockers,['TEXT_REVIEW_REQUIRED']);
 assert.equal(orderFailure({error:{message:'raw credential failure'}}).code,'ORDER_UNAVAILABLE');
});
test('generated execution path only reaches customer read, Drive GET, saved publisher and journal',()=>{
 const w=JSON.parse(fs.readFileSync('n8n/publishing/publication-order-execution-workflow.json'));const nodes=Object.fromEntries(w.nodes.map(n=>[n.name,n]));
 const seen=new Set(),todo=['Freigegebenen Auftrag ausführen'];while(todo.length){const x=todo.pop();if(seen.has(x))continue;seen.add(x);assert.ok(nodes[x]);for(const port of w.connections[x]?.main||[])for(const e of port)todo.push(e.node);}
 assert.equal(seen.size,w.nodes.length);assert.equal(w.settings.saveManualExecutions,false);assert.equal(w.settings.saveDataErrorExecution,'none');assert.deepEqual(w.pinData,{});
 assert.equal(nodes['Publisher-Arbeitskopie aufrufen'].parameters.workflowId.value,'JZwPbzCpgIByxk94');
 for(const n of w.nodes.filter(n=>n.type.endsWith('.httpRequest'))){if(n.parameters.url.startsWith('https://'))assert.match(n.parameters.url,/supabase\.co\/rest\/v1\/rpc\/sma_publication_order_worker_v1$/);else assert.equal(n.parameters.method,undefined);assert.ok(!n.retryOnFail);}
});
test('API verifies owner before any service call; no direct client selection reaches publisher',()=>{
 const w=JSON.parse(fs.readFileSync('n8n/publishing/publication-order-api-workflow.json'));const nodes=Object.fromEntries(w.nodes.map(n=>[n.name,n]));
 assert.equal(w.connections['Dashboard-Anfrage prüfen'].main[0][0].node,'Kontooptionen angefordert?');
 assert.equal(w.connections['Kontooptionen angefordert?'].main[1][0].node,'Eigenen Auftrag bearbeiten');
 assert.equal(w.connections['Kontooptionen angefordert?'].main[0][0].node,'Eigenes Kontoziel lesen');
 assert.equal(nodes['Eigenes Kontoziel lesen'].credentials,undefined);
 assert.equal(nodes['Eigenen Auftrag bearbeiten'].credentials,undefined);assert.match(nodes['Eigenen Auftrag bearbeiten'].parameters.headerParameters.parameters[1].value,/\.auth/);
 const code=nodes['Ausführungsauftrag auswählen'].parameters.jsCode;
 const out=vm.runInNewContext('(function(){'+code+'})()',{$json:{id,customer_id:666,target_id:'forged'}});assert.equal(JSON.stringify(out),JSON.stringify([{json:{id}}]));
});
