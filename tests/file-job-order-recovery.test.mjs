import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
const sourceModule=name=>process.env.SMA_ORDER_RECOVERY_SOURCE_ROOT
  ?pathToFileURL(resolve(process.env.SMA_ORDER_RECOVERY_SOURCE_ROOT,'app/assets',name))
  :new URL('../app/assets/'+name,import.meta.url);
const {installOrderReview}=await import(sourceModule('publication-order.mjs').href);
const {createFileJobClient,fileJobAnchor}=await import(sourceModule('file-job-client.mjs').href);

const id=n=>'ad990000-0000-4000-8000-'+String(n).padStart(12,'0');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

// Exercise the real order dialog and command client together. All external
// effects are synthetic; even an accidental approval fails this fixture.
function fixture(t,{platform='youtube',firstCode='TARGET_CHECK_UNAVAILABLE',firstStatus=200,
  firstState='failed',withResponse=true,unknownTransport=false}={}){
  const owner=id(1),jobId=id(2),orderId=id(3),expires_at=new Date(Date.now()+1800000).toISOString();
  const binding={asset_id:id(4),asset_revision:'version:1',platform,preview_id:id(5),preview_revision:1,assignment_revision:1};
  const choices=platform==='youtube'?{visibility:'private',made_for_kids:false,contains_synthetic_media:true}:
    {visibility:'SELF_ONLY',is_aigc:true,disable_comment:true,disable_duet:true,disable_stitch:true,brand_organic_toggle:false,brand_content_toggle:false};
  const post={title:'Synthetic title',caption:'Synthetic caption'};
  const initial={ok:true,id:orderId,binding,choices,state:'preparing',approved_at:null,target:null,account_check:null,
    approval_token:null,approval_window:null,preparation_window:{status:'active',expires_at},
    can_upload:false,can_publish:false,draft:post};
  let stored=structuredClone(initial),currentBinding=structuredClone(binding),upstreamRecovered=false,sequence=10,nextReadGate=null;
  const calls=[],reads=[],adapterCalls=[],receipts=new Map();
  const session=async()=>({user:{id:owner},access_token:'synthetic-session'});
  const prepared=()=>({...initial,state:'prepared',target:{id:'synthetic-channel',platform},
    account_check:{target_id:'synthetic-channel',platform,display_name:'Synthetic'},
    approval_token:'synthetic-token',approval_policy:'media-consent-2026-11-03.1',
    approval_window:{status:'active',expires_at},preparation_window:null});
  const fileJobs=createFileJobClient({session,uuid:()=>id(++sequence),
    // End a synthetic pending poll without sleeping or contacting a service.
    wait:async()=>{throw Error('Synthetic status connection unavailable');},
    fetcher:async(url,options)=>{
      const input=JSON.parse(options.body);calls.push({url,input});
      const view={ok:true,job_id:jobId,state:'waiting',deadline_at:new Date(Date.now()+86400000).toISOString()};
      if(input.p_action==='start')return Response.json({...view,commands:[]});
      if(input.p_action==='get'){
        if(unknownTransport)throw Error('Synthetic authoritative status unavailable');
        return Response.json({...view,commands:[receipts.get(input.p_input.command_id)].filter(Boolean)});
      }
      assert.equal(input.operation,'order_prepare','The customer has not approved a publication');
      if(unknownTransport)throw Error('Synthetic lost Edge acknowledgement');
      const isRetry=calls.filter(c=>!c.input.p_action).length>1;
      if(isRetry&&upstreamRecovered){
        stored=prepared();
        receipts.set(input.command_id,{command_id:input.command_id,operation:input.operation,state:'completed',
          response:{status:200,body:stored}});
      }else{
        receipts.set(input.command_id,{command_id:input.command_id,operation:input.operation,state:firstState,
          response:withResponse?{status:firstStatus,body:{ok:false,can_upload:false,can_publish:false,code:firstCode}}:null});
      }
      return Response.json({ok:true,job_id:jobId,command_id:input.command_id});
    }});
  const {document:doc}=parseHTML('<html><head></head><body></body></html>'),create=doc.createElement.bind(doc);
  doc.createElement=tag=>{
    const element=create(tag);element.handlers={};
    element.addEventListener=(name,handler)=>{element.handlers[name]=handler;};
    if(tag==='dialog'){element.showModal=()=>{element.open=true;};element.close=()=>{element.open=false;};}
    if(tag==='form')element.reportValidity=()=>true;
    if(tag==='select')Object.defineProperty(element,'value',{get(){return this.selectedValue||'';},set(value){this.selectedValue=value;}});
    if(tag==='input')element.checked=false;
    return element;
  };
  const view=installOrderReview(doc,{host:doc.body,portalName:platform,session,
    readStoredOrder:async order=>{
      reads.push(order);
      if(nextReadGate){const gate=nextReadGate;nextReadGate=null;gate.started.resolve();await gate.release.promise;}
      return structuredClone(stored);
    },getContext:()=>({binding:currentBinding,name:'Synthetic.mp4',post}),verifySavedDraft:async()=>{},refresh:async()=>{},
    // Match the production publication-preview.js adapter, including its
    // explicit retry option. The supplied command and dialog are unmodified.
    command:async(action,input,current,options={})=>{
      adapterCalls.push({action,input,options});
      const operations={account:'account',prepare:'order_prepare',approve:'order_approve'};
      assert.equal(action,'prepare','Status recovery must not call an account or approval workflow');
      return fileJobs.request({anchor:fileJobAnchor(current),operation:operations[action],input,timeoutMs:1000,
        ...(options.retryAfter?{retryAfter:options.retryAfter}:{})});
    }});
  t.after(()=>{
    view.clear();fileJobs.clear();
    assert.ok(calls.filter(call=>!call.input.p_action).every(call=>call.input.operation==='order_prepare'),
      'Recovery never requests an approval, media operation or another workflow action');
  });
  assert.equal(view.resumePrepared(structuredClone(stored)),true);
  const button=label=>[...doc.querySelectorAll('button')].find(element=>element.textContent===label);
  const check=button('Zielkonto prüfen'),status=button('Status erneut laden'),approve=button('Veröffentlichung freigeben');
  return {doc,view,calls,reads,adapterCalls,check,status,approve,binding,jobId,orderId,
    checkTarget:()=>check.handlers.click(),readStatus:()=>status.handlers.click(),
    notice:()=>doc.querySelector('#publicationOrderDialog [role=status]').textContent,
    edges:()=>calls.filter(call=>!call.input.p_action).map(call=>call.input),
    starts:()=>calls.filter(call=>call.input.p_action==='start'),
    recover:()=>{upstreamRecovered=true;},state:()=>stored.state,
    patchStored:patch=>{stored={...stored,...patch};},changeBinding:patch=>{currentBinding={...currentBinding,...patch};},
    holdNextRead:()=>{const gate={started:deferred(),release:deferred()};nextReadGate=gate;return gate;}};
}

