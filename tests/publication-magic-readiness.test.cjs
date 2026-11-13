'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('app/assets/publication-preview.js','utf8');
const html=fs.readFileSync('app/publication-preview.html','utf8');
function between(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Expected source section: '+start);
 return source.slice(a,b);
}

test('selected video can open while its separate checks run in background',()=>{
 const latest=between('async function loadLatest(){','\nfunction resetMagic(){');
 assert.match(latest,/if\(file\?\.media_kind==='video'\)void loadMediaCheck\(\);else await loadMediaCheck\(\)/);
 assert.match(latest,/if\(file\?\.media_kind==='video'\)void loadMagicEffect\(true\);else await loadMagicEffect\(true\)/);
 assert.match(latest,/await fileRpc\('get'/);
 assert.match(latest,/lock\(false\);\s*syncMedia\(\)/);
});

test('existing media guard and owner-bound draft read are not bypassed',()=>{
 const check=between('async function loadMediaCheck(){','\nfunction syncReviewButton(){');
 assert.match(check,/fileRpc\('check',\{asset_id:file\.id,asset_revision:file\.revision,platform:selectedPortal\}\)/);
 assert.match(check,/m\.can_publish!==false/);
 assert.match(check,/selectedAsset\?\.id!==file\.id\|\|selectedAsset\?\.revision!==file\.revision/);
 const latest=between('async function loadLatest(){','\nfunction resetMagic(){');
 assert.match(latest,/await fileRpc\('get'/);
});

test('opening a video no longer enters a long automatic status-poll loop',()=>{
 const load=between('async function loadMagicEffect(autoStart=false){','\nasync function recognizePhoto(');
 assert.match(load,/autoStart&&file\.media_kind==='image'&&\(r\.status==='processing'/);
 assert.doesNotMatch(load,/autoStart&&\(r\.status==='processing'/);
 assert.match(load,/ticket!==magicLoadTicket/);
 assert.match(load,/!photoStillSelected\(file\)/);
 assert.match(load,/ticket===magicLoadTicket&&!busy&&photoStillSelected\(file\)/);
});

test('manual recognition invalidates any older background load',()=>{
 const reset=between('function resetMagic(){','\nfunction magicPhotoHint(');
 const recognize=between('async function recognizePhoto(', "\n$('recognizePhoto').addEventListener");
 const action=between('async function runMagicAction(', "\n$('magicSource').addEventListener");
 assert.match(reset,/magicLoadTicket\+\+/);
 assert.match(recognize,/magicLoadTicket\+\+;lock\(true\)/);
 assert.match(action,/magicLoadTicket\+\+;automaticMode=mode;lock\(true\)/);
 assert.match(html,/publication-preview\.js\?v=91/);
});
