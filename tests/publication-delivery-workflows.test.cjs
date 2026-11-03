const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const load=n=>JSON.parse(fs.readFileSync('n8n/publishing/'+n+'-workflow.json'));
function reachable(w,from,stop=new Set()){const seen=new Set(),todo=[from];while(todo.length){const name=todo.pop();if(seen.has(name)||stop.has(name))continue;seen.add(name);for(const port of w.connections[name]?.main||[])for(const e of port)todo.push(e.node);}return seen;}
test('new delivery workflows have no public trigger, schedule, retries, persisted execution data or reserved parameter access',()=>{
 for(const name of ['comparison-delivery','provider-dispatch']){
  const w=load(name);assert.equal(w.active,false);assert.deepEqual(w.pinData,{});assert.equal(w.settings.saveDataSuccessExecution,'none');assert.equal(w.settings.saveDataErrorExecution,'none');assert.equal(w.settings.saveManualExecutions,false);assert.equal(w.settings.saveExecutionProgress,false);assert.equal(w.settings.availableInMCP,false);assert.equal(w.settings.callerPolicy,'workflowsFromSameOwner');
  const seen=reachable(w,w.nodes[0].name);assert.equal(seen.size,w.nodes.length);
  for(const n of w.nodes){assert.ok(!n.retryOnFail);assert.ok(!/webhook|schedule|manualTrigger/.test(n.type));if(n.type.endsWith('.code'))new vm.Script('(async function(){'+n.parameters.jsCode+'})');
   function check(x){if(typeof x==='string'&&x.startsWith('='))assert.doesNotMatch(x,/\.binding\b|\[['"]binding['"]\]/);else if(x&&typeof x==='object')Object.values(x).forEach(check);}check(n.parameters);
  }
 }
});
test('normal order response starts comparison asynchronously and preserves response even if kickoff fails',()=>{
 const w=load('publication-order-api'),n=Object.fromEntries(w.nodes.map(x=>[x.name,x]));
 assert.equal(n['Inhaltsabgleich im Hintergrund'].parameters.options.waitForSubWorkflow,false);
 assert.equal(n['Inhaltsabgleich im Hintergrund'].parameters.workflowId.value,'ZFO9NSh5nHSn3ues');
 for(const port of w.connections['Inhaltsabgleich im Hintergrund'].main)assert.equal(port[0].node,'Unveränderte Auftragsantwort');
 assert.match(n['Unveränderte Auftragsantwort'].parameters.jsCode,/Auftragsantwort merken/);
 assert.ok(!JSON.stringify(w).includes('provider-dispatch'));
});
test('provider HTTP edges require account validation and an atomic journal intent; errors cannot retry requests',()=>{
 const w=load('provider-dispatch');const start=w.nodes[0].name;
 const sends=['Provider-Dateitransfer','Provider-JSON-Anfrage','Provider-Statusanfrage'];
 for(const gate of ['Providerverbindung bestätigen','Provideranfrage atomar reservieren','Provideranfrage reserviert?','Provideranfrage erstellen'])for(const send of sends)assert.equal(reachable(w,start,new Set([gate])).has(send),false);
 for(const send of sends){const n=w.nodes.find(x=>x.name===send);assert.equal(n.parameters.options.redirect.redirect.followRedirects,false);assert.equal(n.parameters.options.response.response.responseFormat,'text');assert.equal(n.parameters.options.response.response.fullResponse,true);assert.equal(w.connections[send].main[1][0].node,'Unklare Providerantwort');}
 assert.equal(w.connections['Providerergebnis speichern'].main[0][0].node,'Providerstatus sicher zurückgeben');
 assert.ok(!reachable(w,'Providerergebnis speichern').has('Provideranfrage atomar reservieren'));
});
test('n8n transfer code verifies and slices the restored binary instead of sending an entire file twice',async()=>{
 const w=load('provider-dispatch'),n=w.nodes.find(x=>x.name==='Provider-Dateirest auswählen'),crypto=require('node:crypto');
 const full=Buffer.from('0000ftyp0000-synthetic-video-data'),hash=crypto.createHash('sha256').update(full).digest('hex');
 const intent={size_bytes:full.length,binding:{asset_revision:'sha256:'+hash+':1'}};
 const values={'Provideranfrage atomar reservieren':{json:intent},'Provider-Dateiprüfsumme bestätigen':{binary:{data:{id:'synthetic'}}},'Provideranfrage erstellen':{json:{request:{offset:12}}}};
 const context={require,Buffer,URL,$:name=>({first:()=>values[name]})};
 const fn=vm.runInNewContext('(async function(){'+n.parameters.jsCode+'})',context);
 const result=await fn.call({helpers:{getBinaryDataBuffer:async()=>full,prepareBinaryData:async b=>({data:b.toString('base64')})}});
 assert.equal(Buffer.from(result[0].binary.data.data,'base64').toString(),full.subarray(12).toString());
});
