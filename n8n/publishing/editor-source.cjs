'use strict';
const {createHash}=require('crypto');
function editorSourceMetadata(file,context,folders){
 if(context?.ok!==true||file?.id!==context.drive_file_id||file.trashed!==false||file.capabilities?.canDownload!==true||file.mimeType!==context.mime_type||String(file.size)!==String(context.size_bytes)||!Array.isArray(file.parents)||!file.parents.some(p=>folders.includes(p))||!['video/mp4','image/jpeg','image/png','image/webp'].includes(file.mimeType)||!(Number(file.size)>0&&Number(file.size)<=24000000))throw Error('FILE_UNAVAILABLE');
 const revision=context.asset_revision;
 const same=revision.startsWith('sha256:')?revision==='sha256:'+file.sha256Checksum+':'+file.version:revision.startsWith('md5:')?revision==='md5:'+file.md5Checksum+':'+file.version:revision==='version:'+file.version;
 if(!same)throw Error('FILE_CHANGED');
 const sha256=/^[a-f0-9]{64}$/.test(file.sha256Checksum||'')?file.sha256Checksum:null,md5=/^[a-f0-9]{32}$/.test(file.md5Checksum||'')?file.md5Checksum:null;
 if(!sha256&&!md5)throw Error('SOURCE_UNVERIFIED');
 return {sha256,md5,size_bytes:Number(file.size)};
}
function editorSourceBytes(bytes,context,metadata){
 if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>24000000||bytes.length!==metadata.size_bytes)throw Error('SOURCE_UNVERIFIED');
 const sha256=createHash('sha256').update(bytes).digest('hex');
 if(metadata.sha256&&sha256!==metadata.sha256||metadata.md5&&createHash('md5').update(bytes).digest('hex')!==metadata.md5)throw Error('FILE_CHANGED');
 const magic=context.mime_type==='video/mp4'?bytes.toString('ascii',4,8)==='ftyp':context.mime_type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:context.mime_type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):context.mime_type==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':false;
 if(!magic)throw Error('SOURCE_UNVERIFIED');
 return {ok:true,can_publish:false,asset_id:context.asset_id,asset_revision:context.asset_revision,media_kind:context.media_kind,mime_type:context.mime_type,size_bytes:bytes.length,sha256,data_base64:bytes.toString('base64')};
}
module.exports={editorSourceMetadata,editorSourceBytes};
