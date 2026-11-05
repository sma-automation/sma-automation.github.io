import {verifyBootstrapIdentity} from '../../../hosting/customer-website-setup/oidc.mjs';
import {performSetupStep,normalizeCloudflareToken,createPages,boundedText} from '../../../hosting/customer-website-setup/pages.mjs';
import {hashContent} from '../../../hosting/customer-website-setup/hash.mjs';
import {createIonosDns,resolveIonosApiKey,SetupError} from '../../../hosting/customer-website-setup/ionos.mjs';
import template from './template.json' with {type:'json'};
const base=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function rpc(action:string,input:unknown){
 const r=await fetch(base+'/rest/v1/rpc/sma_website_setup_worker_v1',{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_action:action,p_input:input}),redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('DATABASE_UNAVAILABLE');return JSON.parse(await boundedText(r,20000));
}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const waits=new Set(['CLOUDFLARE_UNAVAILABLE','PROVIDER_RATE_LIMITED','IONOS_UNAVAILABLE','IONOS_RATE_LIMITED','DNS_WRITE_UNCONFIRMED','DEPLOYMENT_PENDING','DNS_PENDING','HTTPS_PENDING']);
async function runClaim(claim:any,token:string){
 const {job,providers}=claim;
 try{
  const state=await performSetupStep({job,providers,template,hashContent});
  await rpc('finish',{token,id:job.id,lease:job.lease,outcome:'success',state});
 }catch(error){
  const code=error instanceof SetupError?error.code:'SETUP_UNAVAILABLE';
  await rpc('finish',{token,id:job.id,lease:job.lease,outcome:waits.has(code)?'wait':'error',code});
 }
}
Deno.serve(async request=>{
 if(request.method!=='POST')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
 const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
 if(!token||token.length>16000)return json({ok:false,code:'AUTH_REQUIRED'},401);
 let stage='request';
 try{
  const raw=await boundedText(request as unknown as Response,10000),input=JSON.parse(raw);
  if(input?.action==='bootstrap'){
   stage='identity';const identity=await verifyBootstrapIdentity(token);
   stage='credential_format';const cfToken=normalizeCloudflareToken(input.cloudflare_token);
   const apiKey=resolveIonosApiKey(input.ionos_key,input.prefix);
   // Validate the same real provider access that already passed in GitHub.
   stage='cloudflare';const cf=createPages({accountId:input.account_id,token:cfToken});
   const domain=await cf.call('/accounts/'+input.account_id+'/pages/projects/sma-customer-website-test/domains/test.sma-automation.com');
   if(domain?.status!=='active')return json({ok:false,code:'PROVIDER_ACCESS_UNCONFIRMED'},409);
   stage='ionos';await createIonosDns({apiKey,authorizedZones:['sma-automation.com']}).inspect({zone:'sma-automation.com',hostname:'test.sma-automation.com',target:'sma-customer-website-test.pages.dev'});
   stage='install';const result=await rpc('install',{sha:identity.sha,account_id:input.account_id,prefix:input.prefix,ionos_key:apiKey,cloudflare_token:cfToken});
   return json(result,result.ok?200:403);
  }
  if(JSON.stringify(input)!=='{}')return json({ok:false,code:'INVALID_INPUT'},400);
  const claim=await rpc('claim',{token});
  if(!claim.ok)return json({ok:false,code:'AUTH_REQUIRED'},401);
  if(!claim.job)return json({ok:true,code:'IDLE'});
  // The caller may disconnect. The durable lease and cron retry survive this process.
  EdgeRuntime.waitUntil(runClaim(claim,token).catch(()=>{/* lease expires; cron reclaims */}));
  return json({ok:true,code:'ACCEPTED'},202);
 }catch{return json({ok:false,code:'REQUEST_REJECTED',stage},403);}
});
