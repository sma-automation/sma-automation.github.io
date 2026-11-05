// Server/runner only. The caller must obtain a current, owner-authorized job and
// serialize jobs for the same hostname. Never import this module into the app.
const API='https://api.hosting.ionos.com/dns';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LABEL=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export class SetupError extends Error {
 constructor(code){super(code);this.code=code;}
}
const fail=code=>{throw new SetupError(code);};
function credential(value){
 // Copy/paste may add whitespace around the two complete parts. Never remove
 // characters within either part, guess a missing separator, or log its value.
 if(typeof value!=='string'||!value.trim())fail('IONOS_ACCESS_REQUIRED');
 if(value.length>2048)fail('IONOS_KEY_FORMAT_INVALID');
 const parts=value.trim().split('.');
 if(parts.length===1)fail('IONOS_KEY_SEPARATOR_MISSING');
 if(parts.length!==2)fail('IONOS_KEY_SEPARATOR_INVALID');
 const [prefix,secret]=parts.map(part=>part.trim());
 if(!prefix||!secret)fail('IONOS_KEY_PART_MISSING');
 if(/\s/u.test(prefix+secret))fail('IONOS_KEY_INTERNAL_WHITESPACE');
 if(!/^[A-Za-z0-9_-]+$/.test(prefix)||!/^[A-Za-z0-9_-]+$/.test(secret))fail('IONOS_KEY_CHARACTERS_INVALID');
 if(prefix.length<8||prefix.length>128||secret.length<16||secret.length>512)fail('IONOS_KEY_LENGTH_INVALID');
 return prefix+'.'+secret;
}
function hostname(value){
 if(typeof value!=='string'||value.length>253||value!==value.toLowerCase()||value.endsWith('.'))fail('INVALID_HOSTNAME');
 const labels=value.split('.');
 if(labels.length<2||!labels.every(label=>LABEL.test(label))||!/[a-z]/.test(labels.at(-1))||['localhost','local','internal','invalid','test'].includes(labels.at(-1)))fail('INVALID_HOSTNAME');
 return value;
}
export function validatePlan(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).sort().join(',')!=='hostname,target,zone')fail('INVALID_DNS_PLAN');
 const zone=hostname(input.zone),host=hostname(input.hostname),target=hostname(input.target);
 // Apex domains require another Cloudflare setup. Never change nameservers or
 // the zone apex to make this adapter appear to support them.
 if(host===zone)fail('APEX_REQUIRES_SEPARATE_SETUP');
 if(!host.endsWith('.'+zone))fail('HOST_OUTSIDE_AUTHORIZED_ZONE');
 if(!/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?\.pages\.dev$/.test(target))fail('INVALID_PAGES_TARGET');
 return Object.freeze({zone,hostname:host,target});
}
const canonical=value=>typeof value==='string'?value.toLowerCase().replace(/\.$/,''):null;
function recordsOf(zone,expected){
 if(!zone||!UUID.test(zone.id)||canonical(zone.name)!==expected||zone.type!=='NATIVE'||!Array.isArray(zone.records)||zone.records.length>10000)fail('INVALID_ZONE_RESPONSE');
 const ids=new Set();
 for(const record of zone.records){
  if(!record||!UUID.test(record.id)||ids.has(record.id)||typeof record.name!=='string'||!record.name||typeof record.type!=='string'||typeof record.content!=='string'||typeof record.disabled!=='boolean')fail('INVALID_RECORD_RESPONSE');
  const name=canonical(record.name);
  if(name!==expected&&!name.endsWith('.'+expected))fail('INVALID_RECORD_RESPONSE');
  ids.add(record.id);
 }
 return zone.records;
}
function inspectRecords(zone,plan){
 const records=recordsOf(zone,plan.zone),exact=records.filter(record=>canonical(record.name)===plan.hostname);
 // Even a disabled/foreign record is a conflict; this adapter must never
 // silently deactivate IONOS services or repurpose a customer's existing host.
 if(exact.length){
  const one=exact[0];
  if(exact.length===1&&one.type==='CNAME'&&one.disabled===false&&canonical(one.content)===plan.target)return {state:'present',recordId:one.id};
  fail('DNS_RECORD_CONFLICT');
 }
 // CNAME cannot coexist with a subtree. Also reject a delegated ancestor or
 // wildcard whose meaning would change by creating this record.
 for(const record of records){
  const name=canonical(record.name);
  if(name.endsWith('.'+plan.hostname))fail('DNS_SUBTREE_CONFLICT');
  if(name!==plan.zone&&plan.hostname.endsWith('.'+name)&&['NS','DNAME','CNAME'].includes(record.type))fail('DNS_ANCESTOR_CONFLICT');
  if(name.startsWith('*.')&&plan.hostname.endsWith(name.slice(1)))fail('DNS_WILDCARD_CONFLICT');
 }
 return {state:'absent',recordId:null};
}
async function limitedBody(response){
 if(!response.body)fail('IONOS_RESPONSE_INVALID');
 const reader=response.body.getReader();let size=0;const chunks=[];
 try{
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)fail('IONOS_RESPONSE_TOO_LARGE');chunks.push(value);}
 }finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('IONOS_RESPONSE_INVALID');}
}
export function createIonosDns({apiKey,authorizedZones=[],fetchImpl=fetch}){
 // The allowlist comes from the private provider connection, never a browser.
 apiKey=credential(apiKey);
 const allowed=new Set(authorizedZones.map(hostname));
 if(!allowed.size)fail('IONOS_ZONE_AUTHORIZATION_REQUIRED');
 async function request(path,{body,method='GET'}={}){
  const read=method==='GET'&&(path==='/v1/zones'||/^\/v1\/zones\/[a-f0-9-]{36}$/i.test(path));
  const create=method==='POST'&&/^\/v1\/zones\/[a-f0-9-]{36}\/records$/i.test(path);
  if(!read&&!create)fail('IONOS_OPERATION_NOT_ALLOWED');
  let response;
  try{
   response=await fetchImpl(API+path,{method,headers:{'X-API-Key':apiKey,'Accept':'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
  }catch{fail(create?'DNS_WRITE_UNCONFIRMED':'IONOS_UNAVAILABLE');}
  if(!response.ok){
   await response.body?.cancel().catch(()=>{});
   if(response.status===401)fail('IONOS_KEY_REJECTED');
   if(response.status===403)fail('IONOS_ACCESS_FORBIDDEN');
   if(response.status===429)fail('IONOS_RATE_LIMITED');
   fail(create?'DNS_WRITE_UNCONFIRMED':'IONOS_UNAVAILABLE');
  }
  try{return await limitedBody(response);}catch(error){if(create)fail('DNS_WRITE_UNCONFIRMED');if(error instanceof SetupError)throw error;fail('IONOS_UNAVAILABLE');}
 }
 function approved(input){const plan=validatePlan(input);if(!allowed.has(plan.zone))fail('IONOS_ZONE_NOT_AUTHORIZED');return plan;}
 async function zoneFor(plan){
  const zones=await request('/v1/zones');
  if(!Array.isArray(zones)||zones.length>10000||zones.some(z=>!z||!UUID.test(z.id)||typeof z.name!=='string'))fail('INVALID_ZONES_RESPONSE');
  const found=zones.filter(z=>canonical(z.name)===plan.zone);
  if(found.length!==1||found[0].type!=='NATIVE')fail('IONOS_ZONE_UNAVAILABLE');
  return found[0].id;
 }
 async function inspect(input){
  const plan=approved(input),zoneId=await zoneFor(plan),zone=await request('/v1/zones/'+zoneId);
  if(zone.id!==zoneId)fail('INVALID_ZONE_RESPONSE');
  return {...inspectRecords(zone,plan),zoneId};
 }
 async function ensureCname(input){
  const plan=approved(input),before=await inspect(plan);
  if(before.state==='present')return {...before,changed:false};
  // Read again immediately before the additive POST. There is no provider
  // compare-and-swap contract; concurrent external edits remain an explicit
  // operational limitation. A job lease serializes SMA's own callers.
  const zone=await request('/v1/zones/'+before.zoneId);
  if(zone.id!==before.zoneId)fail('INVALID_ZONE_RESPONSE');
  const latest=inspectRecords(zone,plan);
  if(latest.state==='present')return {...latest,zoneId:before.zoneId,changed:false};
  await request('/v1/zones/'+before.zoneId+'/records',{method:'POST',body:[{name:plan.hostname,type:'CNAME',content:plan.target,ttl:3600,prio:0,disabled:false}]});
  // Do not accept the create response as proof. Read the actual provider state.
  let after;
  try{after=await inspect(plan);}catch{fail('DNS_WRITE_UNCONFIRMED');}
  if(after.state!=='present'||after.zoneId!==before.zoneId)fail('DNS_WRITE_UNCONFIRMED');
  return {...after,changed:true};
 }
 return Object.freeze({inspect,ensureCname});
}
