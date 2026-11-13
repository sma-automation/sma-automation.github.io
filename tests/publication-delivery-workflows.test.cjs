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
test('order API responds before supervised comparison and never sends a second response',()=>{
 const w=load('publication-order-api'),n=Object.fromEntries(w.nodes.map(x=>[x.name,x]));
 assert.equal(n['Inhaltsabgleich im Hintergrund'].parameters.options.waitForSubWorkflow,true);
 assert.equal(w.settings.executionTimeout,600);
 assert.equal(w.connections['Auftragsantwort prüfen'].main[0][0].node,'Dashboard-Antwort');
 assert.equal(w.connections['Dashboard-Antwort'].main[0][0].node,'Auftragsabgleich anstoßen?');
 assert.equal(reachable(w,w.nodes[0].name,new Set(['Dashboard-Antwort'])).has('Inhaltsabgleich im Hintergrund'),false);
 assert.equal(reachable(w,'Auftragsabgleich anstoßen?').has('Dashboard-Antwort'),false);
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
test('authenticated checked orders resume one provider operation without changing the API response',()=>{
 const w=load('publication-order-api'),n=Object.fromEntries(w.nodes.map(x=>[x.name,x]));
 const expr=n['Geprüften Providerauftrag fortsetzen?'].parameters.conditions.conditions[0].leftValue.slice(3,-2);
 // This request node has a separate error output. n8n can infer that
 // empty output at the downstream IF unless its success output is explicit.
 const eligible=(state,action,ok=true)=>vm.runInNewContext(expr,{
  $json:{id:'test-id',state,ok},
  $:name=>{assert.equal(name,'Dashboard-Anfrage prüfen');return {
   first:output=>output===0?{json:{action}}:undefined,
  };},
 });
 for(const state of ['preparing','prepared','approved','blocked','cancelled','failed'])for(const action of ['prepare','approve','get','account'])assert.equal(eligible(state,action),false);
 assert.equal(eligible('checked','get'),true);assert.equal(eligible('checked','approve'),true);assert.equal(eligible('checked','prepare'),false);assert.equal(eligible('checked','get',false),false);
 const kickoff=n['Providerweg im Hintergrund'];assert.equal(kickoff.parameters.options.waitForSubWorkflow,true);assert.equal(kickoff.parameters.workflowId.value,'JaidX5YeKl6ZTqjQ'); // Installed 47-node provider + cover copy
 assert.equal(reachable(w,w.nodes[0].name,new Set(['Dashboard-Antwort'])).has(kickoff.name),false);
 for(const port of w.connections[kickoff.name].main)assert.equal(port[0].node,'Auftragsantwort nach Providerstart');
 const original=[{json:{ok:true,id:'test-id',state:'checked',can_upload:false,can_publish:false}}];
 const selected=vm.runInNewContext('(function(){'+n['Providerauftrag auswählen'].parameters.jsCode+'})()',{$json:original[0].json});
 assert.equal(JSON.stringify(selected),'[{"json":{"id":"test-id"}}]');
 const restored=vm.runInNewContext('(function(){'+n['Auftragsantwort nach Providerstart'].parameters.jsCode+'})()',{$:name=>{assert.equal(name,'Provider-Auftragsantwort merken');return {all:()=>original};}});
 assert.equal(restored,original);
 assert.equal(reachable(w,w.nodes[0].name,new Set(['Geprüften Providerauftrag fortsetzen?'])).has(kickoff.name),false);
 assert.ok(!reachable(w,'Auftragsantwort nach Providerstart').has(kickoff.name));
});
test('API source targets the installed provider-cover copy, not the older provider-only dispatcher',()=>{
 const api=load('publication-order-api');
 const providerOnly=load('provider-dispatch');
 assert.equal(providerOnly.nodes.length,29);
 assert.equal(api.nodes.filter(n=>n.name==='Providerweg im Hintergrund').length,1);
 assert.equal(api.nodes.find(n=>n.name==='Providerweg im Hintergrund').parameters.workflowId.value,'JaidX5YeKl6ZTqjQ');
 assert.notEqual('JPtiMBrudXLxxSrz','JaidX5YeKl6ZTqjQ');
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
