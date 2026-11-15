import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';

// No network or real customers. Test the installed SQL with synthetic owners.
const db=new PGlite(), id=n=>'bca00000-0000-4000-8000-'+String(n).padStart(12,'0');
const uid=id(100),other=id(101),shop=n=>'https://sma-automation.com/app/shop.html?shop='+n;
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const preview=(language,customer='fixture',kind='shop',body='Eine sachliche Beschreibung unseres zehnsekündigen Testvideos.',hashtags=['SMA','Video'],platforms=['youtube'])=>{
 const url=shop(customer),dest=kind==='product'?'🛒 '+(language==='en'?'View product: ':'Zum Produkt: ')+url+'&produkt=sku_01':
 '🛒 '+(language==='en'?'Visit our shop: ':'Zum Shop: ')+url;
 return {version:1,stage:'text_preview',can_publish:false,shop_url:url,language,drafts:platforms.map(platform=>({
  platform,title:'Testclip',body,hashtags,review_notes:[],
  ...(kind==='product'?{product_id:'sku_01'}:{}),
  caption:[body,hashtags.map(x=>'#'+x).join(' '),dest].filter(Boolean).join('\n\n')
 }))};
};
const setup=async(n,owner,customer,language,status='processing',content=null,platforms=['youtube'])=>{
 const key=id(n),lease=id(n+500);
 await db.query('insert into sma_private.publication_previews_v1(id,user_id,customer_id,input,shop_url,status,lease_id,lease_until,preview) values($1,$2,$3,$4,$5,$6,$7,now()+interval \'10 minutes\',$8)',
 [key,owner,owner===uid?1:2,{language,media_kind:'video',platforms},shop(customer),status,lease,content]);
 return {key,lease};
};
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;create table public.sma_kunden(id bigint primary key,user_id uuid,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean,shop_slug text,shop_oeffentlich boolean);grant select on public.sma_kunden to service_role;");
 await db.exec(await readFile(new URL('../supabase/sql/publication-preview.sql',import.meta.url),'utf8'));
 await db.query('insert into public.sma_kunden values(1,$1,true,true,false,\'fixture\',true),(2,$2,true,true,false,\'other\',true)',[uid,other]);
 const older=await setup(1,uid,'fixture','de','completed',preview('de'));
 await db.exec(await readFile(new URL('../supabase/sql/publication-shop-invitation.sql',import.meta.url),'utf8'));
 const before=(await db.query('select preview from sma_private.publication_previews_v1 where id=$1',[older.key])).rows[0].preview;
 eq(before.drafts[0].body.includes('Schau doch mal'),false);
 for(const [n,owner,customer,language,kind] of [[10,uid,'fixture','de','shop'],[20,other,'other','en','shop'],[30,uid,'fixture','de','product']]){
  const input=preview(language,customer,kind),{key,lease}=await setup(n,owner,customer,language);
  await db.exec('set role service_role');
  const result=(await db.query('select public.sma_publication_preview_finish_v1($1,$2,$3) as r',[key,lease,input])).rows[0].r;
  await db.exec('reset role');
  eq(result.ok,true);
  const d=result.preview.drafts[0];
  const call=language==='en'?'Feel free to visit my shop!':'Schau doch mal in meinem Shop vorbei!';
  eq(d.body.endsWith('\n\n'+call),true);
  eq(d.caption.split(call).length-1,1);
  eq(d.caption.split(shop(customer)).length-1,1);
  eq(d.caption.endsWith(kind==='shop'?shop(customer):shop(customer)+'&produkt=sku_01'),true);
  eq(result.preview.can_publish,false);
  const stored=(await db.query('select preview from sma_private.publication_previews_v1 where id=$1',[key])).rows[0].preview;
  eq(stored.drafts[0],d);
  await db.query('update sma_private.publication_previews_v1 set preview=preview where id=$1',[key]);
  const unchanged=(await db.query('select preview from sma_private.publication_previews_v1 where id=$1',[key])).rows[0].preview;
  eq(unchanged.drafts[0],d);
 }
 // Four-channel acceptance, for two separate customers and both languages.
 // Check the actual SQL trigger after finish, then repeat the UPDATE to confirm
 // that no second invitation, footer or cross-customer link is ever introduced.
 const portals=['youtube','tiktok','instagram','facebook'];
 for(const [n,owner,customer,lang,kind] of [
  [60,uid,'fixture','de','shop'],
  [70,other,'other','en','product']
 ]){
  const input=preview(lang,customer,kind,
   lang==='de'?'Eine unaufgeregte Beschreibung einer Testszene mit sichtbaren Handlungen.':
    'A short factual description of a synthetic scene and visible details.',
   ['SMA','Demo'],portals);
  const {key,lease}=await setup(n,owner,customer,lang,'processing',null,portals);
  await db.exec('set role service_role');
  const result=(await db.query('select public.sma_publication_preview_finish_v1($1,$2,$3) as r',
   [key,lease,input])).rows[0].r;
  await db.exec('reset role');
  eq(result.ok,true);
  eq(result.preview.drafts.map(d=>d.platform),portals);
  const invite=lang==='de'?'Schau doch mal in meinem Shop vorbei!':'Feel free to visit my shop!';
  const link=kind==='product'?shop(customer)+'&produkt=sku_01':shop(customer);
  for(const draft of result.preview.drafts){
   eq(draft.body.endsWith('\n\n'+invite),true);
   eq(draft.caption.split(invite).length-1,1);
   eq(draft.caption.split(shop(customer)).length-1,1);
   eq(draft.caption.endsWith(link),true);
   eq(draft.caption.includes(shop(customer==='fixture'?'other':'fixture')),false);
   eq(draft.caption.includes('#SMA #Demo'),true);
  }
  eq(result.preview.can_publish,false);
  await db.query('update sma_private.publication_previews_v1 set preview=preview where id=$1',[key]);
  const afterRepeat=(await db.query('select preview from sma_private.publication_previews_v1 where id=$1',[key])).rows[0].preview;
  eq(afterRepeat,result.preview);
 }
 // Saved edits cannot silently discard the standard invitation.
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 await db.exec('set role authenticated');
 const saved=(await db.query("select public.sma_publication_preview_v1('save',$1,$2) as r",[
  {revision:1,drafts:[{platform:'youtube',title:'Bearbeiteter Titel',
   body:'Eine neu formulierte und weiterhin sachliche Beschreibung des Testvideos.',hashtags:['Neu']}]},id(10)])).rows[0].r;
 await db.exec('reset role');
 eq(saved.ok,true);
 eq(saved.preview.drafts[0].body.endsWith('\n\nSchau doch mal in meinem Shop vorbei!'),true);
 eq(saved.preview.drafts[0].caption.split(shop('fixture')).length-1,1);
 eq(saved.preview.can_publish,false);
 // For bodies at the input limit, keep all factual content and add the CTA
 // to the complete caption without cutting any customer text.
 const long=preview('de','fixture','shop','A'.repeat(1200));
 const row=await setup(40,uid,'fixture','de','completed',long);
 const output=(await db.query('select preview from sma_private.publication_previews_v1 where id=$1',[row.key])).rows[0].preview.drafts[0];
 eq(output.body.length,1200);
 eq(output.caption.includes('Schau doch mal in meinem Shop vorbei!'),true);
 eq(output.caption.endsWith(shop('fixture')),true);
 const invalid=preview('de');invalid.drafts[0].caption='Fremder Link: https://evil.invalid';
 const bad=await setup(50,uid,'fixture','de','completed',invalid);
 const untouched=(await db.query('select preview from sma_private.publication_previews_v1 where id=$1',[bad.key])).rows[0].preview.drafts[0];
 eq(untouched.body,invalid.drafts[0].body);
 eq(untouched.caption,invalid.drafts[0].caption);
 const after=(await db.query('select preview from sma_private.publication_previews_v1 where id=$1',[older.key])).rows[0].preview;
 eq(before,after);
 eq((await db.query('select count(*)::integer as n from sma_private.publication_previews_v1')).rows[0].n,8);
 console.log(checks+' customer-shop CTA SQL checks passed.');
} finally {await db.close();}
