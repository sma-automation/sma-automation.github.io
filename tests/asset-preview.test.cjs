const {test}=require('node:test');const assert=require('node:assert/strict');
const {previewRequest,previewMetadata,previewImage}=require('../n8n/publishing/asset-preview.cjs');
const context={ok:true,asset_id:'fa110000-0000-4000-8000-000000000001',asset_revision:'sha256:'+ 'a'.repeat(64)+':3',drive_file_id:'owned_drive_file',mime_type:'video/mp4',media_kind:'video',size_bytes:123};
const metadata={id:context.drive_file_id,mimeType:context.mime_type,trashed:false,size:'123',parents:['owned_folder'],sha256Checksum:'a'.repeat(64),version:'4',thumbnailLink:'https://lh3.googleusercontent.com/drive-storage/test=s220'};
test('preview accepts only an authenticated asset identity, never a caller URL or owner override',()=>{
 assert.equal(previewRequest({body:{}}).code,'AUTH_REQUIRED');
 const item={headers:{authorization:'Bearer '+ 'a'.repeat(24)},body:{asset_id:context.asset_id,asset_revision:context.asset_revision}};
 assert.equal(previewRequest(item).ok,true);
 for(const extra of [{url:metadata.thumbnailLink},{customer_id:1},{drive_file_id:'foreign'}])assert.equal(previewRequest({...item,body:{...item.body,...extra}}).ok,false);
});
test('thumbnail still belongs to the same bytes after Drive metadata finishes processing',()=>{
 assert.equal(previewMetadata(metadata,context,['owned_folder']).url,metadata.thumbnailLink);
 for(const patch of [{id:'foreign'},{parents:['other_folder']},{trashed:true},{size:'124'},{mimeType:'image/png'},{sha256Checksum:'b'.repeat(64)}])assert.throws(()=>previewMetadata({...metadata,...patch},context,['owned_folder']));
});
test('thumbnail requests cannot send Drive credentials to arbitrary URLs or redirects',()=>{
 for(const url of ['https://evil.invalid/a','https://lh3.googleusercontent.com.evil.invalid/a','https://user@lh3.googleusercontent.com/a','http://lh3.googleusercontent.com/a','https://lh3.googleusercontent.com/a?redirect=evil','https://lh3.googleusercontent.com/a#x'])assert.throws(()=>previewMetadata({...metadata,thumbnailLink:url},context,['owned_folder']));
 const workflow=require('../n8n/publishing/asset-preview-workflow.json');
 const fetch=workflow.nodes.find(n=>n.name==='Vorschaubild laden');assert.equal(fetch.parameters.options.redirect.redirect.followRedirects,false);
});
test('only bounded image bytes leave the proxy; no upstream URLs or tokens',()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 const r=previewImage(png,context);assert.equal(r.mime_type,'image/png');assert.equal(r.can_publish,false);assert.equal(r.asset_id,context.asset_id);assert.equal(r.image_base64,png.toString('base64'));assert.equal('drive_file_id' in r,false);
 for(const b of [Buffer.from('<svg onload="alert(1)"></svg>'),Buffer.alloc(2000001),Buffer.alloc(1)])assert.throws(()=>previewImage(b,context));
});
