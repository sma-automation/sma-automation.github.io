'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const root=join(__dirname,'..');
const chapterCss=readFileSync(join(root,'app/assets/dashboard-chapters.css'),'utf8');
const historyCss=readFileSync(join(root,'app/assets/publication-history.css'),'utf8');

test('narrow History override keeps the approved font and blue active underline',()=>{
 const marker='/* Keep all three History chapter tabs on one line on narrow 320px phones.';
 const start=historyCss.indexOf(marker);
 assert.ok(start>=0,'History-specific compact navigation override is present');
 const override=historyCss.slice(start);
 assert.match(override,/@media\(max-width:359px\)/);
 assert.match(override,/#page-history \.sma-chapters\{gap:0 6px!important\}/);
 assert.match(override,/#page-history \.sma-chapters>button\{padding-left:9px!important;padding-right:9px!important\}/);
 assert.doesNotMatch(override,/font-family|font-size|\[aria-selected/,'The narrow override must not restyle typography or selection');
 assert.match(chapterCss,/\.sma-chapters>button\[aria-selected=true\]/);
 assert.match(chapterCss,/border-bottom-color:#4065d8!important/);
});
