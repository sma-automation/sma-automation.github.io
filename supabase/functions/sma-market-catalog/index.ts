import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {verifyConnection,mirrorShop,mirrorDigi,fail} from './providers.mjs';
const origin='https://sma-automation.com';
const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers});
const url=Deno.env.get('SUPABASE_URL')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const codes=new Set(['TEMPORARY','BUSY','RECONNECT','CONFLICT','CHECK_RESULT','PRODUCT_INPUT','CATEGORY','UNSUPPORTED','REJECTED']);
const safe=(e:unknown)=>{const c=(e as {code?:string})?.code;return c&&codes.has(c)?c:'TEMPORARY';};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{ok:false});
 if(req.headers.get('origin')&&req.headers.get('origin')!==origin)return reply(403,{ok:false});
 let body;try{const source=await req.text();if(source.length>10000)return reply(413,{ok:false});body=JSON.parse(source);}catch{return reply(400,{ok:false});}
 if(typeof body?.ticket==='string'&&/^[0-9a-f-]{36}$/i.test(body.ticket)){
  const command=async(op:string,arg={})=>{
   const {data,error}=await admin.rpc('sma_catalog_job_worker_v1',{t:body.ticket,op,arg});
   if(error||data?.ok!==true)fail('BUSY');return data;
  };
  let job;try{job=await command('claim');}catch{return reply(403,{ok:false});}
  try{
   if(!/^[A-Za-z0-9_.-]{1,80}$/.test(job.sku)||!job.title||job.currency!=='EUR'||!(Number(job.price)>0)||!job.source_id)fail('PRODUCT_INPUT');
   const operation=(op:string,arg={})=>command(op,{...arg,revision:job.revision});
   if(job.market==='shopify')await mirrorShop(job,operation);else if(job.market==='digistore24')await mirrorDigi(job,operation);else fail('UNSUPPORTED');
   await operation('finish');return reply(200,{ok:true});
  }catch(e){try{await command('error',{code:safe(e)});}catch{/* The lease expires if persistence is interrupted. */}return reply(200,{ok:false,code:safe(e)});}
 }
 const bearer=req.headers.get('authorization')||'';
 if(!bearer.startsWith('Bearer '))return reply(401,{ok:false});
 const client=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:bearer}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await client.auth.getUser(bearer.slice(7));
 if(authError||!auth.user)return reply(401,{ok:false});
 const {data:config}=await client.rpc('sma_market_catalog_v1',{action:'get',fields:{ids:[]}});
 if(!config?.enabled)return reply(403,{ok:false});
 try{
  const {market,credentials,identity,categories,action}=body;
  if(!['connect','categories'].includes(action)||!['shopify','digistore24'].includes(market)||typeof identity!=='string'||!credentials||typeof credentials!=='object')fail('PRODUCT_INPUT');
  if(market==='shopify'&&identity!==config.shop)fail('CONFLICT');
  const secret=market==='shopify'?{client_id:credentials.client_id,client_secret:credentials.client_secret}:{key:credentials.key};
  if(Object.values(secret).some(v=>typeof v!=='string'||!v||v.length>4096))fail('PRODUCT_INPUT');
  const verified=await verifyConnection(market,identity,secret,action==='categories'?null:categories);
  if(action==='categories')return reply(200,{ok:true,types:verified.types||[]});
  const {data,error}=await admin.rpc('sma_catalog_connect_worker_v1',{owner_in:auth.user.id,market_in:market,identity_in:verified.identity,credential_in:JSON.stringify(market==='digistore24'?{...secret,categories}:secret),category_in:market==='digistore24'?Object.values(categories)[0]:null});
  if(error||data!==true)fail('CONFLICT');
  return reply(200,{ok:true,identity:verified.identity});
 }catch(e){return reply(422,{ok:false,code:safe(e)});}
});
