import test from 'node:test';
import assert from 'node:assert/strict';
import {mirrorShop, mirrorDigi} from '../supabase/functions/sma-market-catalog/providers.mjs';

const article = {
  source_id:'00000000-0000-4000-8000-000000000001', sku:'BOOK-1', title:'Handbuch',
  description:'Digitales Handbuch', price:12.50, currency:'EUR', kind:'Digital'
};
const shopJob = {...article,identity:'example.myshopify.com'};
const variant = {id:'v1',sku:article.sku,price:'12.50',inventoryItem:{requiresShipping:false}};
const product = {id:'p1',handle:'sma-'+article.source_id,status:'DRAFT',title:article.title,
  description:article.description,variants:{nodes:[variant]}};

function shopApi({handleMatch,create}={}){
  return async(query,variables)=>{
    if(query.includes('myshopifyDomain'))return {shop:{myshopifyDomain:shopJob.identity,currencyCode:'EUR'}};
    if(query.includes('productVariants(first:3'))return {productVariants:{nodes:[],pageInfo:{hasNextPage:false}}};
    if(query.includes('productByIdentifier'))return {productByIdentifier:handleMatch??null};
    if(query.includes('productSet(')){assert.ok(create);create(variables);return {productSet:{product,userErrors:[]}};}
    if(query.includes('product(id:'))return {product};
    assert.fail('Unexpected Shopify operation');
  };
}
test('New article creates one private product with the source handle, SKU and price',async()=>{
  const steps=[];
  await mirrorShop(shopJob,async op=>steps.push(op),shopApi({create:({input,key})=>{
    assert.equal(input.handle,key.handle);assert.equal(input.status,'DRAFT');
    assert.equal(input.variants[0].sku,article.sku);assert.equal(input.variants[0].price,'12.5');
  }}));
  assert.deepEqual(steps,['before_create','bind']);
});
test('Interrupted product write recovers by handle when SKU search is still empty',async()=>{
  const steps=[];
  await mirrorShop({...shopJob,prior_stage:'product'},async op=>steps.push(op),shopApi({handleMatch:product}));
  assert.deepEqual(steps,['bind']);
});
test('No second create after a write with an unknown outcome',async()=>{
  await assert.rejects(mirrorShop({...shopJob,prior_stage:'product'},assert.fail,shopApi()),{code:'CHECK_RESULT'});
});

const digiJob={...article,identity:'sample',credentials:{categories:{Digital:12}}};
function digiApi({hasProduct=false,hasPlan=false,price='12.50'}={}){
  const saved={id:7,name_intern:'SMA-'+article.source_id,name_de:article.title,description_de:article.description,product_type_id:'12'};
  return async(name,params)=>{
    switch(name){
      case 'getUserInfo':return {user_name:digiJob.identity};
      case 'listProducts':return {products:hasProduct?[saved]:[]};
      case 'createProduct':assert.equal(params['data[is_active]'],'N');hasProduct=true;return {product_id:7};
      case 'getProduct':assert.ok(hasProduct);return saved;
      case 'listPaymentPlans':return {paymentplans:hasPlan?[{id:8,currency:'EUR',first_amount:price}]:[]};
      case 'createPaymentplan':assert.equal(params['data[first_amount]'],'12.5');hasPlan=true;return {paymentplan_id:8};
      default:assert.fail('Unexpected Digistore24 operation');
    }
  };
}
test('Digistore24 confirms both private product and one EUR price plan',async()=>{
  const steps=[];
  await mirrorDigi(digiJob,async(op,args)=>steps.push([op,args]),digiApi());
  assert.deepEqual(steps.map(s=>s[0]),['before_create','bind','before_create','bind']);
  assert.equal(steps[3][1].plan_id,'8');
});
test('Ambiguous existing price plan needs review and is never duplicated',async()=>{
  await assert.rejects(mirrorDigi({...digiJob,remote_id:'7',prior_stage:'price'},assert.fail,digiApi({hasProduct:true,hasPlan:true})),{code:'CHECK_RESULT'});
});
test('Digistore24 refuses to confirm a mismatched price returned by the market',async()=>{
  await assert.rejects(mirrorDigi(digiJob,async()=>{},digiApi({price:'8.00'})),{code:'CHECK_RESULT'});
});
