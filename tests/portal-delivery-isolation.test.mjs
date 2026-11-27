import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryMonitor} from '../app/assets/portal-delivery-monitor.mjs';

test('a blocked file refreshes Drive without delaying a different file or applying stale feedback',async()=>{
 let release,active=true,refreshes=0;
 const rpc=(name,args)=>{
  if(name==='sma_refresh_portal_folder_v1'){assert.equal(args.p_platform,'tiktok');refreshes++;return Promise.resolve({});}
  assert.equal(args.p_input.id,'first');return new Promise(resolve=>{release=resolve;});
 };
 const monitor=createDeliveryMonitor({rpc,platform:'tiktok',ownsOrder:()=>false});
 const first=monitor.describe({order:'first',state:'blocked'},'first',()=>active,()=>assert.fail());
 active=false;
 const second=await monitor.describe({order:'second',state:'ready_to_send',can_send:true},null,()=>true,()=>assert.fail());
 assert.equal(refreshes,1);assert.equal(second.locked,false);assert.equal(second.progress,false);
 release({blockers:['FILE_REFRESH_REQUIRED']});assert.equal(await first,null);
});
test('only an explicitly retryable empty initialisation unlocks the post action',async()=>{
 const monitor=createDeliveryMonitor({platform:'tiktok',ownsOrder:()=>false,rpc:async()=>assert.fail()});
 const receipt={state:'uncertain',order:'first',provider_code:'PROVIDER_INIT_UNCERTAIN',bytes:0,can_send:true,pending:false};
 const read=r=>monitor.describe(r,'first',()=>true,()=>assert.fail());
 assert.deepEqual(await read(receipt),{text:'TikTok hat den Uploadstart nicht bestätigt. Es wurden 0 Bytes übertragen. Du kannst den Versand erneut starten.',locked:false,progress:false});
 for(const overrides of [{bytes:14},{can_send:false},{provider_code:'TRANSFER_UNCERTAIN'}]){
  assert.equal((await read({...receipt,...overrides})).locked,true);
 }
});
