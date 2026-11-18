const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {resolve}=require('node:path');
const {accessibleFolders,verifiedFolders,catalogFiles}=require('../n8n/publishing/file-catalog.cjs');
const load=()=>import('../n8n/package-payment/check-folders.mjs');
const config={uploadFolderId:'fixture_upload_folder',processingFolderId:'fixture_processing_folder',
 accessToken:'fixture.token-not-real',expectedPermissionId:'fixture_permission_id'};
const metadata=id=>({id,mimeType:'application/vnd.google-apps.folder',trashed:false,
 capabilities:{canListChildren:true,canAddChildren:true}});
const reply=(value,options={})=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'},...options});
function fixture(overrides={},respond){
 const requests=[];
 const fetchImpl=async(url,options)=>{
  const index=requests.push({url,options})-1;
  if(respond)return respond(index,url,options);
  return reply(index===0?{user:{permissionId:config.expectedPermissionId}}:
   metadata(index===1?config.uploadFolderId:config.processingFolderId));
 };
 return {requests,run:async()=> (await load()).checkFolders({...config,fetchImpl,...overrides})};
}
function noGrant(result){
 for(const field of ['allows_payment','allows_upload','activates_customer','customer_assignment_verified'])
  assert.equal(result[field],false,field);
 const output=JSON.stringify(result);
 for(const secret of Object.values(config))assert.equal(output.includes(secret),false,'no identifiers or token');
}
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}

test('preflight uses exactly three fixed metadata GETs and never claims payment, upload or customer approval',async()=>{
 const x=fixture();const result=await x.run();assert.equal(result.ok,true);noGrant(result);
 assert.equal(result.code,'FOLDER_ACCESS_VERIFIED');assert.equal(result.scope,'drive_metadata_only');
 assert.ok(Number.isFinite(Date.parse(result.checked_at)));
 assert.deepEqual(result.checks,{drive_account_matches:true,upload_folder_readable:true,
  upload_folder_service_can_add_children:true,
  processing_folder_readable:true,processing_folder_writable:true});
 assert.deepEqual(result.warnings,[]);
 assert.equal(x.requests.length,3);
 const urls=x.requests.map(r=>new URL(r.url));
 assert.deepEqual(urls.map(u=>u.pathname),['/drive/v3/about','/drive/v3/files/'+config.uploadFolderId,'/drive/v3/files/'+config.processingFolderId]);
 assert.equal(urls[0].searchParams.get('fields'),'user(permissionId)');
 for(let i=0;i<3;i++){
  const {options}=x.requests[i];assert.equal(urls[i].origin,'https://www.googleapis.com');
  assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
  assert.equal(options.cache,'no-store');assert.equal(options.body,undefined);
  assert.deepEqual(options.headers,{Authorization:'Bearer '+config.accessToken,Accept:'application/json'});
  assert.equal(urls[i].searchParams.has('alt'),false);assert.equal(urls[i].searchParams.has('q'),false);
  if(i){assert.equal(urls[i].searchParams.get('supportsAllDrives'),'true');
   assert.equal(urls[i].searchParams.get('fields'),'id,mimeType,trashed,capabilities(canListChildren,canAddChildren)');}
 }
 assert.equal(x.requests[0].options.signal,x.requests[2].options.signal);
});

test('invalid, aliased or injected folder IDs fail before any HTTP request',async()=>{
 for(const value of [undefined,null,12,[],{},'', 'short','x'.repeat(201),'../fixture_folder',
  'fixture_folder?alt=media','https://attacker.invalid','fixture_folder\n']){
  for(const field of ['uploadFolderId','processingFolderId']){
   const x=fixture({[field]:value});const r=await x.run();
   assert.equal(r.code,'INVALID_FOLDERS');assert.equal(x.requests.length,0);noGrant(r);
  }
 }
 const x=fixture({processingFolderId:config.uploadFolderId});assert.equal((await x.run()).code,'INVALID_FOLDERS');assert.equal(x.requests.length,0);
});

