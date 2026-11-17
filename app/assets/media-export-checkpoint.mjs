// Only recovery identities and hashes are stored. Media bytes, file names,
// account tokens and upload capabilities never enter browser storage.
const prefix='sma.media-export.pending.v1.';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const error=code=>Object.assign(Error(code),{code});
const validOutput=value=>exact(value,['sha256','size_bytes'])&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256)&&
 Number.isSafeInteger(value.size_bytes)&&value.size_bytes>0&&value.size_bytes<=24000000;
const bindingFields=['owner','asset_id','asset_revision','draft_revision','media_kind','outputs'];
function validBinding(value){
 return object(value)&&typeof value.owner==='string'&&value.owner.length>0&&value.owner.length<=128&&
  typeof value.asset_id==='string'&&UUID.test(value.asset_id)&&typeof value.asset_revision==='string'&&value.asset_revision.length>0&&value.asset_revision.length<=250&&
  Number.isSafeInteger(value.draft_revision)&&value.draft_revision>=0&&value.draft_revision<=999999999&&
  ['video','image'].includes(value.media_kind)&&exact(value.outputs,['media','cover'])&&validOutput(value.outputs.media)&&
  (value.outputs.cover===null||value.media_kind==='video'&&validOutput(value.outputs.cover));
}
function normalized(value){
 const output=item=>item===null?null:{sha256:item.sha256,size_bytes:item.size_bytes};
 return {owner:value.owner,asset_id:value.asset_id,asset_revision:value.asset_revision,draft_revision:value.draft_revision,
  media_kind:value.media_kind,outputs:{media:output(value.outputs.media),cover:output(value.outputs.cover)}};
}
const fingerprint=value=>JSON.stringify(normalized(value));
function validRecord(value,owner){
 return exact(value,[...bindingFields,'export_id','expired'])&&validBinding(value)&&value.owner===owner&&
  typeof value.export_id==='string'&&UUID.test(value.export_id)&&typeof value.expired==='boolean';
}

export function createExportCheckpoints({storage,locks,uuid}){
 const key=owner=>prefix+encodeURIComponent(owner);
 function read(owner){
  try{
   const target=storage(),raw=target.getItem(key(owner));
   if(raw===null)return {target,records:[]};
   if(typeof raw!=='string'||raw.length>40000)throw error('EXPORT_CHECKPOINT_UNAVAILABLE');
   const records=JSON.parse(raw);
   if(!Array.isArray(records)||records.length>32||records.some(record=>!validRecord(record,owner))||
      new Set(records.map(fingerprint)).size!==records.length||new Set(records.map(record=>record.export_id)).size!==records.length)throw error('EXPORT_CHECKPOINT_UNAVAILABLE');
   return {target,records};
  }catch{throw error('EXPORT_CHECKPOINT_UNAVAILABLE');}
 }
 function write(owner,target,records){
  const raw=JSON.stringify(records);
  if(raw.length>40000||records.length>32)throw error('EXPORT_CHECKPOINT_LIMIT');
  try{
   target.setItem(key(owner),raw);
   if(target.getItem(key(owner))!==raw)throw error('EXPORT_CHECKPOINT_CHANGED');
  }catch(cause){throw error(cause?.code==='EXPORT_CHECKPOINT_CHANGED'?cause.code:'EXPORT_CHECKPOINT_UNAVAILABLE');}
 }
 async function exclusive(owner,signal,action){
  try{
   signal?.throwIfAborted();
   const manager=locks();
   // Web Locks serialize reservations across tabs on this HTTPS origin. A
   // missing lock manager must not silently allow competing new identities.
   if(typeof manager?.request!=='function')throw error('EXPORT_CHECKPOINT_UNSUPPORTED');
   return await manager.request(key(owner),{mode:'exclusive',ifAvailable:true},lock=>{
    signal?.throwIfAborted();
    if(!lock)throw error('EXPORT_CHECKPOINT_BUSY');
    return action();
   });
  }catch(cause){
   if(signal?.aborted)throw signal.reason;
   if(cause?.code?.startsWith('EXPORT_CHECKPOINT_'))throw cause;
   throw error('EXPORT_CHECKPOINT_UNAVAILABLE');
  }
 }
 function current(record){
  if(!validRecord(record,record?.owner))throw error('EXPORT_CHECKPOINT_UNAVAILABLE');
  const found=read(record.owner).records.find(item=>fingerprint(item)===fingerprint(record));
  if(!found||found.export_id!==record.export_id)throw error('EXPORT_CHECKPOINT_CHANGED');
  return found;
 }
 return {
  reserve(binding,signal,{confirmedDraftRevision}={}){
   if(!validBinding(binding))throw error('EXPORT_CHECKPOINT_UNAVAILABLE');
   return exclusive(binding.owner,signal,()=>{
    const {target,records}=read(binding.owner),signature=fingerprint(binding);
    const existing=records.find(record=>fingerprint(record)===signature);
    if(existing)return {record:existing,restored:true};
    const sameAsset=record=>record.asset_id===binding.asset_id&&record.asset_revision===binding.asset_revision;
    if(records.some(record=>sameAsset(record)&&record.draft_revision>binding.draft_revision))throw error('EXPORT_CHECKPOINT_CHANGED');
    // Only a fresh server-confirmed draft permits discarding older revisions of
    // this exact asset. Their prepare/complete requests can no longer succeed.
    // Existing identities above never acquire a new storage-write dependency.
    const retained=Number.isSafeInteger(confirmedDraftRevision)&&confirmedDraftRevision===binding.draft_revision?
     records.filter(record=>!sameAsset(record)||record.draft_revision>=confirmedDraftRevision):records;
    if(retained.length>=32)throw error('EXPORT_CHECKPOINT_LIMIT');
    const record={...normalized(binding),export_id:uuid(),expired:false};
    if(!validRecord(record,binding.owner)||records.some(item=>item.export_id===record.export_id))throw error('EXPORT_CHECKPOINT_UNAVAILABLE');
    write(binding.owner,target,[...retained,record]);
    return {record,restored:false};
   });
  },
  current,
  expire(record,signal){
   return exclusive(record.owner,signal,()=>{
    const found=current(record),{target,records}=read(record.owner),expired={...found,expired:true};
    write(record.owner,target,records.map(item=>item.export_id===record.export_id?expired:item));return expired;
   });
  },
  replaceExpired(record,signal){
   return exclusive(record.owner,signal,()=>{
    const found=current(record);if(!found.expired)throw error('EXPORT_CHECKPOINT_CHANGED');
    const {target,records}=read(record.owner),next={...found,export_id:uuid(),expired:false};
    if(!validRecord(next,record.owner)||records.some(item=>item.export_id===next.export_id))throw error('EXPORT_CHECKPOINT_UNAVAILABLE');
    write(record.owner,target,records.map(item=>item.export_id===record.export_id?next:item));return next;
   });
  },
  complete(record){
   return exclusive(record.owner,undefined,()=>{
    const {target,records}=read(record.owner);
    // A late completion must never remove a newer deliberate replacement.
    const remaining=records.filter(item=>item.export_id!==record.export_id);
    if(remaining.length!==records.length)write(record.owner,target,remaining);
   });
  }
 };
}
