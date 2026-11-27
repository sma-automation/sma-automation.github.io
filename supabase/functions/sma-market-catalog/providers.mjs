const shopDomain=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const service='https://www.digistore24.com/api/call/';
const httpOptions={redirect:'error',cache:'no-store'};
export function fail(code){throw Object.assign(new Error(code),{code});}
function cleanHtml(s){return String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");}
async function jsonFetch(url,options){
 let response;try{response=await fetch(url,{...httpOptions,...options,signal:AbortSignal.timeout(10000)});}catch{fail('TEMPORARY');}
 if([401,403].includes(response.status))fail('RECONNECT');
 if(response.status===429||response.status>=500)fail('TEMPORARY');
 if(!response.ok)fail('REJECTED');
 try{return await response.json();}catch{fail('TEMPORARY');}
}
async function shopApi(domain,credentials){
 if(!shopDomain.test(domain))fail('CONFLICT');
 const token=await jsonFetch('https://'+domain+'/admin/oauth/access_token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'client_credentials',client_id:credentials.client_id,client_secret:credentials.client_secret})
 });
 if(!token.access_token||!String(token.scope??'').split(',').map(x=>x.trim()).includes('write_products'))fail('RECONNECT');
 return async(query,variables={})=>{
  const r=await jsonFetch('https://'+domain+'/admin/api/2026-07/graphql.json',{method:'POST',
   headers:{'Content-Type':'application/json','X-Shopify-Access-Token':token.access_token},body:JSON.stringify({query,variables})});
  if(r.errors?.length)fail(r.errors.some(e=>e.extensions?.code==='THROTTLED')?'TEMPORARY':'REJECTED');
  return r.data;
 };
}
function digiApi(key){
 return async(name,params={},method='GET')=>{
  const pairs=new URLSearchParams(params);
  const url=service+name+(method==='GET'&&pairs.size?'?'+pairs:'');
  const r=await jsonFetch(url,{method,headers:{'X-DS-API-KEY':key,'Accept':'application/json',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:pairs}:{})});
  if(r.result!=='success'||r.data==null)fail('REJECTED');
  return r.data;
 };
}
function list(data,...keys){
 if(Array.isArray(data))return data;
 for(const key of keys)if(Array.isArray(data?.[key]))return data[key];
 fail('CHECK_RESULT');
}
function id(v){if(!/^[1-9][0-9]*$/.test(String(v??'')))fail('CHECK_RESULT');return String(v);}
function ensure(result){if(!result||result.userErrors?.length)fail('REJECTED');return result;}
const shopInfo='{shop{myshopifyDomain currencyCode}}';
export async function verifyConnection(market,identity,credentials,categories){
 if(market==='shopify'){
  if(!shopDomain.test(identity)||!credentials.client_id||!credentials.client_secret)fail('PRODUCT_INPUT');
  const request=await shopApi(identity,credentials);
  const s=(await request(shopInfo)).shop;
  if(s.myshopifyDomain!==identity||s.currencyCode!=='EUR')fail('CONFLICT');
  return {identity:s.myshopifyDomain};
 }
 if(market!=='digistore24'||!credentials.key)fail('PRODUCT_INPUT');
 const api=digiApi(credentials.key);const user=await api('getUserInfo');
 if(!user.user_name||String(user.user_name).toLowerCase()!==identity.toLowerCase()||!String(user.granted_roles||'').split(',').some(x=>['merchant','vendor'].includes(x.trim())))fail('CONFLICT');
 const result=await api('listProductTypes');
 const types=list(result,'product_types').filter(v=>v.is_active==='Y'&&['digital','download','service','shipping'].includes(v.delivery_type))
  .map(v=>({id:Number(v.id),name:String(v.selection_label||v.name),delivery:v.delivery_type}));
 if(categories!=null){
  const groups={Digital:['digital','download'],Dienstleistung:['service'],Physisch:['shipping']};
  if(typeof categories!=='object'||!Object.keys(categories).length||!Object.entries(categories).every(([k,id])=>groups[k]&&types.some(t=>t.id===id&&groups[k].includes(t.delivery))))fail('CATEGORY');
 }
 return {identity:user.user_name,types};
}
const variantFields='id sku price inventoryItem{requiresShipping}';
const productFields='id title description status handle variants(first:2){nodes{'+variantFields+'}}';
const productQuery='query($id:ID!){product(id:$id){'+productFields+'}}';
const single=(p)=>{if(!p||p.variants.nodes.length!==1)fail('CONFLICT');return p.variants.nodes[0];};
const money=(x)=>Math.round(Number(x)*100);
export async function mirrorShop(job,call,api){
 api??=await shopApi(job.identity,job.credentials);
 const {shop}=await api(shopInfo);if(shop.myshopifyDomain!==job.identity||shop.currencyCode!==job.currency)fail('CONFLICT');
 const handle='sma-'+job.source_id;let product;
 if(job.remote_id){product=(await api(productQuery,{id:job.remote_id})).product;if(!product)fail('CONFLICT');}
 else{
  const matches=(await api('query($q:String!){productVariants(first:3,query:$q){nodes{sku product{'+productFields+'}}pageInfo{hasNextPage}}}',{q:'sku:"'+job.sku+'"' })).productVariants;
  const exact=matches.nodes.filter(v=>v.sku===job.sku);
  if(matches.pageInfo.hasNextPage||exact.length>1)fail('CONFLICT');
  product=exact[0]?.product;
  if(product&&(product.title!==job.title||money(single(product).price)!==money(job.price)))fail('CONFLICT');
  if(!product){
   product=(await api('query($key:ProductIdentifierInput!){productByIdentifier(identifier:$key){'+productFields+'}}',{key:{handle}})).productByIdentifier;
   if(product&&single(product).sku!==job.sku)fail('CONFLICT');
  }
  if(!product){
   if(job.prior_stage)fail('CHECK_RESULT');
   await call('before_create',{stage:'product'});
   const data=await api('mutation($input:ProductSetInput!,$key:ProductSetIdentifiers!){productSet(synchronous:true,input:$input,identifier:$key){product{'+productFields+'}userErrors{field message}}}',{
    key:{handle},input:{title:job.title,handle,descriptionHtml:cleanHtml(job.description),status:'DRAFT',productOptions:[{name:'Title',values:[{name:'Default Title'}]}],
     variants:[{optionValues:[{optionName:'Title',name:'Default Title'}],sku:job.sku,price:String(job.price),inventoryItem:{requiresShipping:job.kind==='Physisch'}}]}});
   product=ensure(data.productSet).product;
  }
  const v=single(product);if(v.sku!==job.sku)fail('CONFLICT');
  await call('bind',{remote_id:product.id,variant_id:v.id});
 }
 const v=single(product);
 if(v.sku!==job.sku||job.variant_id&&v.id!==job.variant_id||product.status==='ARCHIVED')fail('CONFLICT');
 if(product.title!==job.title||product.description!==job.description){
  const r=await api('mutation($p:ProductUpdateInput!){productUpdate(product:$p){product{id}userErrors{field message}}}',{p:{id:product.id,title:job.title,descriptionHtml:cleanHtml(job.description)}});ensure(r.productUpdate);
 }
 const requiresShipping=job.kind==='Physisch';
 if(money(v.price)!==money(job.price)||v.inventoryItem.requiresShipping!==requiresShipping){
  const r=await api('mutation($id:ID!,$v:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$id,variants:$v){productVariants{id}userErrors{field message}}}',{id:product.id,v:[{id:v.id,price:String(job.price),inventoryItem:{requiresShipping}}]});ensure(r.productVariantsBulkUpdate);
 }
 const actual=(await api(productQuery,{id:product.id})).product;const checked=single(actual);
 if(actual.title!==job.title||actual.description.replace(/\s+/g,' ').trim()!==job.description.replace(/\s+/g,' ').trim()||checked.inventoryItem.requiresShipping!==requiresShipping||checked.id!==v.id||checked.sku!==job.sku||money(checked.price)!==money(job.price))fail('CHECK_RESULT');
}
export async function mirrorDigi(job,call,api){
 api??=digiApi(job.credentials.key);
 const user=await api('getUserInfo');if(user.user_name!==job.identity)fail('RECONNECT');
 const category=job.credentials.categories?.[job.kind];if(!Number.isSafeInteger(category)||category<1)fail('CATEGORY');
 const marker='SMA-'+job.source_id;const title=Array.from(job.title).slice(0,63).join('');
 const attrs={'data[product_type_id]':String(category),'data[name_intern]':marker,'data[name_de]':title,'data[description_de]':cleanHtml(job.description)};
 let remote=job.remote_id,planId=job.plan_id;
 if(!remote){
  const products=list(await api('listProducts'),'products','items');
  const matches=products.filter(p=>p.name_intern===marker||p.name===marker);
  if(matches.length>1||products.some(p=>!matches.includes(p)&&[p.name,p.name_de,p.name_intern].includes(title)))fail('CONFLICT');
  if(matches.length) remote=id(matches[0].id??matches[0].product_id);
  else{
   if(job.prior_stage)fail('CHECK_RESULT');await call('before_create',{stage:'product'});
   const r=await api('createProduct',{...attrs,'data[approval_status]':'new','data[is_active]':'N','data[language]':'de'},'POST');
   remote=id(r.product_id);
  }
  await call('bind',{remote_id:remote});
 }
 const details=await api('getProduct',{product_id:remote});
 if(String(details.id??details.product_id)!==remote||![details.name_intern,details.name].includes(marker))fail('CONFLICT');
 if(String(details.product_type_id)!==String(category)||details.name_de!==title||details.description_de!==attrs['data[description_de]'])
  await api('updateProduct',{product_id:remote,...attrs},'POST');
 const plans=list(await api('listPaymentPlans',{product_id:remote}),'payment_plans','paymentplans','plans','items');
 if(planId&&!plans.some(p=>String(p.id??p.paymentplan_id)===planId))fail('CONFLICT');
 if(!planId){
  if(plans.length||job.prior_stage==='price')fail('CHECK_RESULT');
  await call('before_create',{stage:'price'});
  const created=await api('createPaymentplan',{product_id:remote,'data[first_amount]':String(job.price),'data[currency]':job.currency,'data[number_of_installments]':'1','data[is_active]':'Y'},'POST');
  planId=id(created.paymentplan_id);await call('bind',{remote_id:remote,plan_id:planId});
 }else{
  await api('updatePaymentplan',{paymentplan_id:planId,'data[first_amount]':String(job.price),'data[currency]':job.currency},'POST');
 }
 const saved=await api('getProduct',{product_id:remote});
 const savedPlans=list(await api('listPaymentPlans',{product_id:remote}),'payment_plans','paymentplans','plans','items');
 const confirmedPlan=savedPlans.find(x=>String(x.id??x.paymentplan_id)===planId);
 if(!confirmedPlan||(confirmedPlan.first_amount!=null&&money(confirmedPlan.first_amount)!==money(job.price))||
    (confirmedPlan.currency!=null&&confirmedPlan.currency!==job.currency))fail('CHECK_RESULT');
 if(String(saved.id??saved.product_id)!==remote||![saved.name_intern,saved.name].includes(marker)||saved.name_de!==title||
    (saved.product_type_id!=null&&String(saved.product_type_id)!==String(category))||
    (saved.description_de!=null&&saved.description_de!==attrs['data[description_de]']))fail('CHECK_RESULT');
}
