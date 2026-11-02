const {test}=require('node:test');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
test('speech byte/model binding, audio decoding and transcript checks (Python unittest)',()=>{
 const result=spawnSync(process.env.SMA_TEST_PYTHON||'python',['tests/publication_speech_test.py','-v'],{encoding:'utf8',timeout:120000,maxBuffer:1048576});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
