// Read-only probe for the already agreed test binding. Never exposes keys,
// provider response bodies, other zones, or account IDs in logs.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createIonosDns,SetupError} from './ionos.mjs';
export const testPlan=Object.freeze({zone:'sma-automation.com',hostname:'test.sma-automation.com',target:'sma-customer-website-test.pages.dev'});
export async function preflight({env=process.env,fetchImpl=fetch}={}){
 const report={cloudflare:'NOT_CHECKED',ionos:'NOT_CHECKED',dnsModified:false};
 const raw=env.CLOUDFLARE_API_TOKEN_READONLY||'',account=(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
 // Existing account keys may have been pasted inside a Bearer test command.
 // Support exactly one unambiguous Authorization header; never execute it.
 const matches=[...raw.matchAll(/Authorization[ \t]*:[ \t]*Bearer[ \t]+([A-Za-z0-9._~+/\-]+=*)(?=[\s"'`\\]|$)/gi)].map(m=>m[1]);
 const token=matches.length&&new Set(matches).size===1?matches[0]:raw.trim().replace(/^Bearer[ \t]+/i,'');
 if(!/^[a-f0-9]{32}$/i.test(account)||!token||!/[A-Za-z0-9]/.test(token)||!/^[-A-Za-z0-9._~+/]+=*$/.test(token))report.cloudflare='CLOUDFLARE_ACCESS_REQUIRED';
 else{
  try{
   const response=await fetchImpl('https://api.cloudflare.com/client/v4/accounts/'+account+'/pages/projects/sma-customer-website-test/domains/test.sma-automation.com',{
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
   if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error();}
   const reader=response.body.getReader();let raw='',size=0;const decoder=new TextDecoder();
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw Error();raw+=decoder.decode(value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}
   const body=JSON.parse(raw+decoder.decode());
   report.cloudflare=body.success===true&&body.result?.name===testPlan.hostname&&body.result?.status==='active'?'TEST_DOMAIN_ACTIVE':'TEST_DOMAIN_NOT_CONFIRMED';
  }catch{report.cloudflare='CLOUDFLARE_CHECK_FAILED';}
 }
 try{
  const dns=createIonosDns({apiKey:env.IONOS_DNS_API_KEY,publicPrefix:env.IONOS_DNS_API_PREFIX,authorizedZones:[testPlan.zone],fetchImpl});
  const result=await dns.inspect(testPlan);
  report.ionos=result.state==='present'?'TEST_CNAME_CONFIRMED':'TEST_CNAME_MISSING';
 }catch(error){report.ionos=error instanceof SetupError?error.code:'IONOS_CHECK_FAILED';}
 report.ready=report.cloudflare==='TEST_DOMAIN_ACTIVE'&&report.ionos==='TEST_CNAME_CONFIRMED';
 return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const report=await preflight();console.log(JSON.stringify(report));
 if(!report.ready)process.exitCode=1;
}
