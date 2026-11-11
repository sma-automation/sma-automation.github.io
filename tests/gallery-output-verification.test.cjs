const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const fixture=require('../n8n/publishing/fixtures/gallery-music-probe.json');
const {soundtrackMP4}=require('../n8n/publishing/gallery-soundtrack.cjs');
const original=Buffer.from(fixture.video,'base64');
const aac=Buffer.from(fixture.audio,'base64');
const rendered=soundtrackMP4(original,aac).bytes;
const sha256=b=>createHash('sha256').update(b).digest('hex');
const modulePromise=import('../n8n/publishing/verify-gallery-output.mjs');

test('valid synthetic output can be reproduced but is not a verified saved customer file',async()=>{
 const {reconcileGalleryBytes:verify}=await modulePromise;
 const r=verify({original,aac,expectedSha:fixture.expected,expectedSize:rendered.length});
 assert.equal(r.reconstructed.sha256,fixture.expected);
 assert.equal(r.reconstruction_matches_receipt,true);
 assert.equal(r.actual_output_checked,false);
 assert.equal(r.status,'requires_original_saved_output');
 assert.equal(r.can_publish,false);
 assert.equal(r.source_sha256,sha256(original));
 assert.equal(r.audio_sha256,sha256(aac));
});

test('actual bytes need an independent exact SHA-256 and byte-count match',async()=>{
 const {reconcileGalleryBytes:verify}=await modulePromise;
 const input={original,aac,expectedSha:fixture.expected,expectedSize:rendered.length};
 const valid=verify({...input,observed:rendered});
 assert.equal(valid.actual_output_checked,true);
 assert.equal(valid.status,'saved_bytes_authenticated');
 assert.equal(valid.observed.receipt_match,true);
 assert.equal(valid.can_publish,false);
 const altered=Buffer.from(rendered);altered[altered.length-1]^=1;
 const bad=verify({...input,observed:altered});
 assert.equal(bad.status,'observed_file_differs_from_receipt');
 assert.equal(bad.observed.receipt_match,false);
 assert.equal(bad.can_publish,false);
});

test('alternate renderer receipt remains unverified even if two inputs have valid hashes',async()=>{
 const {reconcileGalleryBytes:verify}=await modulePromise;
 const r=verify({original,aac,expectedSha:'1'.repeat(64),expectedSize:rendered.length+114});
 assert.equal(r.reconstruction_matches_receipt,false);
 assert.equal(r.status,'requires_original_saved_output');
 assert.equal(r.actual_output_checked,false);
 assert.equal(r.can_publish,false);
});

test('malformed inputs and mismatched formats are rejected without writes or publishing',async()=>{
 const {reconcileGalleryBytes:verify}=await modulePromise;
 const input={original,aac,expectedSha:fixture.expected,expectedSize:rendered.length};
 for(const patch of [
  {expectedSha:'bad'}, {expectedSize:0},{original:Buffer.alloc(2)},
  {aac:Buffer.alloc(0)}, {observed:Buffer.alloc(24000001)},
  {original:rendered}
 ]) assert.throws(()=>verify({...input,...patch}));
 const source=fs.readFileSync('n8n/publishing/verify-gallery-output.mjs','utf8');
 assert.doesNotMatch(source,/\b(fetch\(|http_post\b|http_get\b|upload\(|publish\(|credit\b.*\bdebit\b)\b/i);
 assert.match(source,/can_publish:false/);
});
