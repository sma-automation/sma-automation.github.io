'use strict';
function uploadRequest(request){
 const auth=request?.headers?.authorization, b=request?.body;
 if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(auth))return {ok:false,code:'AUTH_REQUIRED'};
 if(!b||!['start','finish'].includes(b.action)||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.upload_id||''))return {ok:false,code:'INVALID_INPUT'};
 const input={upload_id:b.upload_id};
 if(b.action==='start')Object.assign(input,{name:b.name,mime_type:b.mime_type,size_bytes:b.size_bytes});
 return {ok:true,auth,action:b.action,input};
}
function uploadFolder(rows,context){
 const {folders}=verifiedFolders(rows,context);
 // 01 Upload is watched by the legacy automatic publishing flow. Store manual
 // dashboard drafts in 02 Verarbeitung, which the existing catalogue recognizes.
 return {folder_id:folders[1]};
}
function checkedUploadURL(value){
 if(typeof value!=='string'||value.length>4000||!/^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/.test(value))throw Error('UPLOAD_UNAVAILABLE');
 const parts=value.split('?');if(parts.length!==2)throw Error('UPLOAD_UNAVAILABLE');
 const seen=new Set();for(const item of parts[1].split('&')){
  const m=/^(uploadType|supportsAllDrives|upload_id|session_crd)=([A-Za-z0-9_.%~=-]+)$/.exec(item);
  if(!m||seen.has(m[1])||(m[1]==='uploadType'&&m[2]!=='resumable')||(m[1]==='supportsAllDrives'&&m[2]!=='true'))throw Error('UPLOAD_UNAVAILABLE');seen.add(m[1]);
 }
 if(!seen.has('uploadType')||!seen.has('upload_id'))throw Error('UPLOAD_UNAVAILABLE');return value;
}
function uploadSession(response){
 if(response?.statusCode!==200)throw Error('UPLOAD_UNAVAILABLE');
 return checkedUploadURL(response?.headers?.location);
}
function uploadedFile(response,context,folder){
 if(folder!==context.folder_id||response?.id!==context.drive_file_id||response.name!==context.name||response.mimeType!==context.mime_type||response.size!==String(context.size_bytes)||response.trashed!==false||!response.parents?.includes(folder)||response.appProperties?.sma_upload_id!==context.upload_id)throw Error('UPLOAD_INCOMPLETE');
 const file=catalogFiles({files:[response]},[folder])[0];
 if(!/^(sha256:|md5:)/.test(file.revision))throw Error('UPLOAD_INCOMPLETE');
 return {...file,folder_id:folder,upload_id:context.upload_id};
}
function uploadAnswer(r){
 if(r?.ok===true&&r.status==='completed'&&typeof r.asset_id==='string')return {ok:true,status:'completed',upload_id:r.upload_id,asset_id:r.asset_id,can_publish:false};
 if(r?.ok===true&&r.status==='ready'&&typeof r.upload_url==='string')return {ok:true,status:'ready',upload_id:r.upload_id,upload_url:uploadSession({statusCode:200,headers:{location:r.upload_url}}),can_publish:false};
 const known=['AUTH_REQUIRED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE','INVALID_INPUT','UPLOAD_UNAVAILABLE','UPLOAD_CONFLICT','UPLOAD_EXPIRED','UPLOAD_INITIALIZING','UPLOAD_FORMAT','UPLOAD_SIZE','UPLOAD_RATE_LIMITED','UPLOAD_INCOMPLETE','FOLDER_UNAVAILABLE'];
 return {ok:false,code:known.includes(r?.code)?r.code:'UPLOAD_UNAVAILABLE'};
}
module.exports={uploadRequest,uploadFolder,uploadSession,uploadedFile,uploadAnswer};
