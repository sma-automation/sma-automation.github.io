import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const driveId=/^[A-Za-z0-9_-]{10,200}$/;
const permissionId=/^[A-Za-z0-9_-]{1,200}$/;
const bearer=/^[A-Za-z0-9._~+/-]+=*$/;
const limit=16*1024;
const folderType='application/vnd.google-apps.folder';
const origin='https://www.googleapis.com/drive/v3/';
class CheckFailure extends Error {
  constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new CheckFailure(code);};
const noGrant={allows_payment:false,allows_upload:false,activates_customer:false,
  customer_assignment_verified:false};

/**
 * Operator-only metadata inspection. Never lists/downloads customer files,
 * writes to Drive, calls Mollie/n8n/Supabase, or grants onboarding access.
 * expectedPermissionId must already identify the installed SMA Drive account.
 */
export async function checkFolders({uploadFolderId,processingFolderId,accessToken,
  expectedPermissionId,fetchImpl=globalThis.fetch,timeoutMs=12000}={}){
  let step='configuration';
  if(![uploadFolderId,processingFolderId].every(id=>typeof id==='string'&&driveId.test(id))||
    uploadFolderId===processingFolderId)return {ok:false,code:'INVALID_FOLDERS',step,...noGrant};
  if(typeof accessToken!=='string'||accessToken.length<1||accessToken.length>8192||!bearer.test(accessToken)||
    typeof expectedPermissionId!=='string'||!permissionId.test(expectedPermissionId)||
    typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)
    return {ok:false,code:'INVALID_CONFIGURATION',step,...noGrant};

  const controller=new AbortController();
  let timer;
  // One budget for identity, both HTTP requests and all response-body reads.
  // Racing the operations also bounds transports that ignore AbortSignal.
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new CheckFailure('TIMEOUT'));},timeoutMs);
  });
  async function within(operation){
    if(controller.signal.aborted)fail('TIMEOUT');
    return Promise.race([Promise.resolve().then(operation),deadline]);
  }
  function cancel(body){
    try{Promise.resolve(body?.cancel()).catch(()=>{});}catch{/* No provider details in output. */}
  }
  async function json(url){
    const response=await within(async()=>{
      const r=await fetchImpl(url.href,{method:'GET',headers:{Authorization:'Bearer '+accessToken,
        Accept:'application/json'},redirect:'error',credentials:'omit',cache:'no-store',signal:controller.signal});
      if(controller.signal.aborted){cancel(r?.body);fail('TIMEOUT');}
      return r;
    });
    let reader,complete=false;
    try{
      if(response?.redirected===true||(response?.url&&response.url!==url.href))fail('UNEXPECTED_RESPONSE');
      if(response?.status===401)fail('AUTH_REQUIRED');
      if(response?.status===403||response?.status===404)fail('ACCESS_UNAVAILABLE');
      if(response?.status===429)fail('RATE_LIMITED');
      if(response?.status!==200)fail('READ_FAILED');
      if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail('UNEXPECTED_RESPONSE');
      const declared=response.headers.get('content-length');
      if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))fail('UNEXPECTED_RESPONSE');
      reader=response.body?.getReader();
      if(!reader)fail('UNEXPECTED_RESPONSE');
      const chunks=[];let size=0;
      while(true){
        const part=await within(()=>reader.read());
        if(part.done){complete=true;break;}
        if(!(part.value instanceof Uint8Array))fail('UNEXPECTED_RESPONSE');
        size+=part.value.byteLength;
        if(size>limit)fail('UNEXPECTED_RESPONSE');
        chunks.push(part.value);
      }
      const encoding=response.headers.get('content-encoding');
      if(declared!==null&&(!encoding||encoding==='identity')&&Number(declared)!==size)fail('UNEXPECTED_RESPONSE');
      try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}
      catch{fail('UNEXPECTED_RESPONSE');}
    }finally{
      if(reader){
        if(!complete)cancel(reader);
        try{reader.releaseLock();}catch{/* A timed-out reader may still be pending. */}
      }else cancel(response?.body);
    }
  }
  try{
    step='identity';
    const about=new URL('about',origin);about.searchParams.set('fields','user(permissionId)');
    const identity=await json(about);
    if(identity?.user?.permissionId!==expectedPermissionId)fail('ACCOUNT_MISMATCH');
    for(const [role,id] of [['upload',uploadFolderId],['processing',processingFolderId]]){
      step=role;
      const url=new URL('files/'+id,origin);
      url.searchParams.set('supportsAllDrives','true');
      url.searchParams.set('fields','id,mimeType,trashed,capabilities(canListChildren,canAddChildren)');
      const item=await json(url);
      if(item?.id!==id||item.mimeType!==folderType||item.trashed!==false||
        item.capabilities?.canListChildren!==true)fail('FOLDER_UNAVAILABLE');
      if(role==='processing'&&item.capabilities?.canAddChildren!==true)fail('PROCESSING_NOT_WRITABLE');
    }
    return {ok:true,code:'FOLDER_ACCESS_VERIFIED',scope:'drive_metadata_only',
      checked_at:new Date().toISOString(),checks:{drive_account_matches:true,
        upload_folder_readable:true,processing_folder_readable:true,processing_folder_writable:true},...noGrant};
  }catch(error){
    return {ok:false,code:error instanceof CheckFailure?error.code:'READ_FAILED',step,...noGrant};
  }finally{
    clearTimeout(timer);controller.abort();
  }
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length!==2){
    console.error('Aufruf: node n8n/package-payment/check-folders.mjs UPLOAD_ORDNER_ID VERARBEITUNGS_ORDNER_ID');
    process.exitCode=1;return;
  }
  const result=await checkFolders({uploadFolderId:args[0],processingFolderId:args[1],
    accessToken:process.env.SMA_GOOGLE_DRIVE_READ_TOKEN,
    expectedPermissionId:process.env.SMA_GOOGLE_DRIVE_EXPECTED_PERMISSION_ID});
  console.log(JSON.stringify(result));
  if(!result.ok)process.exitCode=1;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main().catch(()=>{console.error('Ordnerprüfung nicht abgeschlossen.');process.exitCode=1;});
}
