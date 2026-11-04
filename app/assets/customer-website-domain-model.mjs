// One explicit public site per test host. This is not a multi-tenant domain registry.
export function readDomainBinding(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!=='origin|siteId')throw Error('INVALID_DOMAIN_BINDING');
 const {origin,siteId}=value,url=new URL(origin);
 if(typeof origin!=='string'||url.protocol!=='https:'||url.origin!==origin||url.port||!url.hostname.includes('.')||!/^[a-z0-9.-]+$/.test(url.hostname)||url.hostname.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-'))||url.hostname.length>253||typeof siteId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(siteId))throw Error('INVALID_DOMAIN_BINDING');
 return Object.freeze({origin,siteId});
}
export function domainPageSearch(href,binding){
 try{
  const config=readDomainBinding(binding),url=new URL(href);
  if(url.origin!==config.origin||url.username||url.password||url.port||!['/','/index.html'].includes(url.pathname)||url.search)return '';
  return '?site='+config.siteId;
 }catch{return '';}
}
