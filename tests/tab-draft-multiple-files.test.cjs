const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(process.env.SMA_DRAFT_SOURCE||'app/assets/publication-tab-draft.mjs','utf8');
const factory=vm.runInNewContext(source.replace('export function tabDraftStore','function tabDraftStore')+';tabDraftStore');
const clone=v=>JSON.parse(JSON.stringify(v));
const uuid=i=>'60600000-0000-4000-8000-'+String(i).padStart(12,'0');
const oldKey=portal=>'sma.publication.pending-save.v1.'+portal;
const newKey=v=>'sma.publication.pending-save.v2.'+v.portal+':'+encodeURIComponent(v.owner)+':'+encodeURIComponent(v.route);
function record(i=1,portal='youtube',owner='fixture-owner'){
 return {kind:'edit',token:uuid(100+i),owner,portal,route:JSON.stringify([null,uuid(i),null,null]),
  fileId:uuid(i),fileRevision:'version:1',previewId:uuid(200+i),assignment:2,revision:3,
  shop:'https://sma-automation.com/app/shop.html?shop=fixture',
  base:{title:'Gespeichert '+i,body:'Gespeicherter Beitrag '+i,hashtags:['SMA'],product_id:null},
  form:{title:'Lokal '+i,body:'Eigene Eingabe '+i,tags:'#SMA #noch-offen',source:{text:'Beschreibung '+i,language:'de'}}};
}
function pending(v){delete v.kind;v.sent={...clone(v.base),body:'Gesendeter Beitrag'};return v;}
function fixture(){
 const entries=new Map(),deniedRemove=new Set();let denyWrite=false;
 const storage={get length(){return entries.size;},key:i=>[...entries.keys()][i]??null,
  getItem:k=>entries.get(k)??null,setItem(k,v){if(denyWrite)throw Error('quota');entries.set(k,v);},
  removeItem(k){if(deniedRemove.has(k))throw Error('denied');entries.delete(k);}};
 function editor(){
  const guards=new Set(),win={sessionStorage:storage,addEventListener:(_name,fn)=>guards.add(fn),removeEventListener:(_name,fn)=>guards.delete(fn)};
  return {store:factory(win),guards};
 }
 return {entries,deniedRemove,editor,failWrites:value=>denyWrite=value,
  read:v=>editor().store.read(v.portal,v.owner,v.route),legacy:v=>entries.set(oldKey(v.portal),JSON.stringify(v))};
}
for(const portal of ['youtube','tiktok'])test(portal+': three simultaneous editors retain independent file checkpoints and later edits',()=>{
 const f=fixture(),records=[1,2,3].map(i=>record(i,portal)),editors=records.map(()=>f.editor());
 records.forEach((v,i)=>editors[i].store.write(v));
 records[0].form.body='A nach B und C weiterbearbeitet';editors[0].store.update(records[0]);
 records[1].form.tags='#rohe ungültige Tags';editors[1].store.update(records[1]);
 for(const v of records)assert.deepEqual(clone(f.read(v).form),v.form);
 assert.equal(f.entries.size,3);assert.equal(editors[0].store.read(portal,records[0].owner,'andere Route'),null);
});
test('saving or discarding file B removes only B while A and C remain recoverable',()=>{
 for(const action of ['save','discard']){
  const f=fixture(),a=record(1),b=record(2),c=record(3),first=f.editor(),second=f.editor(),third=f.editor();
  first.store.write(a);second.store.write(action==='save'?pending(b):b);third.store.write(c);
  second.store.forget(b);b.form.body='Verspätete Eingabe B';second.store.update(b);
  a.form.body='A bleibt nach '+action+' von B erhalten';first.store.update(a);
  assert.equal(f.read(b),null);assert.equal(f.read(a).form.body,a.form.body);assert.equal(f.read(c).token,c.token);
  assert.equal(first.store.matches(a),true);assert.equal(f.entries.size,2);
 }
});
test('quota and invalid writes affect only their own exact route without evicting other files',()=>{
 const f=fixture(),a=record(1),b=pending(record(2)),c=record(3),first=f.editor(),second=f.editor();
 first.store.write(a);second.store.write(b);const beforeA=f.entries.get(newKey(a));f.failWrites(true);
 f.editor().store.write(c);assert.equal(f.read(c),null);assert.equal(f.entries.get(newKey(a)),beforeA);
 b.form.body='Nicht sicherer neuer Text';second.store.update(b);assert.equal(f.read(b).form.body,'Eigene Eingabe 2');
 const incompatible={...b,token:uuid(999),sent:{...b.sent,body:'Anderer Save-Versuch'}};second.store.write(incompatible);
 assert.equal(f.read(b),null);assert.equal(f.entries.get(newKey(a)),beforeA);
 c.form.body='x'.repeat(2401);f.editor().store.write(c);assert.equal(f.entries.get(newKey(a)),beforeA);
 assert.equal(first.guards.size,0);assert.equal(second.guards.size,1);
});
test('different owners and exact routes have isolated keys, including escaped separators',()=>{
 const f=fixture(),a=record(1,'youtube','owner:one'),b=record(1,'youtube','owner%3Aone'),c=record(1,'youtube','owner:one');
 a.route='[null,"a:b",null,null]';b.route=a.route;c.route='[null,"a%3Ab",null,null]';
 for(const v of [a,b,c])f.editor().store.write(v);
 assert.equal(f.entries.size,3);assert.equal(f.editor().store.read(a.portal,'unknown-owner',a.route),null);
 f.editor().store.clearOwner(a.owner);assert.equal(f.read(a),null);assert.equal(f.read(c),null);assert.equal(f.read(b).token,b.token);
});
test('logout removes every own v2 route and own legacy record while preserving foreign owners and unrelated storage',()=>{
 const f=fixture(),own=[record(1),record(2),record(3,'tiktok')],foreign=[record(1,'youtube','other-owner'),record(3,'tiktok','other-owner')];
 for(const v of [...own,...foreign])f.editor().store.write(v);
 const legacy=record(4);f.legacy(legacy);const foreignLegacy=record(5,'tiktok','other-owner');f.legacy(foreignLegacy);
 f.entries.set('unrelated','keep');f.entries.set(newKey(record(6)),'{damaged own record');
 f.failWrites(true);f.editor().store.clearOwner(own[0].owner);
 for(const v of [...own,legacy])assert.equal(f.read(v),null);
 for(const v of [...foreign,foreignLegacy])assert.equal(f.read(v).owner,'other-owner');
 assert.equal(f.entries.get('unrelated'),'keep');assert.equal(f.entries.size,4);
});
test('legacy reads are owner and route bound and do not migrate or erase another file',()=>{
 const f=fixture(),a=pending(record(1)),b=record(2);f.legacy(a);const before=f.entries.get(oldKey(a.portal));
 assert.deepEqual(clone(f.read(a)),a);assert.equal(f.entries.size,1);
 assert.equal(f.editor().store.read(a.portal,'foreign-owner',a.route),null);assert.equal(f.read(b),null);
 f.failWrites(true);f.editor().store.write(b);assert.equal(f.entries.get(oldKey(a.portal)),before);
 f.failWrites(false);f.editor().store.write(b);assert.equal(f.entries.get(oldKey(a.portal)),before);assert.equal(f.read(b).token,b.token);
});
test('a successful matching legacy migration creates v2 before retiring v1',()=>{
 const f=fixture(),old=pending(record(1)),next={...clone(old),token:uuid(998)};f.legacy(old);
 const editor=f.editor();editor.store.write(next);
 assert.equal(f.read(next).token,next.token);assert.equal(f.entries.has(oldKey(old.portal)),false);assert.ok(f.entries.has(newKey(next)));
 editor.store.forget(next);assert.equal(f.read(next),null);
});
test('failed legacy token handoff preserves the verified checkpoint and a later edit completes migration',()=>{
 for(const save of [false,true]){
  const f=fixture(),old=save?pending(record(1)):record(1);f.legacy(old);
  const before=f.entries.get(oldKey(old.portal)),next={...clone(old),token:uuid(998)},editor=f.editor();
  f.failWrites(true);editor.store.write(next);next.form.body='Eingabe nach Wiederaufnahme';editor.store.update(next);
  assert.equal(f.entries.get(oldKey(old.portal)),before);assert.equal(f.entries.has(newKey(next)),false);
  assert.equal(editor.store.matches(next),true);assert.equal(editor.guards.size,1);
  f.failWrites(false);editor.store.update(next);
  assert.equal(f.read(next).token,next.token);assert.equal(f.read(next).form.body,next.form.body);
  assert.equal(f.entries.has(oldKey(old.portal)),false);assert.equal(editor.guards.size,0);
 }
});
test('discard during a failed compatible legacy handoff clears that checkpoint without touching another route',()=>{
 const f=fixture(),old=record(1),other=record(2),next={...clone(old),token:uuid(998)},editor=f.editor();
 f.legacy(old);f.editor().store.write(other);f.failWrites(true);editor.store.write(next);editor.store.forget(next);
 assert.equal(f.read(old),null);assert.equal(f.read(other).token,other.token);assert.equal(editor.guards.size,0);
});
test('failed legacy migration cannot revive incompatible save payloads, baselines or file identities',()=>{
 const changes=[v=>v.sent.body='Neuer Save-Inhalt',v=>v.base.body='Andere Ausgangsfassung',v=>v.assignment++,v=>v.revision++,
  v=>v.fileId=uuid(999),v=>v.fileRevision='version:2',v=>v.previewId=uuid(999),
  v=>v.shop='https://sma-automation.com/app/shop.html?shop=other',v=>{v.kind='edit';delete v.sent;},v=>v.form.body='x'.repeat(2401)];
 for(const change of changes){
  const f=fixture(),old=pending(record(1)),other=record(2),next={...clone(old),token:uuid(998)};f.legacy(old);f.editor().store.write(other);
  change(next);f.failWrites(true);f.editor().store.write(next);
  assert.equal(f.read(old),null,String(change));assert.equal(f.entries.has(oldKey(old.portal)),false,String(change));
  assert.equal(f.read(other).token,other.token);
 }
});
test('a newer v2 token outranks legacy editors and an earlier failed token handoff',()=>{
 const f=fixture(),old=record(1),migrating={...clone(old),token:uuid(997)},next={...clone(old),token:uuid(998)},other=record(2);
 f.legacy(old);const stale=f.editor(),current=f.editor();f.failWrites(true);stale.store.write(migrating);
 f.failWrites(false);f.deniedRemove.add(oldKey(old.portal));current.store.write(next);f.editor().store.write(other);
 const stored=f.entries.get(newKey(next));
 for(const v of [old,migrating]){v.form.body='Verspäteter alter Editor';stale.store.update(v);stale.store.forget(v);assert.equal(stale.store.matches(v),false);}
 assert.equal(f.entries.get(newKey(next)),stored);assert.equal(f.read(next).token,next.token);assert.equal(f.read(other).token,other.token);
});
test('forget keeps v2 authoritative until removal of its legacy shadow succeeds',()=>{
 const f=fixture(),old=record(1),next={...clone(old),token:uuid(998)},editor=f.editor();f.legacy(old);
 f.deniedRemove.add(oldKey(old.portal));editor.store.write(next);editor.store.forget(next);
 assert.equal(f.read(next).token,next.token);assert.ok(f.entries.has(newKey(next)));
 f.deniedRemove.clear();editor.store.forget(next);assert.equal(f.read(next),null);assert.equal(f.entries.size,0);
});
test('a damaged v2 slot never uncovers a legacy checkpoint after a failed legacy cleanup',()=>{
 const f=fixture(),old=record(1),next={...clone(old),token:uuid(998)};f.legacy(old);f.deniedRemove.add(oldKey(old.portal));
 f.editor().store.write(next);f.entries.set(newKey(next),'{damaged v2');
 assert.equal(f.read(next),null);assert.equal(f.read(next),null);assert.equal(f.entries.get(newKey(next)),'{damaged v2');
 f.deniedRemove.clear();assert.equal(f.read(next),null);assert.equal(f.entries.size,0);assert.equal(f.read(next),null);
});
test('logout cannot uncover legacy data when its removal is denied',()=>{
 const f=fixture(),old=record(1),next={...clone(old),token:uuid(998)},foreign=record(2,'youtube','other-owner');
 f.legacy(old);f.deniedRemove.add(oldKey(old.portal));f.editor().store.write(next);f.editor().store.write(foreign);
 f.editor().store.clearOwner(old.owner);assert.equal(f.read(next).token,next.token);
 f.deniedRemove.clear();f.editor().store.clearOwner(old.owner);assert.equal(f.read(next),null);assert.equal(f.read(foreign).token,foreign.token);
});
