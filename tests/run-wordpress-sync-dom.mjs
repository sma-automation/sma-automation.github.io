import assert from 'node:assert/strict';
import {parseHTML} from './dom-runtime/node_modules/linkedom/esm/index.js';
import {mountWordpressConnection} from '../app/assets/wordpress-connection.mjs';
import {mountWordpressSync} from '../app/assets/wordpress-sync.mjs';
const tick=()=>new Promise(r=>setImmediate(r)),attempt='ac990000-0000-4000-8000-000000000001',website='https://example.com/';
const syncState={ok:true,attempt_id:attempt,website_url:website,state:'idle',can_synchronize:true,can_publish:false,post_id:null,revision:null,completed_at:null,edit_url:null,last_error:null,retry_after:null};
{
 const {document:doc}=parseHTML('<html><body><main></main></body></html>'),root=doc.querySelector('main');const calls=[];let synced=false;
 const view=mountWordpressConnection({root,getOwnerId:async()=>'owner',request:async(action)=>({ok:true,state:action==='revoke'?'revoked':'verified',revision:1,attempt_id:attempt,website_url:website,can_synchronize:false,can_publish:false}),syncRequest:async(action,input)=>{
  calls.push({action,input});if(action==='sync')synced=true;
  return synced?{...syncState,state:'draft',can_synchronize:false,post_id:42,revision:1,completed_at:'2026-11-04T14:00:00Z',edit_url:website+'wp-admin/post.php?post=42&action=edit'}:syncState;
 }});
 view.setDraft({draft:{mode:'existing',website_url:website}});assert.equal(root.querySelector('[data-wp-sync]').hidden,true);
 await view.load();await tick();assert.equal(root.querySelector('[data-wp-sync]').hidden,false);assert.equal(root.querySelector('[data-sync-start]').disabled,false);
 assert.deepEqual(calls.map(c=>c.action),['status'],'connection checks do not create a product draft');
 root.querySelector('[data-sync-start]').click();await tick();assert.equal(calls.at(-1).action,'sync');assert.equal(calls.at(-1).input.attempt_id,attempt);
 assert.equal(root.querySelector('[data-sync-edit]').href,website+'wp-admin/post.php?post=42&action=edit');assert.equal(root.querySelector('[data-sync-start]').hidden,true);
 // Parent controls must never re-enable a blocked or unavailable child action.
 root.querySelector('[data-wp-reload]').click();await tick();assert.equal(root.querySelector('[data-sync-start]').disabled,true);
 root.querySelector('[data-wp-revoke]').click();await tick();assert.equal(root.querySelector('[data-wp-sync]').hidden,true);assert.equal(root.querySelector('[data-sync-edit]').hasAttribute('href'),false);
 view.destroy();assert.equal(root.children.length,0);
}
{
 const {document:doc}=parseHTML('<html><body><section></section></body></html>'),root=doc.querySelector('section');let calls=0;
 const view=mountWordpressSync({root,getOwnerId:async()=>'owner',request:async()=>{calls++;return {...syncState,state:'blocked',can_synchronize:false,last_error:'PAGE_CHANGED'};}});
 view.setConnection({state:'verified',attemptId:attempt},website);await tick();assert.equal(root.querySelector('[data-sync-start]').disabled,true);assert.equal(root.querySelector('[data-sync-start]').hidden,true);assert.match(root.textContent,/überschreibt ihn nicht/);assert.equal(calls,1);view.destroy();
}
{
 const {document:doc}=parseHTML('<html><body><section></section></body></html>'),root=doc.querySelector('section');let release;
 const view=mountWordpressSync({root,getOwnerId:async()=>'owner',request:()=>new Promise(r=>release=r)});
 view.setConnection({state:'verified',attemptId:attempt},website);await tick();view.invalidate();release(syncState);await tick();assert.equal(root.hidden,true);assert.equal(root.querySelector('[data-sync-start]').disabled,true);view.destroy();
}
console.log('WordPress sync DOM passed: no implicit writes, explicit draft button, fixed result link, preserved disabled state, revoke and stale-result clearing');