test('missing or unsafe token, identity and deadline configuration cannot start a read',async()=>{
 for(const override of [{accessToken:''},{accessToken:'Bearer fixture'},{accessToken:'secret\r\nHeader: value'},
  {accessToken:'x'.repeat(8193)},{expectedPermissionId:null},{expectedPermissionId:'unsafe/user'},
  {timeoutMs:0},{timeoutMs:60001},{timeoutMs:Infinity},{timeoutMs:1.5},{fetchImpl:null}]){
  const x=fixture(override);const r=await x.run();assert.equal(r.code,'INVALID_CONFIGURATION');assert.equal(x.requests.length,0);noGrant(r);
 }
});

test('another Drive account and absent identity stop before reading either customer folder',async()=>{
 for(const value of [{},{user:{}},{user:{permissionId:'another_account'}},{user:{permissionId:42}},null]){
  const x=fixture({},()=>reply(value));const r=await x.run();
  assert.equal(r.code,'ACCOUNT_MISMATCH');assert.equal(r.step,'identity');assert.equal(x.requests.length,1);noGrant(r);
 }
});

test('each folder requires its exact identity, folder MIME type, non-trash state and explicit listing permission',async()=>{
 for(const role of ['upload','processing']){
  const target=role==='upload'?1:2;
  for(const change of [{id:'foreign_folder_id'},{mimeType:'application/vnd.google-apps.shortcut'},
   {mimeType:'video/mp4'},{trashed:true},{trashed:undefined},{trashed:'false'},
   {capabilities:null},{capabilities:{canListChildren:'true'}},{capabilities:{canListChildren:false}},
   {capabilities:{canAddChildren:true}}]){
   const x=fixture({},index=>reply(index===0?{user:{permissionId:config.expectedPermissionId}}:
    {...metadata(index===1?config.uploadFolderId:config.processingFolderId),...(index===target?change:{})}));
   const r=await x.run();assert.equal(r.code,'FOLDER_UNAVAILABLE');assert.equal(r.step,role);noGrant(r);
  }
 }
});

test('a read-only processing folder cannot pass; missing and string write capabilities remain unknown',async()=>{
 for(const canAddChildren of [false,undefined,null,'true',1]){
  const x=fixture({},index=>{
   const value=index===0?{user:{permissionId:config.expectedPermissionId}}:metadata(index===1?config.uploadFolderId:config.processingFolderId);
   if(index===2)value.capabilities.canAddChildren=canAddChildren;return reply(value);
  });
  const r=await x.run();assert.equal(r.code,'PROCESSING_NOT_WRITABLE');assert.equal(r.step,'processing');noGrant(r);
 }
});

test('read-only input access is diagnosed without blocking a customer-owned upload path',async()=>{
 for(const canAddChildren of [false,undefined,null,'true',1]){
  const x=fixture({},index=>{
   const value=index===0?{user:{permissionId:config.expectedPermissionId}}:metadata(index===1?config.uploadFolderId:config.processingFolderId);
   if(index===1)value.capabilities.canAddChildren=canAddChildren;
   return reply(value);
  });
  const r=await x.run();
  assert.equal(r.ok,true);assert.equal(r.code,'FOLDER_ACCESS_VERIFIED');
  assert.equal(r.checks.upload_folder_service_can_add_children,false);
  assert.deepEqual(r.warnings,['UPLOAD_SERVICE_WRITE_NOT_CONFIRMED']);
  assert.equal(x.requests.length,3);noGrant(r);
 }
});

