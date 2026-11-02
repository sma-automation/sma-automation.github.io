'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {checkedVideo,zipVideo,containerId,extractionRequest,extractionResult,evidenceFiles,evidenceManifest,evidenceBytes}=require('../n8n/publishing/video-evidence.cjs');
const bytes=Buffer.from('00000018667479706d70343200000000000000000000000000','hex');
const sha=crypto.createHash('sha256').update(bytes).digest('hex');
const context={media_kind:'video',mime_type:'video/mp4',size_bytes:bytes.length,revision:`sha256:${sha}:1`};
const container='cntr_1234567890abcdef';
const upload={id:'cfile_1234567890abcdef',container_id:container,path:'/mnt/data/generated-video.zip'};
const jpg=Buffer.from('ffd8ffe000112233','hex');
const manifest={schema:'sma-video-evidence-v1',sha256:sha,size_bytes:24,duration_ms:8000,width:640,height:360,positions_ms:[0,1000,2000,3000,4000,5000,6000,7000,7850],sampling:'representative_frames_not_full_moderation',audio_status:'no_audio_stream','frames.jpg':{size_bytes:jpg.length,sha256:crypto.createHash('sha256').update(jpg).digest('hex')}};
test('actual MP4 bytes must match the exact stored revision and size',()=>{
 assert.equal(checkedVideo(bytes,context).sha256,sha);
 assert.throws(()=>checkedVideo(Buffer.concat([bytes,Buffer.from('x')]),context),/FILE_CHANGED/);
 assert.throws(()=>checkedVideo(bytes,{...context,revision:'sha256:'+'0'.repeat(64)+':1'}),/FILE_CHANGED/);
});
test('unsupported formats, unbounded sizes and weak revisions cannot enter extraction',()=>{
 for(const change of [{mime_type:'image/png'},{size_bytes:24000001},{revision:'md5:'+'a'.repeat(32)+':1'},{size_bytes:NaN}])assert.throws(()=>checkedVideo(bytes,{...context,...change}),/VIDEO_UNSUPPORTED/);
});
test('ZIP uses one fixed entry and stores the original bytes unchanged',()=>{
 const zip=zipVideo(bytes);assert.equal(zip.readUInt32LE(),0x04034b50);
 assert.equal(zip.subarray(30,40).toString(),'source.mp4');assert.deepEqual(zip.subarray(40,40+bytes.length),bytes);
 assert.equal(zip.readUInt16LE(zip.length-12),1);
});
test('container IDs and uploaded file paths cannot become arbitrary URLs or code',()=>{
 for(const id of ['https://other.invalid','../files','cntr_a/b',''])assert.throws(()=>containerId(id));
 for(const change of [{container_id:'cntr_other12345678'},{path:'/mnt/data/../../etc/passwd.zip'},{path:'/mnt/data/a.zip\nprint(1)'},{id:'cfile_/../../'}])assert.throws(()=>extractionRequest({...upload,...change},{id:container},{sha256:sha,size_bytes:24},'print(1)'));
});
test('extraction is confined to one exact reviewed script in its own private container',()=>{
 const c=extractionRequest(upload,{id:container},{sha256:sha,size_bytes:24},'print(1)');
 assert.equal(c.request.max_tool_calls,1);assert.equal(c.request.store,false);
 const response={status:'completed',output:[{type:'code_interpreter_call',status:'completed',container_id:container,code:c.expected_code,outputs:[{type:'logs',logs:JSON.stringify(manifest)}]}]};
 assert.equal(extractionResult(response,c).container_id,container);
 for(const altered of [{...response,status:'incomplete'},{...response,output:[]},{...response,output:[...response.output,...response.output]},{...response,output:[{...response.output[0],code:c.expected_code+'\nprint("fake")'}]}])assert.throws(()=>extractionResult(altered,c),/UNVERIFIED/);
 for(const logs of ['Traceback: decoding failed','not JSON',''])assert.throws(()=>extractionResult({...response,output:[{...response.output[0],outputs:[{type:'logs',logs}]}]},c),/UNVERIFIED/);
});
test('evidence files are selected only from exact paths within the same container',()=>{
 const files=['manifest.json','frames.jpg','audio.wav'].map((name,i)=>({id:'cfile_1234567890abc'+i,container_id:container,path:'/mnt/data/sma_evidence/'+name,bytes:100}));
 assert.ok(evidenceFiles({data:files,has_more:false},container).audio_id);
 assert.ok(evidenceFiles({data:files.map(f=>({...f,bytes:null})),has_more:false},container).audio_id);
 assert.throws(()=>evidenceFiles({data:files,has_more:true},container));
 assert.throws(()=>evidenceFiles({data:[...files,files[0]]},container));
 assert.throws(()=>evidenceFiles({data:files.map(f=>({...f,container_id:'cntr_other12345678'}))},container));
});
test('manifest binds source hash, extraction coverage and explicit audio state',()=>{
 assert.equal(evidenceManifest(manifest,{sha256:sha,size_bytes:24}),manifest);
 for(const change of [{sha256:'0'.repeat(64)},{positions_ms:[0,1000]},{positions_ms:[0,0,7850]},{audio_status:'unknown'},{duration_ms:60001}])assert.throws(()=>evidenceManifest({...manifest,...change},{sha256:sha,size_bytes:24}));
});
test('downloaded evidence must match its manifest; an arbitrary image is rejected',()=>{
 assert.equal(evidenceBytes(jpg,manifest,'frames.jpg'),true);
 assert.throws(()=>evidenceBytes(Buffer.from('ffd8ffe000112234','hex'),manifest,'frames.jpg'));
 assert.throws(()=>evidenceBytes(Buffer.from('fake'),manifest,'audio.wav'));
});
test('extractor uses fixed paths and offline subprocess arguments, never shell interpolation',()=>{
 const script=fs.readFileSync(require.resolve('../n8n/publishing/video-extract.py'),'utf8');
 assert.match(script,/archive\.namelist\(\) == \['source.mp4'\]/);
 assert.match(script,/hashlib\.sha256\(raw\)\.hexdigest\(\) == EXPECTED_SHA256/);
 assert.doesNotMatch(script,/shell\s*=\s*True|extractall\(|pip install|requests\./);
});
