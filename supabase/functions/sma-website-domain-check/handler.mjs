const ORIGIN='https://sma-automation.com';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const TOKEN=/^sma-verification=[a-f0-9]{64}$/;
const HOST=/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/;
const fail=()=>{throw Error('UNAVAILABLE');};
export async function limitedJson(response,limit=65536){
 if(!response.ok||Number(response.headers.get('content-length'))>limit||!response.body)fail();
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();fail();}chunks.push(value);}}
 finally{reader.releaseLock();}
 const data=new Uint8Array(length);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.byteLength;}
 return JSON.parse(new TextDecoder().decode(data));
}
export function dnsResult(data,name,value){
 const owner=x=>typeof x==='string'?x.toLowerCase().replace(/\.$/,''):'';
 if(!data||data.TC!==false||data.CD===true||!Array.isArray(data.Question)||data.Question.length!==1||data.Question[0].type!==16||owner(data.Question[0].name)!==name)return 'unavailable';
 if(data.Status===3)return 'not_found';
 if(data.Status!==0)return 'unavailable';
 if(data.Answer!==undefined&&!Array.isArray(data.Answer))return 'unavailable';
 for(const record of data.Answer||[]){
  if(record.type!==16||owner(record.name)!==name||typeof record.data!=='string')continue;
  // Our opaque ASCII challenge never needs DNS escapes; reject them entirely.
  if(!/^(?:"[a-z0-9=-]*"\s*)+$/.test(record.data))continue;
  if([...record.data.matchAll(/"([a-z0-9=-]*)"/g)].map(x=>x[1]).join('')===value)return 'found';
 }
 return 'not_found';
}
export async function lookupChallenge(challenge,fetcher=fetch){
 const {hostname,record_name,record_value,attempt_id}=challenge;
 if(typeof hostname!=='string'||hostname.length>235||!HOST.test(hostname)||hostname.split('.').some(x=>x.length>63||!x||x.startsWith('-')||x.endsWith('-'))||record_name!=='_sma-verification.'+hostname||!TOKEN.test(record_value)||!UUID.test(attempt_id))return 'unavailable';
 const url=new URL('https://dns.google/resolve');
 url.searchParams.set('name',record_name);url.searchParams.set('type','TXT');url.searchParams.set('cd','false');url.searchParams.set('edns_client_subnet','0.0.0.0/0');
 try{
  const response=await fetcher(url.href,{headers:{Accept:'application/dns-json'},redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});
  return dnsResult(await limitedJson(response),record_name,record_value);
 }catch{return 'unavailable';}
}
export function createHandler({authenticate,rpc,finish,lookup=lookupChallenge}){
 return async request=>{
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origin===ORIGIN?{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&origin!==ORIGIN)return reply({ok:false,code:'ORIGIN_REJECTED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply({ok:false,code:'METHOD_NOT_ALLOWED'},405);
  const auth=request.headers.get('authorization');
  if(!auth||!/^Bearer [^\s]+$/.test(auth)||auth.length>8192)return reply({ok:false,code:'AUTH_REQUIRED'},401);
  let body;try{body=await limitedJson(new Response(request.body),512);}catch{return reply({ok:false,code:'INVALID_INPUT'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!['get','prepare','verify'].includes(body.action))return reply({ok:false,code:'INVALID_INPUT'},400);
  try{
   const uid=await authenticate(auth);
   if(typeof uid!=='string'||!UUID.test(uid))return reply({ok:false,code:'AUTH_REQUIRED'},401);
   if(body.action!=='verify')return reply(await rpc(auth,body.action));
   const challenge=await rpc(auth,'begin');
   if(challenge?.ok!==true)return reply(challenge);
   const outcome=await lookup(challenge);
   if(!['found','not_found','unavailable'].includes(outcome))fail();
   const result=await finish(uid,challenge.attempt_id,outcome);
   if(result?.ok!==true)return reply(result);
   return reply(await rpc(auth,'get'));
  }catch{return reply({ok:false,code:'UNAVAILABLE'},503);}
 };
}
