import {createConnectHandler,boundedJson} from './handler.mjs';
import {authenticate,serviceRpc,userRpc} from './runtime.ts';
import {createWordpressTransport,readWordpressDns} from '../_shared/wordpress-transport.mjs';
const probe=createWordpressTransport({
 resolve:async(host:string)=>{
  const url=new URL('https://dns.google/resolve');url.search=new URLSearchParams({name:host,type:'A',cd:'false',edns_client_subnet:'0.0.0.0/0'}).toString();
  const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/dns-json'}});
  if(!r.ok)throw Error('PROVIDER_UNAVAILABLE');return readWordpressDns(await boundedJson(r,16384),host);
 },
 connect:(ip:string)=>Deno.connect({hostname:ip,port:443}),
 startTls:(conn:Deno.TcpConn,host:string)=>Deno.startTls(conn,{hostname:host,alpnProtocols:['http/1.1']})
});
Deno.serve(createConnectHandler({authenticate,serviceRpc,userRpc,probe}));
