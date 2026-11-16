const test=require('node:test');
const assert=require('node:assert/strict');
const imported=import('../app/assets/publication-tab-draft.mjs');
const key='sma.publication.pending-save.v2.youtube:fixture-owner:'+encodeURIComponent('[null,"file",null,null]');
function record(){
 return {kind:'edit',token:'60600000-0000-4000-8000-000000000001',owner:'fixture-owner',portal:'youtube',route:'[null,"file",null,null]',
  fileId:'60600000-0000-4000-8000-000000000002',fileRevision:'version:1',previewId:'60600000-0000-4000-8000-000000000003',
  assignment:2,revision:3,shop:'https://sma-automation.com/app/shop.html?shop=fixture',
  base:{title:'Gespeicherter Titel',body:'Gespeicherter Beitrag.',hashtags:['SMA'],product_id:null},
  form:{title:'Lokaler Titel',body:'Noch nicht gesendeter Beitrag.',tags:'#SMA #Noch-offen',source:{text:'Eigene Beobachtung.',language:'de'}}};
}
async function fixture(){
 const {tabDraftStore}=await imported,rows=new Map(),handlers=new Set();let fail=false;
 const win={sessionStorage:{get length(){return rows.size;},key:i=>[...rows.keys()][i]??null,
  getItem:k=>rows.get(k)??null,setItem(k,v){if(fail)throw Error('quota');rows.set(k,v);},removeItem:k=>rows.delete(k)},
  addEventListener:(name,fn)=>{assert.equal(name,'beforeunload');handlers.add(fn);},removeEventListener:(_name,fn)=>handlers.delete(fn)};
 return {store:tabDraftStore(win),rows,handlers,fail:v=>{fail=v;}};
}
test('edit checkpoints preserve bounded raw form fields without a sent payload',async()=>{
 const f=await fixture(),v=record();f.store.write(v);
 const saved=f.store.read(v.portal,v.owner,v.route);
 assert.equal(saved.kind,'edit');assert.equal(saved.sent,undefined);assert.deepEqual(saved.form,v.form);
 assert.equal(f.handlers.size,0);assert.equal(f.store.read(v.portal,'other-owner',v.route),null);assert.equal(f.rows.size,1);
 f.store.clearOwner(v.owner);assert.equal(f.rows.size,0);
});
test('a failed ordinary checkpoint retains its last copy and uses the existing leave warning',async()=>{
 const f=await fixture(),v=record();f.store.write(v);const previous=f.rows.get(key);
 f.fail(true);v.form.body='Neuerer, noch nicht sicherer Zwischenstand.';f.store.update(v);
 assert.equal(f.rows.get(key),previous);assert.equal(f.handlers.size,1);
 const leave={prevented:false,preventDefault(){this.prevented=true;}};for(const fn of f.handlers)fn(leave);
 assert.equal(leave.prevented,true);assert.equal(leave.returnValue,'');
 f.fail(false);f.store.update(v);assert.equal(f.handlers.size,0);
 assert.equal(f.store.read(v.portal,v.owner,v.route).form.body,v.form.body);
 f.store.forget(v);assert.equal(f.rows.size,0);
});
test('untrusted checkpoint kinds and source metadata cannot be restored',async()=>{
 for(const change of [v=>v.kind='saved',v=>v.sent=v.base,v=>v.form.source.text='x'.repeat(8001),
  v=>v.form.source.language='foreign',v=>v.form.source.asset_id='foreign',v=>v.form.source=null]){
  const f=await fixture(),v=record();f.store.write(v);change(v);f.store.write(v);
  assert.equal(f.store.read(v.portal,v.owner,v.route),null);assert.equal(f.rows.size,0);
 }
});
test('a save attempt cannot fall back to an older unsent-edit checkpoint after storage fails',async()=>{
 const f=await fixture(),v=record();f.store.write(v);f.fail(true);
 const saving={...v,sent:v.base};delete saving.kind;f.store.write(saving);
 assert.equal(f.store.read(v.portal,v.owner,v.route),null);assert.equal(f.rows.size,0);assert.equal(f.handlers.size,1);
 f.store.clearOwner(v.owner);assert.equal(f.handlers.size,0);
});