for(const platform of ['youtube','tiktok'])test(`${platform}: explicit target retry recovers a confirmed failure in the same order and file job`,async t=>{
  const f=fixture(t,{platform});
  await f.checkTarget();
  assert.equal(f.edges().length,1);
  assert.match(f.notice(),/Bitte versuche es später erneut/);
  assert.equal(f.check.disabled,false);
  f.recover();
  await f.checkTarget();
  assert.equal(f.edges().length,2,'An explicit retry needs a new command after the confirmed target-check failure');
  assert.equal(f.starts().length,1,'The existing file job must remain the parent');
  const [first,second]=f.edges();
  assert.notEqual(second.command_id,first.command_id);
  assert.equal(second.job_id,first.job_id);
  assert.deepEqual(second.input,first.input,'The order identity, file binding and choices must be preserved');
  assert.equal(second.input.id,f.orderId);
  assert.equal(f.state(),'prepared');
  assert.match(f.notice(),/Zielkonto und gespeicherter Text sind zugeordnet/);
  assert.equal(f.check.hidden,true);
  assert.equal(f.approve.hidden,false);
  assert.equal(f.approve.disabled,true,'Recovery cannot approve the customer’s publication');
  assert.equal(f.doc.getElementById('order-final-consent').checked,false);
  await f.approve.handlers.click();
  assert.deepEqual(f.edges().map(command=>command.operation),['order_prepare','order_prepare']);
});

test('status refresh and reopening only read a pending order after a confirmed target failure',async t=>{
  const f=fixture(t);
  await f.readStatus();
  assert.equal(f.edges().length,0);
  await f.checkTarget();f.recover();
  await f.readStatus();await f.readStatus();
  assert.equal(f.edges().length,1);
  assert.equal(f.state(),'preparing');
  const close=[...f.doc.querySelectorAll('button')].find(element=>element.textContent==='Schließen');
  close.handlers.click();
  await f.doc.getElementById('preparePublicationOrder').handlers.click();
  assert.equal(f.edges().length,1);
  assert.equal(f.adapterCalls.length,1,'Read-only recovery must never request a replacement command');
});

