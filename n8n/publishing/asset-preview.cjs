'use strict';
// Only authenticated, owner-scoped file identities enter this workflow.
function previewRequest(item){
 const auth=item?.headers?.authorization,b=item?.body;
 if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(auth))return {ok:false,code:'AUTH_REQUIRED'};
 if(!b||typeof b!=='object'||Object.keys(b).some(k=>!['asset_id','asset_revision'].includes(k))||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(b.asset_id||'')||typeof b.asset_revision!=='string'||b.asset_revision.length<1||b.asset_revision.length>250)return {ok:false,code:'INVALID_INPUT'};
 return {ok:true,auth,input:{p_asset_id:b.asset_id,p_revision:b.asset_revision}};
}
function previewMetadata(file,context,folders){
 if(context?.ok!==true||file?.id!==context.drive_file_id||file.trashed!==false||file.mimeType!==context.mime_type||String(file.size)!==String(context.size_bytes)||!Array.isArray(file.parents)||!file.parents.some(p=>folders.includes(p)))throw Error('FILE_UNAVAILABLE');
 // Drive can update metadata after an upload; the checksum still binds the bytes.
 const revision=context.asset_revision;
 const unchanged=revision.startsWith('sha256:')?revision.split(':')[1]===file.sha256Checksum:revision.startsWith('md5:')?revision.split(':')[1]===file.md5Checksum:revision==='version:'+file.version;
 if(!unchanged)throw Error('FILE_CHANGED');
 if(typeof file.thumbnailLink!=='string'||!/^https:\/\/lh[3-6]\.googleusercontent\.com\/[A-Za-z0-9_\-=/]+$/.test(file.thumbnailLink)||file.thumbnailLink.length>4000)throw Error('PREVIEW_UNAVAILABLE');
 return {url:file.thumbnailLink};
}
function previewImage(bytes,context){
 if(!bytes||bytes.length<12||bytes.length>2000000)throw Error('PREVIEW_UNAVAILABLE');
 const mime=bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':null;
 if(!mime)throw Error('PREVIEW_UNAVAILABLE');
 return {ok:true,asset_id:context.asset_id,asset_revision:context.asset_revision,media_kind:context.media_kind,mime_type:mime,image_base64:bytes.toString('base64'),can_publish:false};
}
module.exports={previewRequest,previewMetadata,previewImage};
