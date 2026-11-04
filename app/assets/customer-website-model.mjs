import {readCompanyProfile} from './company-profile-model.mjs?v=1';
import {safeShopLink} from './website-domain-model.mjs?v=1';
export const siteUUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const contentLimits={name:100,headline:160,intro:600,about:4000,contact_email:254,legal_notice:6000,privacy_notice:6000,contact_phone:60,contact_address:400,service_1_title:80,service_1_text:400,service_2_title:80,service_2_text:400,service_3_title:80,service_3_text:400};
export const appearanceOptions={accent:['blue','green','violet','terracotta'],hero:['shk','abstract','none','image']};
export const imageFields={logo_image_id:'',hero_image_id:'',hero_image_alt:''};
export const appearanceDefaults={accent:'blue',hero:'shk'};
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function readWebsiteContent(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(contentLimits).some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!Object.hasOwn(contentLimits,k)&&!Object.hasOwn(appearanceOptions,k)&&!Object.hasOwn(imageFields,k)))fail('INVALID_CONTENT');
 if(new TextEncoder().encode(JSON.stringify(value)).length>45000)fail('INVALID_CONTENT');
 const result={};
 for(const [key,max] of Object.entries(contentLimits)){
  if(typeof value[key]!=='string'||[...value[key]].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value[key]))fail('INVALID_CONTENT');
  result[key]=value[key];
 }
 // Optional for existing drafts and published snapshots; only fixed design choices are accepted.
 for(const [key,options] of Object.entries(appearanceOptions))if(Object.hasOwn(value,key)){
  if(!options.includes(value[key]))fail('INVALID_CONTENT');result[key]=value[key];
 }
 for(const key of Object.keys(imageFields))if(Object.hasOwn(value,key)){
  const text=value[key];if(typeof text!=='string'||(key==='hero_image_alt'?([...text].length>200||/[\u0000-\u001f\u007f]/.test(text)):(text!==''&&!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(text))))fail('INVALID_CONTENT');result[key]=text;
 }
 if(result.hero==='image'&&!result.hero_image_id)fail('INVALID_CONTENT');
 if(!result.name.trim()||!result.headline.trim()||result.contact_email&&!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(result.contact_email))fail('INVALID_CONTENT');
 return result;
}
export function websiteURL(id){if(!siteUUID.test(id))fail('INVALID_RESPONSE');return 'https://sma-automation.com/app/website.html?site='+id;}
export function readCustomerWebsite(r){
 if(r?.ok!==true)fail(r?.code||'UNAVAILABLE');
 if(!Number.isSafeInteger(r.revision)||r.revision<0||r.revision>2147483647||['published','publicly_available','has_changes','can_edit'].some(k=>typeof r[k]!=='boolean'))fail('INVALID_RESPONSE');
 if(r.revision===0){if(r.site_id!==null||r.content!==null||r.website_url!==null||r.published||r.publicly_available)fail('INVALID_RESPONSE');}
 else if(r.website_url!==websiteURL(r.site_id))fail('INVALID_RESPONSE');
 const companyRevision=r.company_revision??0;if(!Number.isSafeInteger(companyRevision)||companyRevision<0||companyRevision>2147483647||(companyRevision===0)!==!r.company_profile)fail('INVALID_RESPONSE');
 const company=r.company_profile?readCompanyProfile(r.company_profile):null;
 return {company,companyRevision,revision:r.revision,siteId:r.site_id,content:r.content===null?null:readWebsiteContent(r.content),published:r.published,publiclyAvailable:r.publicly_available,
  hasChanges:r.has_changes,canEdit:r.can_edit,shopURL:safeShopLink(r.shop_url),websiteURL:r.website_url};
}
export function createCustomerWebsiteClient({request,getOwnerId,uuid=()=>crypto.randomUUID()}){
 let owner=null,state=null,pending=null,busy=false,generation=0;
 async function call(action,content){
  if(busy)fail('BUSY');busy=true;const version=generation;
  try{
   const current=await getOwnerId();if(!current||action!=='get'&&current!==owner)fail('AUTH_REQUIRED');
   let input={};
   if(action!=='get'){
    if(!state)fail('AUTH_REQUIRED');
    const intent={...(action==='save'?{content:readWebsiteContent(content)}:{}),...(['save','publish'].includes(action)?{expected_company_revision:state.companyRevision}: {})};
    const signature=JSON.stringify({action,...intent});
    if(!pending||pending.signature!==signature)pending={signature,input:{...intent,expected_revision:state.revision,request_id:uuid()}};
    input=pending.input;
   }
   const raw=await request(action,input);
   if(version!==generation||await getOwnerId()!==current)fail('AUTH_REQUIRED');
   const result=readCustomerWebsite(raw);state=result;owner=current;pending=null;return result;
  }finally{busy=false;}
 }
 return {load:()=>call('get'),generate:()=>call('generate'),save:content=>call('save',content),publish:()=>call('publish'),unpublish:()=>call('unpublish'),invalidate(){generation++;owner=null;state=null;pending=null;}};
}
export function pageMode(search){
 const params=new URLSearchParams(search);
 if(params.size===1&&params.get('preview')==='1')return {preview:true};
 if(params.size===1&&siteUUID.test(params.get('site')||''))return {preview:false,siteId:params.get('site')};
 return null;
}
