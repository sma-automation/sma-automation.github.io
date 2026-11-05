// One disposable DNS record in the explicitly authorized SMA test zone.
// Not a customer provisioning worker and not imported by the dashboard.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createIonosDns,resolveIonosApiKey,SetupError} from './ionos.mjs';
const fail=code=>{throw new SetupError(code);};
export async function writeProbe({env=process.env,fetchImpl=fetch}={}){
 const report={status:'NOT_STARTED',created:false,repeatedWithoutDuplicate:false,removed:false};
 let dns,apiKey,plan,owned,attempted=false;
 try{
  if(!/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID||'')||!/^[1-9][0-9]{0,5}$/.test(env.GITHUB_RUN_ATTEMPT||''))fail('PROBE_RUN_REQUIRED');
  plan={zone:'sma-automation.com',hostname:`setup-check-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}.sma-automation.com`,target:'sma-customer-website-test.pages.dev'};
  report.temporaryHost=plan.hostname;
  apiKey=resolveIonosApiKey(env.IONOS_DNS_API_KEY,env.IONOS_DNS_API_PREFIX);
  dns=createIonosDns({apiKey,authorizedZones:[plan.zone],fetchImpl});
  if((await dns.inspect(plan)).state!=='absent')fail('PROBE_HOST_ALREADY_PRESENT');
  attempted=true;
  const created=await dns.ensureCname(plan);
  if(!created.changed)fail('PROBE_RECORD_NOT_CREATED');
  owned=created;report.created=true;
  const repeated=await dns.ensureCname(plan);
  if(repeated.changed||repeated.zoneId!==owned.zoneId||repeated.recordId!==owned.recordId)fail('PROBE_REPEAT_FAILED');
  report.repeatedWithoutDuplicate=true;
  report.status='DNS_WRITE_CHECK_PASSED';
 }catch(error){
  report.status=error instanceof SetupError?error.code:'DNS_WRITE_CHECK_FAILED';
 }finally{
  if(owned){
   try{
    // Only remove the exact ID created by this run, still matching our target.
    // Changed, duplicated, or disabled records are deliberately left untouched.
    const current=await dns.inspect(plan);
    if(current.state!=='present'||current.zoneId!==owned.zoneId||current.recordId!==owned.recordId)fail('PROBE_CLEANUP_CONFLICT');
    const response=await fetchImpl('https://api.hosting.ionos.com/dns/v1/zones/'+encodeURIComponent(owned.zoneId)+'/records/'+encodeURIComponent(owned.recordId),{
     method:'DELETE',headers:{'X-API-Key':apiKey,Accept:'application/json'},redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
    await response.body?.cancel().catch(()=>{});
    if(!response.ok&&response.status!==404)fail('PROBE_CLEANUP_UNCONFIRMED');
    if((await dns.inspect(plan)).state!=='absent')fail('PROBE_CLEANUP_UNCONFIRMED');
    report.removed=true;
   }catch(error){
    report.cleanup=error instanceof SetupError?error.code:'PROBE_CLEANUP_UNCONFIRMED';
    report.status='PROBE_CLEANUP_REQUIRED';
   }
  }else if(attempted&&report.status==='DNS_WRITE_UNCONFIRMED'){
   // A lost create response does not prove ownership of an ID. Never guess one.
   report.cleanup='REVIEW_REQUIRED';
  }
 }
 return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const report=await writeProbe();console.log(JSON.stringify(report));
 if(report.status!=='DNS_WRITE_CHECK_PASSED'||!report.removed)process.exitCode=1;
}
