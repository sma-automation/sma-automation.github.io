const test=require('node:test');
const assert=require('node:assert/strict');
const ready=import('../app/assets/shop-button.mjs');
const url='https://sma-automation.com/app/shop.html?shop=mein-shop';

test('portable button keeps the exact public shop address without script or account data',async()=>{
 const {createShopButton}=await ready,button=createShopButton(url);
 assert.equal(button.url,url);
 assert.equal(button.previewUrl,'https://sma-automation.com/app/website-connection-test.html?shop=mein-shop');
 assert.match(button.html,/^<a href="https:\/\/sma-automation\.com\/app\/shop\.html\?shop=mein-shop" style="[^"]+">Zum Shop<\/a>$/);
 assert.doesNotMatch(button.html,/<script|<iframe|onclick|access_token|customer_id|user_id|tracking/i);
 assert.match(button.html,/font:inherit/);
});
test('untrusted links and injected markup never produce a shop button',async()=>{
 const {createShopButton}=await ready;
 for(const value of [null,{},'',url+'\n',url+'&token=secret',url+'#x',url.replace('.com','.com.evil.test'),url.replace('https:','http:'),'javascript:alert(1)',url+'"><img src=x onerror=alert(1)>'])assert.equal(createShopButton(value),null);
});
test('preview accepts one public slug and refuses alternate destinations and duplicate parameters',async()=>{
 const {shopButtonFromSearch}=await ready;
 assert.equal(shopButtonFromSearch('?shop=mein-shop').url,url);
 for(const query of ['',null,'?shop=','?shop=one&shop=two','?shop=one&url=https://evil.test','?shop=one%22%3E%3Cscript%3E','?shop=one%0A','?shop=UPPER','?shop='+('x'.repeat(81))])assert.equal(shopButtonFromSearch(query),null);
});