test('both shared-drive and My Drive folders pass only when readable and writable',async()=>{
 for(const shared of [false,true]){
  const x=fixture({},index=>{
   const value=index===0?{user:{permissionId:config.expectedPermissionId}}:metadata(index===1?config.uploadFolderId:config.processingFolderId);
   if(shared&&index>0)value.driveId='private_shared_drive';
   return reply(value);
  });
  const r=await x.run();
  assert.equal(r.ok,true);assert.equal(r.checks.upload_folder_service_can_add_children,true);
  assert.equal(r.checks.processing_folder_writable,true);
  assert.deepEqual(r.warnings,[]);
  noGrant(r);assert.equal(JSON.stringify(r).includes('private_shared_drive'),false);
 }
});

test('metadata acceptance agrees with the existing catalog gate, but cannot activate a dormant customer',async()=>{
 const x=fixture();assert.equal((await x.run()).ok,true);
 const context={ok:true,n8n_kunde_id:'kunde_fixture',kunde_email:'customer@example.invalid'};
 const row={kunde_id:context.n8n_kunde_id,kunde_email:context.kunde_email,zugang_aktiv:false,
  zahlung_bestaetigt:false,demo_delta_aktiv:false,upload_folder_id:config.uploadFolderId,processing_folder_id:config.processingFolderId};
 assert.throws(()=>verifiedFolders([row],context),/FOLDER_UNAVAILABLE/);
 const bound=verifiedFolders([{...row,zugang_aktiv:true,zahlung_bestaetigt:true}],context);
 assert.equal(accessibleFolders(bound.folders.map(metadata),bound),bound);
 assert.deepEqual(catalogFiles({files:[]},bound.folders),[]);
 assert.equal(row.zugang_aktiv,false);assert.equal(row.zahlung_bestaetigt,false);
});

for(const [status,code] of [[401,'AUTH_REQUIRED'],[403,'ACCESS_UNAVAILABLE'],[404,'ACCESS_UNAVAILABLE'],
 [429,'RATE_LIMITED'],[500,'READ_FAILED'],[206,'READ_FAILED'],[302,'READ_FAILED']]){
 test('HTTP '+status+' returns only a fixed failure and cannot be read as an empty gallery',async()=>{
  const x=fixture({},()=>reply({error:config.accessToken}, {status}));const r=await x.run();
  assert.equal(r.code,code);assert.equal(r.ok,false);assert.equal(x.requests.length,1);noGrant(r);
 });
}

test('redirected replies, foreign response URLs and non-JSON bodies are rejected and discarded',async()=>{
 for(const kind of ['redirect','url','html']){
  let cancelled=false;
  const x=fixture({},()=>({status:200,redirected:kind==='redirect',url:kind==='url'?'https://attacker.invalid/':'',
   headers:new Headers({'Content-Type':kind==='html'?'text/html':'application/json'}),body:{cancel(){cancelled=true;}}}));
  const r=await x.run();assert.equal(r.code,'UNEXPECTED_RESPONSE');assert.equal(cancelled,true);noGrant(r);
 }
});

test('oversized, invalid, truncated and malformed UTF-8 JSON never confirms access',async()=>{
 for(const [body,headers] of [['x'.repeat(16385),{}],['{}',{'Content-Length':'16385'}],
  ['{}',{'Content-Length':'-1'}],['{}',{'Content-Length':'3'}],['{"user":',{}],['null extra',{}],
  [new Uint8Array([0xff,0xfe]),{}]]){
  const x=fixture({},()=>new Response(body,{headers:{'Content-Type':'application/json',...headers}}));
  const r=await x.run();assert.equal(r.code,'UNEXPECTED_RESPONSE');noGrant(r);
 }
});

test('decoded JSON may be larger than its compressed content length, while streamed bytes stay bounded',async()=>{
 const x=fixture({},index=>reply(index===0?{user:{permissionId:config.expectedPermissionId}}:
  metadata(index===1?config.uploadFolderId:config.processingFolderId),{
   headers:{'Content-Type':'application/json; charset=utf-8','Content-Encoding':'gzip','Content-Length':'12'}}));
 assert.equal((await x.run()).ok,true);
});

