'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const canonical='supabase/sql/publication-tiktok-aigc.sql';
const migration='supabase/migrations/20261110110100_publication_tiktok_aigc_v1.sql';

test('TikTok AIGC SQL migration is guarded, additive and identical to its canonical source',()=>{
 const sql=read(canonical);
 assert.equal(read(migration),sql);
 assert.match(sql,/ce9dc4edbe66a00ce89924c1a91b49d1/);
 assert.match(sql,/TIKTOK_AIGC_ORDER_BASELINE_CHANGED/);
 assert.match(sql,/jsonb_object_keys\(ch\).*is_aigc/);
 assert.match(sql,/array\['disable_comment'.*'is_aigc'\]/);
 assert.match(sql,/platform'<>\s*'tiktok'.*is_aigc/);
 assert.match(sql,/execute replace\(definition,old_portal,new_portal\)/);
 assert.doesNotMatch(sql,/\b(insert into|update\s+\S+\s+set|delete from|drop\s+table|grant|revoke|alter\s+table|http_post|http_get)\b/i);
 assert.equal((sql.match(/create\s+table/gi)||[]).length,0);
});
test('TikTok AIGC UI is an explicit choice and review remains linked to immutable order',()=>{
 const ui=read('app/assets/publication-order.mjs');
 assert.match(ui,/select\('is_aigc','Ist das Video KI-generiert\?',/);
 assert.match(ui,/is_aigc:'KI-generierter Inhalt'/);
 assert.match(ui,/s\.required=true/);
 assert.match(ui,/reviewConfirmation\(order,reviewValues\(\)\)/);
 assert.match(read('app/assets/publication-preview.js'),/publication-order\.mjs\?v=24/);
 assert.match(read('app/publication-preview.html'),/publication-preview\.js\?v=86/);
});
test('generated dispatcher requires exact flag and sends explicit post_info.is_aigc',()=>{
 const source=read('n8n/publishing/patch-provider-cover.py');
 assert.match(source,/TIKTOK_AIGC_PROVIDER_BASELINE_CHANGED/);
 assert.match(source,/TIKTOK_AIGC_NODE_COUNT_CHANGED/);
 assert.match(source,/patched!=4/);
 assert.match(source,/old_keys=.*brand_organic_toggle/);
 assert.match(source,/new_keys=.*is_aigc/);
 assert.match(source,/new_body=.*is_aigc:choices\.is_aigc/);
 assert.doesNotMatch(source,/is_aigc:true|is_aigc:false/);
});
