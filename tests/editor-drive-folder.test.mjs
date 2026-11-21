import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createFolderHandler} from '../supabase/functions/sma-editor-drive-folder/handler.mjs';

const owner='40000000-0000-4000-8000-000000000001';
const ticket='40000000-0000-4000-8000-000000000002';
const binding={row:4,ref:'preview-customer',email:'test@example.invalid'};
const account={id:4,kunde_id:binding.ref,kunde_email:binding.email,zugang_aktiv:true,demo_delta_aktiv:true,
 upload_folder_id:'test_folder_upload',processing_folder_id:'test_processing_folder'};
function fixture({identity=owner, bound=()=>binding, row=account}={}){
 const calls=[];
 const handle=createFolderHandler({
  identify:async()=>identity,
  binding:async(id,reserve)=>{assert.equal(id,owner);calls.push(reserve?'reserve':'verify');return bound(reserve);},
  issueAccountTicket:async data=>{assert.deepEqual(data,binding);calls.push('account ticket');return ticket;},
  readAccount:async key=>{assert.equal(key,ticket);calls.push('read account');return {ok:true,value:row};}
 });
 const send=(body,method='POST',origin='https://sma-automation.com')=>handle(new Request('https://private.example.invalid',{
  method,headers:{Origin:origin,Authorization:'Bearer '+'a'.repeat(30)},body}));
 return {send,calls};
}
test('only a confirmed active row supplies its own upload folder',async()=>{
 const {send,calls}=fixture();
 const r=await send();assert.equal(r.status,200);assert.deepEqual(await r.json(),{folder_id:account.upload_folder_id});
 assert.deepEqual(calls,['reserve','account ticket','read account','verify']);
});
test('no worker read for invalid caller, ambiguous owner, throttling, client-supplied arguments or foreign origin',async()=>{
 for(const [f,invoke,status] of [
  [fixture({identity:null}),x=>x.send(),401],[fixture({bound:()=>null}),x=>x.send(),403],
  [fixture({bound:()=>({code:'RATE_LIMITED'})}),x=>x.send(),429],[fixture(),x=>x.send('{"op":"other"}'),400],
  [fixture(),x=>x.send(undefined,'GET'),405],[fixture(),x=>x.send(undefined,'POST','https://example.invalid'),403]
 ]){assert.equal((await invoke(f)).status,status);assert.ok(!f.calls.includes('account ticket'));}
});
test('mismatched rows, inactive access, swapped binding and malformed paths are denied',async()=>{
 const cases=[{row:{...account,id:7}},{row:{...account,kunde_email:'other@example.invalid'}},{row:{...account,kunde_id:'different'}},
  {row:{...account,zugang_aktiv:false}},{row:{...account,demo_delta_aktiv:false}},
  {row:{...account,upload_folder_id:'https://other.example.invalid'}},{row:{...account,processing_folder_id:account.upload_folder_id}},
  {bound:reserve=>reserve?binding:{...binding,row:5}}];
 for(const data of cases){
  const response=await fixture(data).send();assert.equal(response.status,403);assert.equal((await response.json()).code,'FOLDER_UNAVAILABLE');
 }
});

test('SQL binds onboarded and legacy accounts, enforces scope, blocks stale or conflicting mappings and limits costly reads',async()=>{
 const {PGlite}=await import('./sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
 const {readFile}=await import('node:fs/promises');
 const db=new PGlite();
 try {
  await db.exec(`create schema auth;create schema sma_private;create role anon;create role authenticated;create role service_role;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create table public.sma_kunden(id bigint primary key,user_id uuid,kunde_email text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,n8n_kunde_id text);
   create table sma_private.onboarding_plan_choices_v1(customer_id bigint,user_id uuid,n8n_ref text,n8n_link_email text,n8n_row_id bigint);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261121031200_editor_drive_folder_v1.sql',import.meta.url),'utf8'));
  await db.exec(`create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table sma_private.publication_files_v1(id uuid,revision text,name text,mime_type text,media_kind text,duration_ms bigint,width_px int,height_px int,
   modified_at timestamptz,size_bytes bigint,user_id uuid,customer_id bigint,available boolean,drive_file_id text);`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261121032000_editor_drive_file_selection_v1.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1,$2,now())',[owner,binding.email]);
  await db.query('insert into public.sma_kunden values(1,$1,$2,true,true,false,$3)',[owner,binding.email,binding.ref]);
  const get=async(reserve=false)=>(await db.query('select public.sma_editor_drive_binding_v1($1,$2) as b',[owner,reserve])).rows[0].b;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.query("insert into sma_private.publication_files_v1 values($1,'r1','Video.mp4','video/mp4','video',4000,720,1280,now(),200,$2,1,true,'test_drive_file')",[ticket,owner]);
  const find=async()=>(await db.query("select public.sma_editor_drive_file_v1('test_drive_file') as r")).rows[0].r;
  assert.equal((await find()).files[0].id,ticket);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ticket]);
  assert.deepEqual(await find(),{ok:false,code:'FILE_UNAVAILABLE'});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.exec('update sma_private.publication_files_v1 set available=false');
  assert.deepEqual(await find(),{ok:false,code:'FILE_UNAVAILABLE'});
  assert.equal(await get(),null);
  await db.query('insert into sma_private.editor_drive_legacy_rows_v1 values(1,$1,$2,$3,4)',[owner,binding.ref,binding.email]);
  assert.deepEqual(await get(true),binding);assert.deepEqual(await get(true),{code:'RATE_LIMITED'});
  assert.deepEqual(await get(),binding);
  await db.query('insert into sma_private.onboarding_plan_choices_v1 values(1,$1,$2,$3,8)',[owner,binding.ref,binding.email]);
  assert.equal(await get(),null);
  await db.exec('delete from sma_private.editor_drive_legacy_rows_v1');
  assert.deepEqual(await get(),{...binding,row:8});
  await db.exec('update public.sma_kunden set aktiv=false');assert.equal(await get(),null);
  await db.exec("update public.sma_kunden set aktiv=true,kunde_email='swapped@example.invalid'");assert.equal(await get(),null);
  const priv=(await db.query("select has_function_privilege('authenticated','public.sma_editor_drive_binding_v1(uuid,boolean)','execute') as allowed")).rows[0];
  assert.equal(priv.allowed,false);
 } finally {await db.close();}
});