test('raw provider exceptions and extra metadata cannot leak through either report',async()=>{
 const x=fixture({},()=>{throw new Error(config.accessToken+' private customer data');});
 const r=await x.run();assert.equal(r.code,'READ_FAILED');noGrant(r);
 const y=fixture({},index=>reply(index===0?{user:{permissionId:config.expectedPermissionId,emailAddress:'private@example.invalid'}}:
  {...metadata(index===1?config.uploadFolderId:config.processingFolderId),name:'private customer name',webViewLink:'https://private.invalid'}));
 const success=await y.run();assert.equal(success.ok,true);assert.equal(JSON.stringify(success).includes('private'),false);noGrant(success);
});

test('an unresponsive transport is bounded even when it ignores AbortSignal',async t=>{
 await load();t.mock.timers.enable({apis:['setTimeout']});
 const x=fixture({},()=>new Promise(()=>{}));const pending=x.run();await flush();
 assert.equal(x.requests.length,1);t.mock.timers.tick(12000);
 const r=await pending;assert.equal(r.code,'TIMEOUT');assert.equal(r.step,'identity');noGrant(r);
 assert.equal(x.requests[0].options.signal.aborted,true);
});

test('a stalled streamed body is cancelled within the same deadline',async t=>{
 await load();t.mock.timers.enable({apis:['setTimeout']});let cancelled=false;
 const x=fixture({},()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},
  cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}}));
 const pending=x.run();await flush();t.mock.timers.tick(12000);
 const r=await pending;await flush();assert.equal(r.code,'TIMEOUT');assert.equal(cancelled,true);noGrant(r);
});

test('identity and both folder reads share one deadline; late replies cannot continue the check',async t=>{
 await load();t.mock.timers.enable({apis:['setTimeout']});const release=[];let cancelled=false;
 const x=fixture({},()=>new Promise(resolve=>release.push(resolve)));
 const pending=x.run();await flush();assert.equal(release.length,1);
 t.mock.timers.tick(4000);release[0](reply({user:{permissionId:config.expectedPermissionId}}));await flush();assert.equal(release.length,2);
 t.mock.timers.tick(4000);release[1](reply(metadata(config.uploadFolderId)));await flush();assert.equal(release.length,3);
 t.mock.timers.tick(4000);const r=await pending;assert.equal(r.code,'TIMEOUT');assert.equal(r.step,'processing');noGrant(r);
 release[2]({body:{cancel(){cancelled=true;}}});await flush();assert.equal(cancelled,true);assert.equal(x.requests.length,3);
});

test('a late rejected transport is consumed without changing a completed timeout report',async t=>{
 await load();t.mock.timers.enable({apis:['setTimeout']});let reject;
 const x=fixture({},()=>new Promise((_,r)=>{reject=r;}));
 const pending=x.run();await flush();t.mock.timers.tick(12000);const result=await pending;
 reject(new Error(config.accessToken));await flush();assert.equal(result.code,'TIMEOUT');assert.equal(x.requests.length,1);noGrant(result);
});

test('CLI missing configuration and invalid arguments exit nonzero without echoing private input',()=>{
 const script=resolve(__dirname,'../n8n/package-payment/check-folders.mjs');
 const env={...process.env,SMA_GOOGLE_DRIVE_READ_TOKEN:'',SMA_GOOGLE_DRIVE_EXPECTED_PERMISSION_ID:''};
 for(const args of [[config.uploadFolderId,config.processingFolderId],['private.invalid'],
  [config.uploadFolderId,config.processingFolderId,'do-not-echo-this']]){
  const result=spawnSync(process.execPath,[script,...args],{env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);const output=result.stdout+result.stderr;
  for(const value of args)assert.equal(output.includes(value),false);
  if(args.length===2)assert.equal(JSON.parse(result.stdout).code,'INVALID_CONFIGURATION');
 }
});
