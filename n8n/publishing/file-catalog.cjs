'use strict';
const DRIVE_ID=/^[A-Za-z0-9_-]{10,200}$/;
// Drive may not have finished extracting video metadata yet. Missing values
// stay unknown; they must never become zero or a successful media inspection.
function mediaMetadata(f){
 const video=f.mimeType?.startsWith('video/');
 const m=(video?f.videoMediaMetadata:f.imageMediaMetadata)||{};
 const dimension=v=>Number.isInteger(v)&&v>0&&v<=1000000?v:null;
 const duration=video&&typeof m.durationMillis==='string'&&/^\d{1,13}$/.test(m.durationMillis)?Number(m.durationMillis):null;
 return {width_px:dimension(m.width),height_px:dimension(m.height),duration_ms:duration};
}
function verifiedFolders(rows,context){
 const matches=rows.filter(r=>r?.kunde_id);const k=matches.length===1?matches[0]:null;
 const norm=x=>String(x||'').trim().toLowerCase();
 if(context?.ok!==true||!k||k.kunde_id!==context.n8n_kunde_id||norm(k.kunde_email)!==norm(context.kunde_email)||k.zugang_aktiv!==true||!(k.demo_delta_aktiv===true||k.zahlung_bestaetigt===true))throw Error('FOLDER_UNAVAILABLE');
 const folders=[...new Set([k.upload_folder_id,k.processing_folder_id])];
 if(folders.length!==2||folders.some(f=>typeof f!=='string'||!DRIVE_ID.test(f)))throw Error('FOLDER_UNAVAILABLE');
 return {folders,q:"trashed = false and ("+folders.map(f=>"'"+f+"' in parents").join(' or ')+") and (mimeType contains 'image/' or mimeType contains 'video/')"};
}
function catalogFiles(response,folders){
 if(!response||!Array.isArray(response.files)||response.incompleteSearch===true)throw Error('FILE_METADATA_INVALID');
 if(response.nextPageToken||response.files.length>1000)throw Error('FILE_CATALOG_TOO_LARGE');
 const seen=new Set();return response.files.map(f=>{
  if(!DRIVE_ID.test(f.id||'')||seen.has(f.id)||f.trashed===true||!Array.isArray(f.parents)||!f.parents.some(p=>folders.includes(p)))throw Error('FILE_METADATA_INVALID');
  seen.add(f.id);
  if(typeof f.name!=='string'||f.name.length<1||f.name.length>500||/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/u.test(f.name)||! /^(image|video)\/[A-Za-z0-9.+-]+$/.test(f.mimeType||''))throw Error('FILE_METADATA_INVALID');
  if(!/^\d{1,18}$/.test(f.size||'')||!/^\d{1,30}$/.test(f.version||'')||!Number.isFinite(Date.parse(f.modifiedTime)))throw Error('FILE_METADATA_INVALID');
  const checksum=/^[a-f0-9]{64}$/.test(f.sha256Checksum||'')?'sha256:'+f.sha256Checksum:/^[a-f0-9]{32}$/.test(f.md5Checksum||'')?'md5:'+f.md5Checksum:'version';
  return {drive_file_id:f.id,name:f.name,media_kind:f.mimeType.startsWith('video/')?'video':'image',mime_type:f.mimeType,revision:checksum+':'+f.version,modified_at:new Date(f.modifiedTime).toISOString(),size_bytes:String(f.size),...mediaMetadata(f)};
 });
}
module.exports={verifiedFolders,catalogFiles};
