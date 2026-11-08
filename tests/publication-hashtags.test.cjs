const {test}=require('node:test'),assert=require('node:assert/strict');
test('editable hashtags keep Unicode, normalize and permit explicit removal',async()=>{
 const {parseHashtags}=await import('../app/assets/publication-hashtags.mjs');
 assert.deepEqual(parseHashtags('#Tür #Gadget Reise_1'),['Tür','Gadget','Reise_1']);
 assert.deepEqual(parseHashtags('  '),[]);assert.deepEqual(parseHashtags('#Cafe\u0301 #界'),['Café','界']);
});
test('invalid tags cannot add links, markup, duplicates or bypass the existing three-tag limit',async()=>{
 const {parseHashtags}=await import('../app/assets/publication-hashtags.mjs');
 for(const x of [null,'a b c d','Test test','Café Cafe\u0301','#','##x','a,b','@x','a.com','a/b','<x>','a\u202e','x'.repeat(51)])assert.throws(()=>parseHashtags(x));
});

test('hashtag correction identifies case- and normalization-equivalent duplicates, length and separators',async()=>{
 const {parseHashtags}=await import('../app/assets/publication-hashtags.mjs');
 assert.throws(()=>parseHashtags('#Café #CAFE\u0301'),/#CAFÉ ist doppelt/);
 assert.throws(()=>parseHashtags('#Tag #Anderer #Dritter #Vierter'),/höchstens drei/);
 assert.throws(()=>parseHashtags('#'+ 'x'.repeat(51)),/1–50/);
 assert.throws(()=>parseHashtags('#Tür,Griff'),/Leerzeichen/);
});
