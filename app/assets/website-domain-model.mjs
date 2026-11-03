const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function normalizeDomain(value){
 if(typeof value!=='string')fail('INVALID_DOMAIN');
 const host=value.trim().toLowerCase();
 if(!host)return '';
 if(host.length>253||host!==host.replace(/[^a-z0-9.-]/g,'')||!host.includes('.'))fail('INVALID_DOMAIN');
 const labels=host.split('.');
 if(labels.some(s=>!s||s.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)))fail('INVALID_DOMAIN');
 const tld=labels.at(-1);
 if(!/^[a-z]{2,63}$/.test(tld)||['localhost','local','internal','test','invalid','example'].includes(tld))fail('INVALID_DOMAIN');
 return host;
}
export function normalizeWebsite(value){
 if(typeof value!=='string')fail('INVALID_WEBSITE');
 let url=value.trim();
 if(!url)return '';
 if(!url.includes('://'))url='https://'+url;
 if(url.length>2048||!/^https:\/\/[\x21-\x7e]+$/.test(url)||/[\\?#]/.test(url))fail('INVALID_WEBSITE');
 const match=/^https:\/\/([^/]+)(\/.*)?$/.exec(url);
 if(!match)fail('INVALID_WEBSITE');
 let host;try{host=normalizeDomain(match[1]);}catch{fail('INVALID_WEBSITE');}
 if(!host)fail('INVALID_WEBSITE');
 return 'https://'+host+(match[2]||'/');
}
export function normalizeDraft(input){
 if(!input||!['existing','new'].includes(input.mode))fail('INVALID_MODE');
 const website_url=normalizeWebsite(input.website_url===undefined?'':input.website_url);
 const desired_domain=normalizeDomain(input.desired_domain===undefined?'':input.desired_domain);
 if(input.mode==='existing'&&!website_url)fail('WEBSITE_REQUIRED');
 if(input.mode==='new'&&website_url)fail('INVALID_WEBSITE');
 return {mode:input.mode,website_url,desired_domain};
}
export function safeShopLink(value){
 if(typeof value!=='string')return null;
 return /^https:\/\/sma-automation\.com\/app\/shop\.html\?shop=[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.split('shop=')[1].length<=80?value:null;
}
export function readWebsiteState(value){
 if(!value||value.ok!==true)fail(value?.code||'UNAVAILABLE');
 if(value.state!=='preparation'||value.can_publish!==false||!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>2147483647)fail('INVALID_RESPONSE');
 const draft=value.draft===null?null:normalizeDraft(value.draft);
 if((draft===null)!==(value.revision===0))fail('INVALID_RESPONSE');
 return {revision:value.revision,draft,updated_at:typeof value.updated_at==='string'?value.updated_at:null,shop_url:safeShopLink(value.shop_url)};
}
// request() accepts only action + the caller-owned draft; never an account ID.
// A lost save response reuses its request UUID and expected revision.
export function createWebsiteDraftClient({request,getOwnerId,uuid}){
 let owner=null,revision=0,lastRequest=null,busy=false;
 async function currentOwner(){
  const value=await getOwnerId();
  if(!value)fail('AUTH_REQUIRED');
  return value;
 }
 async function run(fn){if(busy)fail('BUSY');busy=true;try{return await fn();}finally{busy=false;}}
 return {
  load:()=>run(async()=>{
   const next=await currentOwner();
   const result=readWebsiteState(await request('get',{}));
   if(await currentOwner()!==next)fail('AUTH_REQUIRED');
   owner=next;revision=result.revision;lastRequest=null;return result;
  }),
  save:input=>run(async()=>{
   if(!owner||await currentOwner()!==owner)fail('AUTH_REQUIRED');
   const draft=normalizeDraft(input),signature=JSON.stringify(draft);
   if(!lastRequest||lastRequest.signature!==signature){
    const request_id=uuid();if(!UUID.test(request_id))fail('INVALID_REQUEST');
    lastRequest={signature,input:{...draft,expected_revision:revision,request_id}};
   }
   const result=readWebsiteState(await request('save',lastRequest.input));
   if(await currentOwner()!==owner)fail('AUTH_REQUIRED');
   revision=result.revision;lastRequest=null;return result;
  })
 };
}
