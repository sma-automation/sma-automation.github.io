const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validatePages}=require('../n8n/order-reconciliation-validate.cjs');
const claim={claimed:true,shop_domain:'example.myshopify.com',kunde_id:'customer',markt_konto_id:'account'};
const sample={id:'gid://shopify/Order/1',name:'#1',createdAt:'2026-10-01T10:00:00Z',updatedAt:'2026-10-01T11:00:00Z',displayFinancialStatus:'PAID',displayFulfillmentStatus:'UNFULFILLED',currentTotalPriceSet:{shopMoney:{amount:'45.89',currencyCode:'EUR'}}};
const page=(nodes=[structuredClone(sample)],more=false,cursor='cursor1')=>({data:{orders:{nodes,pageInfo:{hasNextPage:more,endCursor:cursor}}}});
test('complete pages preserve money precision and mapping',()=>{
 const b={...structuredClone(sample),id:'gid://shopify/Order/2'};
 const out=validatePages([page(undefined,true),page([b],false,'cursor2')],claim);
 assert.equal(out.orders.length,2);assert.equal(out.orders[0].gesamtbetrag,'45.89');assert.equal(out.orders[0].zahlungsstatus,'paid');assert.equal(out.orders[0].lieferstatus,'unfulfilled');assert.equal(out.pages,2);assert.equal(out.markt_konto_id,'account');
});
test('empty valid store succeeds',()=>assert.equal(validatePages([page([])],claim).orders.length,0));
test('pagination cap cannot silently truncate',()=>assert.throws(()=>validatePages([page(undefined,true)],claim),/INCOMPLETE/));
test('repeated pagination cursor rejected',()=>assert.throws(()=>validatePages([page([],true),page([],true),page([])],claim),/CURSOR/));
test('duplicated order across pages rejected',()=>assert.throws(()=>validatePages([page(undefined,true),page()],claim),/ORDER_ID/));
test('HTTP error output rejected',()=>assert.throws(()=>validatePages([{error:{message:'secret'}}],claim),/SHOPIFY_ERROR/));
test('GraphQL partial errors reject entire response',()=>assert.throws(()=>validatePages([{...page(),errors:[{message:'throttled'}]}],claim),/SHOPIFY_ERROR/));
test('missing data rejected',()=>assert.throws(()=>validatePages([{}],claim),/INVALID_PAGE/));
test('unexpected extra page rejected',()=>assert.throws(()=>validatePages([page(),page([])],claim),/PAGINATION/));
test('non-Shopify target rejected',()=>assert.throws(()=>validatePages([page()],{...claim,shop_domain:'evil.example'}),/CLAIM/));
for(const [name,mutate] of [
 ['malformed id',o=>o.id='gid://shopify/Product/1'],
 ['invalid timestamp',o=>o.updatedAt='never'],
 ['backwards timestamp',o=>o.updatedAt='2026-09-01T00:00:00Z'],
 ['future timestamp',o=>o.updatedAt='2099-01-01T00:00:00Z'],
 ['negative money',o=>o.currentTotalPriceSet.shopMoney.amount='-1'],
 ['NaN money',o=>o.currentTotalPriceSet.shopMoney.amount='NaN'],
 ['numeric money',o=>o.currentTotalPriceSet.shopMoney.amount=45.89],
 ['unknown currency',o=>o.currentTotalPriceSet.shopMoney.currencyCode='eur'],
 ['unknown payment',o=>o.displayFinancialStatus='MYSTERY'],
 ['unknown fulfillment',o=>o.displayFulfillmentStatus='MYSTERY'],
]) test(name+' rejected',()=>{const o=structuredClone(sample);mutate(o);assert.throws(()=>validatePages([page([o])],claim));});
test('nullable financial status remains unknown',()=>{const o={...sample,displayFinancialStatus:null};assert.equal(validatePages([page([o])],claim).orders[0].zahlungsstatus,'unknown');});

const workflow=require('../n8n/order-reconciliation-workflow.json');
const http=workflow.nodes.find(n=>n.name==='Shopify Seiten lesen');
// n8n terminates an expression at the first }}: adjacent nested object braces
// must be separated, even when the enclosed text is otherwise valid JavaScript.
function expression(value, context) {
 const first=value.indexOf('}}',3);assert.equal(first,value.lastIndexOf('}}'));
 return require('node:vm').runInNewContext('('+value.slice(3,first).trim()+')',context);
}
test('n8n request expression is parseable and pins the merchant cutoff',()=>{
 const request=expression(http.parameters.jsonBody,{$:()=>({item:{json:{cutoff:'2026-11-01T10:00:00Z'}}})});
 assert.equal(request.variables.first,50);assert.equal(request.variables.after,null);
 assert.equal(request.variables.filter,"updated_at:<='2026-11-01T10:00:00Z'");
 assert.match(request.query,/currentTotalPriceSet/);
});
test('pagination advances cursor without relying on unavailable n8n item linking',()=>{
 const code=http.parameters.options.pagination.pagination.parameters.parameters[0].value;
 const vars=expression(code,{$request:{body:{variables:{first:50,after:null,filter:'fixed'}}},$response:{body:{data:{orders:{pageInfo:{endCursor:'next'}}}}}});
 assert.deepEqual(JSON.parse(JSON.stringify(vars)),{first:50,after:'next',filter:'fixed'});
});
test('HTTP failures and incomplete pages cannot reach database completion',()=>{
 assert.equal(http.onError,'continueErrorOutput');
 assert.equal(workflow.connections[http.name].main[1][0].node,'Fehler festhalten');
 assert.equal(workflow.connections['Bestellungen validieren'].main[1][0].node,'Fehler festhalten');
 assert.equal(http.parameters.options.redirect.redirect.followRedirects,false);
});
test('published template has bounded execution and no credential-payload persistence',()=>{
 assert.equal(workflow.settings.executionTimeout,480);
 assert.equal(workflow.settings.saveDataErrorExecution,'none');
 assert.equal(workflow.settings.saveDataSuccessExecution,'none');
 assert.equal(workflow.settings.saveManualExecutions,false);
 assert.deepEqual(workflow.pinData,{});
});
