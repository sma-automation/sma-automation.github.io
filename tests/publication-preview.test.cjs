const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requireInput,modelRequest,makePreview}=require('../n8n/publishing/prepare-preview.cjs');
const input={request_id:'12345678-1234-4123-8123-123456789abc',source_text:'SMA Testprodukt 2 ist ein Testartikel für den Shop-Ablauf.',audience:'SMA Testkunden',goal:'Shop-Ablauf kennenlernen',language:'de',media_kind:'video',platforms:['youtube','instagram','facebook','tiktok']};
const ctx={ok:true,status:'processing',input,shop_url:'https://sma-automation.com/app/shop.html?shop=sma-testkunde'};
const draft=p=>({platform:p,title:'SMA Shop kennenlernen',body:'SMA Testprodukt 2 ist ein Testartikel für den Shop-Ablauf.',hashtags:['SMATest','Shop'],review_notes:[]});
const response=ds=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({drafts:ds})}]}]});
test('canonical platform order, no client tenant or URL overrides',()=>{
 assert.deepEqual(requireInput({...input,platforms:['tiktok','youtube']}).platforms,['youtube','tiktok']);
 for(const extra of [{shop_url:'https://evil.com'},{user_id:'foreign'},{customer_id:5}]) assert.throws(()=>requireInput({...input,...extra}));
});
test('input limits, invalid IDs, duplicate platforms and image YouTube rejected',()=>{
 for(const patch of [{source_text:'short'},{source_text:'a'.repeat(8001)},{audience:'a'},{goal:'x'},{request_id:'x'},{platforms:[]},{platforms:['tiktok','tiktok']},{platforms:['unknown']},{media_kind:'image'},{source_text:input.source_text+'\u202e'}])assert.throws(()=>requireInput({...input,...patch}));
});
test('model request has strict schema and does not retain API responses',()=>{
 const req=modelRequest(ctx); assert.equal(req.store,false);assert.equal(req.text.format.strict,true);assert.equal(req.text.format.schema.additionalProperties,false);assert.ok(!req.input.includes('shop_url'));assert.ok(!req.input.includes('request_id'));
});
test('four drafts, one verified shop per caption, never publish-ready',()=>{
 const p=makePreview(response(input.platforms.map(draft)),ctx);
 assert.equal(p.can_publish,false);assert.equal(p.checks.media,'not_checked');assert.equal(p.drafts.length,4);
 for(const d of p.drafts){assert.equal(d.caption.split(ctx.shop_url).length-1,1);assert.match(d.caption,/#SMATest #Shop/);}
});
test('refused, incomplete, malformed and missing platform output fail closed',()=>{
 for(const r of [{status:'incomplete'},response([draft('youtube')]),response([draft('youtube'),draft('youtube'),draft('facebook'),draft('tiktok')]),{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}]) assert.throws(()=>makePreview(r,ctx));
});
test('generated links, profile promises, HTML, controls and duplicate hashtags rejected',()=>{
 for(const patch of [{body:'Mehr unter https://evil.com'},{body:'Jetzt Link im Profil ansehen'},{body:'<script>alert(1)</script>'},{body:'Testbericht mit \u2066Zeichen'},{hashtags:['Test','test']},{hashtags:['unpassend-link.com']},{title:'a'.repeat(81)}]){const ds=input.platforms.map(draft);Object.assign(ds[0],patch);assert.throws(()=>makePreview(response(ds),ctx));}
});
test('wrong tenant shop and non-canonical shop URLs cannot be appended',()=>{
 for(const shop_url of ['https://evil.com','https://sma-automation.com/app/shop.html?shop=test&evil=x','https://sma-automation.com/app/shop.html?shop=../x'])assert.throws(()=>makePreview(response(input.platforms.map(draft)),{...ctx,shop_url}));
});
test('Unicode is preserved and UTF-8 caption budget enforced',()=>{
 const ds=input.platforms.map(draft);ds[0].body='Äpfel, Größe und Qualität: ein verständlicher Testtext.';ds[0].hashtags=['Qualität'];
 assert.match(makePreview(response(ds),ctx).drafts[0].caption,/#Qualität/);
 ds[0].body='界'.repeat(1200);ds[0].hashtags=['界'.repeat(50),'字'.repeat(50),'語'.repeat(50)];assert.ok(Buffer.byteLength(makePreview(response(ds),ctx).drafts[0].caption)<5000);
});