test('two target-check clicks share one deliberate retry while its stored order is being checked',async t=>{
  const f=fixture(t);await f.checkTarget();f.recover();
  const gate=f.holdNextRead(),readsBefore=f.reads.length;
  const retry=f.checkTarget();await gate.started.promise;
  const duplicate=f.checkTarget();
  assert.equal(f.check.disabled,true);
  assert.equal(f.reads.length,readsBefore+1);
  gate.release.resolve();await Promise.all([retry,duplicate]);
  assert.equal(f.edges().length,2);
  assert.equal(f.starts().length,1);
  assert.equal(f.state(),'prepared');
});

for(const state of ['queued','running','uncertain','failed'])test(`command state ${state} is retained during an explicit target check`,async t=>{
  const f=fixture(t,{firstState:state,withResponse:false});
  await f.checkTarget();f.recover();
  await f.checkTarget();
  assert.equal(f.edges().length,1,'An incomplete or uncertain receipt cannot authorize replacement work');
  assert.equal(f.starts().length,1);
  assert.equal(f.state(),'preparing');
  assert.equal(f.approve.disabled,true);
});

test('a public target failure observed before the worker finishes is not yet retryable',async t=>{
  const f=fixture(t,{firstState:'running'});
  await f.checkTarget();f.recover();await f.checkTarget();
  assert.equal(f.edges().length,1);
  assert.equal(f.state(),'preparing');
  assert.equal(f.approve.disabled,true);
});

test('an unknown transport outcome retains its command when authoritative status is unavailable',async t=>{
  const f=fixture(t,{unknownTransport:true});
  await f.checkTarget();f.recover();await f.checkTarget();
  assert.equal(f.edges().length,1);
  assert.equal(f.starts().length,1);
  assert.equal(f.state(),'preparing');
  assert.equal(f.approve.disabled,true);
});

for(const options of [{firstCode:'TARGET_REFRESH_UNCERTAIN'},{firstCode:'TARGET_CHECK_RUNNING'},
  {firstCode:'FILE_REFRESH_REQUIRED'},{firstCode:'TARGET_CHECK_UNAVAILABLE',firstStatus:503}]){
  test(`target retry cannot replace ${options.firstCode} with HTTP ${options.firstStatus||200}`,async t=>{
    const f=fixture(t,options);await f.checkTarget();f.recover();await f.checkTarget();
    assert.equal(f.edges().length,1);
    assert.equal(f.starts().length,1);
    assert.equal(f.state(),'preparing');
    assert.equal(f.approve.disabled,true);
  });
}

for(const [name,patch] of [
  ['cancelled',{state:'cancelled',preparation_window:null}],
  ['expired',{preparation_window:{status:'expired',expires_at:new Date(0).toISOString()}}],
  ['changed choices',{choices:{visibility:'public'}}],
  ['changed saved binding',{binding:{asset_id:id(99),asset_revision:'version:2',platform:'youtube'}}],
  ['recorded check error',{check_error:'FILE_CHANGED'}],
])test(`stored order with ${name} status cannot trigger replacement target work`,async t=>{
  const f=fixture(t);await f.checkTarget();f.recover();f.patchStored(patch);await f.checkTarget();
  assert.equal(f.edges().length,1);
  assert.equal(f.approve.disabled,true);
});

test('changing the current file while a retry reads the saved order prevents another command',async t=>{
  const f=fixture(t);await f.checkTarget();f.recover();
  const gate=f.holdNextRead(),retry=f.checkTarget();await gate.started.promise;
  f.changeBinding({asset_id:id(98)});gate.release.resolve();await retry;
  assert.equal(f.edges().length,1);
  assert.equal(f.approve.disabled,true);
});

test('clearing the account while a retry reads its saved order prevents another command',async t=>{
  const f=fixture(t);await f.checkTarget();f.recover();
  const gate=f.holdNextRead(),retry=f.checkTarget();await gate.started.promise;
  f.view.clear();f.calls.length=0;gate.release.resolve();await retry;
  assert.equal(f.edges().length,0);
  assert.equal(f.doc.getElementById('publicationOrderDialog').open,false);
});
