'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {confirmationSqlAfterFolders}=require('../n8n/confirm-onboarding-row.cjs');

const reference='kunde_'+'a'.repeat(32);
const token='synthetic-no-live-drive-token';
const permission='synthetic_sma_drive_identity';
const upload='synthetic_customer_upload_folder';
const processing='synthetic_customer_processing_folder';
const folder=id=>({id,mimeType:'application/vnd.google-apps.folder',trashed:false,
  capabilities:{canListChildren:true,canAddChildren:true}});
const safeRow=()=>({
  id:42,kunde_id:reference,kunde_email:"pilot+o'hara@example.invalid",paket:null,
  zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false,
  zugangs_token_vorhanden:false,zugangs_link_vorhanden:false,
  mollie_customer_id_vorhanden:false,mollie_subscription_id_vorhanden:false,
  upload_folder_id:upload,processing_folder_id:processing
});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
function fixture({about={user:{permissionId:permission}},input=folder(upload),output=folder(processing)}={}){
 const calls=[];
 const fetchImpl=async (raw,options)=>{
  const url=new URL(raw);
  calls.push({url,options});
  assert.equal(url.hostname,'www.googleapis.com');
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  assert.equal(options.credentials,'omit');
  assert.equal(options.body,undefined);
  assert.equal(options.headers.Authorization,'Bearer '+token);
  assert.equal(options.headers.Accept,'application/json');
  if(url.pathname==='/drive/v3/about')return response(about);
  if(url.pathname==='/drive/v3/files/'+upload)return response(input);
  if(url.pathname==='/drive/v3/files/'+processing)return response(output);
  throw Error('Unexpected provider route');
 };
 return {calls,fetchImpl};
}
const run=(row,fetchImpl,options={})=>confirmationSqlAfterFolders(reference,row,{
  accessToken:token,expectedPermissionId:permission,fetchImpl,...options
});
const decode=sql=>JSON.parse(Buffer.from(/decode\('([0-9a-f]+)', 'hex'\)/.exec(sql)[1],'hex').toString('utf8'));

test('Exactly three Drive metadata GETs gate operator SQL; no secret or folder ID enters it',async()=>{
 const f=fixture();const row=safeRow(),sql=await run(row,f.fetchImpl);
 assert.equal(f.calls.length,3);
 assert.deepEqual(f.calls.map(c=>c.url.pathname),[
  '/drive/v3/about','/drive/v3/files/'+upload,'/drive/v3/files/'+processing
 ]);
 assert.equal(f.calls[0].url.searchParams.get('fields'),'user(permissionId)');
 assert.equal(f.calls[1].url.searchParams.get('supportsAllDrives'),'true');
 assert.equal(f.calls[2].url.searchParams.get('supportsAllDrives'),'true');
 assert.deepEqual(decode(sql),[{
   id:row.id,kunde_id:reference,kunde_email:row.kunde_email,paket:null,
   zugang_aktiv:false,zahlung_bestaetigt:false,demo_delta_aktiv:false
 }]);
 for(const sensitive of [token,permission,upload,processing,row.kunde_email])
  assert.ok(!sql.includes(sensitive),'No private Drive or customer field outside encoded evidence');
});

test('Absent credentials, invalid/matched folder IDs or active row reject linking before any GET',async()=>{
 for(const row of [
  {...safeRow(),upload_folder_id:''},{...safeRow(),processing_folder_id:upload},
  {...safeRow(),processing_folder_id:'../invalid'},{...safeRow(),zugang_aktiv:true},
  {...safeRow(),mollie_customer_id_vorhanden:true}
 ]){
  const f=fixture();
  await assert.rejects(run(row,f.fetchImpl),/Kundenordner|Status|Zeile/);
  assert.equal(f.calls.length,0);
 }
 const f=fixture();
 await assert.rejects(run(safeRow(),f.fetchImpl,{accessToken:''}),/INVALID_CONFIGURATION/);
 assert.equal(f.calls.length,0);
});

test('Foreign Google identity cannot inspect customer folders or produce SQL',async()=>{
 const f=fixture({about:{user:{permissionId:'another_identity'}}});
 await assert.rejects(run(safeRow(),f.fetchImpl),/ACCOUNT_MISMATCH/);
 assert.equal(f.calls.length,1);
});

test('Unavailable, trashed, nonfolder or nonwritable processing directory blocks linking',async()=>{
 for(const out of [
  {...folder(processing),trashed:true},
  {...folder(processing),mimeType:'video/mp4'},
  {...folder(processing),capabilities:{canListChildren:true,canAddChildren:false}},
  {...folder(processing),capabilities:{canListChildren:false,canAddChildren:true}}
 ]){
  const f=fixture({output:out});
  await assert.rejects(run(safeRow(),f.fetchImpl),/FOLDER_UNAVAILABLE|PROCESSING_NOT_WRITABLE/);
  assert.equal(f.calls.length,3);
 }
 const f=fixture({input:{...folder(upload),trashed:true}});
 await assert.rejects(run(safeRow(),f.fetchImpl),/FOLDER_UNAVAILABLE/);
 assert.equal(f.calls.length,2);
});

test('Customer-owned input folder may lack service upload write permission but must remain readable',async()=>{
 const f=fixture({input:{...folder(upload),capabilities:{
  canListChildren:true,canAddChildren:false
 }}});
 const sql=await run(safeRow(),f.fetchImpl);
 assert.equal(f.calls.length,3);
 assert.match(sql,/^select sma_private\.confirm_onboarding_n8n_v1\(/);
});

test('Network errors and unexpected metadata cannot become a SQL confirmation or leak credentials',async()=>{
 const cases=[
  ()=>{throw Error('SENSITIVE_'+token);},
  ()=>new Response('bad-json',{headers:{'content-type':'application/json'}}),
  ()=>new Response('{}',{status:503,headers:{'content-type':'application/json'}}),
  ()=>new Response('{}',{status:200,headers:{'content-type':'text/html'}})
 ];
 for(const failure of cases){
  const f=fixture();let calls=0;
  const fetchImpl=async()=>{calls++;return failure();};
  await assert.rejects(run(safeRow(),fetchImpl),error=>{
    assert.doesNotMatch(error.message,/SENSITIVE|synthetic-no-live-drive-token|synthetic_customer_/);
    assert.match(error.message,/READ_FAILED|READ_UNAVAILABLE|UNEXPECTED_RESPONSE/);
    return true;
  });
  assert.equal(calls,1);
 }
});
