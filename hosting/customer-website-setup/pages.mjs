import {SetupError,createIonosDns} from './ionos.mjs';
const api='https://api.cloudflare.com/client/v4';
const fail=code=>{throw new SetupError(code);};
export const bindingText=(hostname,siteId)=>'export const binding=Object.freeze('+JSON.stringify({origin:'https://'+hostname,siteId})+');\n';
export function normalizeCloudflareToken(raw){
 if(typeof raw!=='string'||raw.length>4096)fail('CLOUDFLARE_ACCESS_REQUIRED');
 const matches=[...raw.matchAll(/Authorization[ \t]*:[ \t]*Bearer[ \t]+([A-Za-z0-9._~+/\-]+=*)(?=[\s"'`\\]|$)/gi)].map(m=>m[1]);
 const token=matches.length&&new Set(matches).size===1?matches[0]:raw.trim().replace(/^Bearer[ \t]+/i,'');
 if(token.length<16||token.length>1024||!/^[-A-Za-z0-9._~+/]+=*$/.test(token))fail('CLOUDFLARE_ACCESS_REQUIRED');return token;
}
export async function boundedText(r,limit=1048576){
 const reader=r.body?.getReader();if(!reader)fail('PROVIDER_RESPONSE_INVALID');const chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit)fail('PROVIDER_RESPONSE_INVALID');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(total);let offset=0;for(const v of chunks){bytes.set(v,offset);offset+=v.length;}return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
export function createPages({accountId,token,fetchImpl=fetch}){
 if(!/^[a-f0-9]{32}$/.test(accountId))fail('CLOUDFLARE_ACCESS_REQUIRED');token=normalizeCloudflareToken(token);
 const base='/accounts/'+accountId+'/pages/projects';
 async function call(path,{method='GET',body,uploadToken,missing=false}={}){
  // All call sites construct relative paths from validated immutable job fields.
  if(!path.startsWith(base)&&!['/pages/assets/check-missing','/pages/assets/upload','/pages/assets/upsert-hashes'].includes(path))fail('PROVIDER_OPERATION_REJECTED');
  let r;try{r=await fetchImpl(api+path,{method,headers:{Authorization:'Bearer '+(uploadToken||token),Accept:'application/json',...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{fail('CLOUDFLARE_UNAVAILABLE');}
  if(missing&&r.status===404){await r.body?.cancel();return null;}
  if(r.status===401||r.status===403){await r.body?.cancel();fail('CLOUDFLARE_ACCESS_REQUIRED');}
  if(!r.ok){await r.body?.cancel();fail(r.status===429?'PROVIDER_RATE_LIMITED':'CLOUDFLARE_UNAVAILABLE');}
  let data;try{data=JSON.parse(await boundedText(r));}catch{fail('PROVIDER_RESPONSE_INVALID');}
  if(data.success!==true)fail('CLOUDFLARE_UNAVAILABLE');return data.result;
 }
 function path(job){if(!/^sma-site-[a-f0-9]{32}$/.test(job.project_name))fail('INVALID_JOB');return base+'/'+job.project_name;}
 async function owned(job,{create=false}={}){
  const p=path(job);let project=await call(p,{missing:true});
  if(!project&&create){
   const config={env_vars:{SMA_SETUP_OWNER:{type:'plain_text',value:job.marker}}};
   project=await call(base,{method:'POST',body:{name:job.project_name,production_branch:'main',deployment_configs:{production:config,preview:config}}});
  }
  if(!project||project.name!==job.project_name||project.deployment_configs?.production?.env_vars?.SMA_SETUP_OWNER?.value!==job.marker||project.production_branch!=='main')fail('RESOURCE_CONFLICT');
  if(job.provider_state?.project_id&&project.id!==job.provider_state.project_id)fail('RESOURCE_CONFLICT');
  return project;
 }
 return {call,path,owned};
}
export async function performSetupStep({job,providers,template,hashContent,fetchImpl=fetch}){
 if(!job||!Number.isSafeInteger(job.customer_id)||job.customer_id<1||!/^[a-f0-9-]{36}$/.test(job.site_id)||!/^[a-f0-9-]{36}$/.test(job.id)||!/^[a-f0-9-]{36}$/.test(job.marker)
  ||job.project_name!=='sma-site-'+job.id.replace(/-/g,'')||job.hostname!=='seite-'+job.customer_id+'-'+job.site_id.slice(0,8)+'.sma-automation.com'||providers.zone!=='sma-automation.com')fail('INVALID_JOB');
 const cf=createPages({accountId:providers.account_id,token:providers.cloudflare_token,fetchImpl}),target=job.project_name+'.pages.dev';
 const project=await cf.owned(job,{create:job.phase==='project'}),p=cf.path(job);
 if(job.phase==='project')return {project_id:project.id};
 if(job.phase==='deploy'){
  const entries={...template.files,'binding.mjs':bindingText(job.hostname,job.site_id)};
  const label='sma-setup:'+job.id+':'+template.version;
  const deployments=await cf.call(p+'/deployments?per_page=20');if(!Array.isArray(deployments))fail('PROVIDER_RESPONSE_INVALID');
  let deployment=deployments.find(d=>d.deployment_trigger?.metadata?.commit_message===label&&d.environment==='production');
  if(!deployment){
   const upload=await cf.call(p+'/upload-token');if(typeof upload?.jwt!=='string')fail('PROVIDER_RESPONSE_INVALID');
   const files=Object.entries(entries).filter(([name])=>name!=='_headers').map(([name,value])=>({name,value}));
   const payload=await Promise.all(files.map(async({name,value})=>({key:await hashContent(value,name),value:btoa(String.fromCharCode(...new TextEncoder().encode(value))),metadata:{contentType:name.endsWith('.mjs')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'text/plain'},base64:true})));
   const missing=await cf.call('/pages/assets/check-missing',{method:'POST',body:{hashes:payload.map(f=>f.key)},uploadToken:upload.jwt});
   if(!Array.isArray(missing)||missing.some(h=>!payload.some(f=>f.key===h)))fail('PROVIDER_RESPONSE_INVALID');
   if(missing.length)await cf.call('/pages/assets/upload',{method:'POST',body:payload.filter(f=>missing.includes(f.key)),uploadToken:upload.jwt});
   await cf.call('/pages/assets/upsert-hashes',{method:'POST',body:{hashes:payload.map(f=>f.key)},uploadToken:upload.jwt});
   const form=new FormData();form.set('manifest',JSON.stringify(Object.fromEntries(files.map((f,i)=>['/'+f.name,payload[i].key]))));
   form.set('branch','main');form.set('commit_message',label);form.set('commit_dirty','false');form.set('_headers',new Blob([entries._headers],{type:'text/plain'}),'_headers');
   deployment=await cf.call(p+'/deployments',{method:'POST',body:form});
  }
  if(deployment.latest_stage?.status==='failure')fail('DEPLOYMENT_FAILED');
  if(deployment.latest_stage?.name!=='deploy'||deployment.latest_stage?.status!=='success')fail('DEPLOYMENT_PENDING');
  return {deployment_id:deployment.id};
 }
 // A subsequent stage must never certify another/newer deployment as ours.
 if(project.canonical_deployment?.id!==job.provider_state?.deployment_id)fail('DEPLOYMENT_CHANGED');
 if(job.phase==='domain'){
  const domains=await cf.call(p+'/domains');if(!Array.isArray(domains))fail('PROVIDER_RESPONSE_INVALID');
  if(!domains.some(d=>d.name===job.hostname))await cf.call(p+'/domains',{method:'POST',body:{name:job.hostname}});
  return {};
 }
 const dns=createIonosDns({apiKey:providers.ionos_key,publicPrefix:providers.prefix,authorizedZones:[providers.zone],fetchImpl});
 const plan={zone:providers.zone,hostname:job.hostname,target};
 if(job.phase==='dns'){const record=await dns.ensureCname(plan);return {dns_record_id:record.recordId,dns_zone_id:record.zoneId};}
 if(job.phase!=='verify')fail('INVALID_JOB');
 const record=await dns.inspect(plan);if(record.state!=='present'||record.recordId!==job.provider_state?.dns_record_id)fail('DNS_RECORD_CONFLICT');
 const domain=await cf.call(p+'/domains/'+job.hostname);if(domain.name!==job.hostname||domain.status!=='active')fail('HTTPS_PENDING');
 let lookup;try{
  const r=await fetchImpl('https://cloudflare-dns.com/dns-query?name='+job.hostname+'&type=CNAME',{headers:{Accept:'application/dns-json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)fail('DNS_PENDING');lookup=JSON.parse(await boundedText(r,16000));
 }catch{fail('DNS_PENDING');}
 if(lookup.Status!==0||!lookup.Answer?.some(a=>a.type===5&&a.name.replace(/\.$/,'')===job.hostname&&a.data.replace(/\.$/,'')===target))fail('DNS_PENDING');
 try{
  const r=await fetchImpl('https://'+job.hostname+'/binding.mjs',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok||await boundedText(r,4096)!==bindingText(job.hostname,job.site_id))fail('HTTPS_PENDING');
 }catch{fail('HTTPS_PENDING');}
 return {};
}
