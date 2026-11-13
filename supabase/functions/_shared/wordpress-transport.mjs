// Small, bounded HTTP/1.1 JSON transport over an explicitly pinned IPv4 socket.
// TLS validates the original hostname; DNS is never resolved again for connect.
const error=code=>{throw Object.assign(new Error(code),{code});};
const encoder=new TextEncoder();
export function wordpressTarget(value){
 if(typeof value!=='string'||value.length>2048||!/^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9/_.~-]*$/.test(value))error('TARGET_REJECTED');
 const u=new URL(value),labels=u.hostname.split('.');
 if(u.href!==value||u.port||u.username||u.password||u.search||u.hash||labels.length<2||labels.some(s=>!s||s.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s))
  ||!/^[a-z]{2,63}$/.test(labels.at(-1))||['localhost','local','internal','invalid','test','example'].includes(labels.at(-1))||!u.pathname.endsWith('/'))error('TARGET_REJECTED');
 return {hostname:u.hostname,path:u.pathname+'?rest_route=%2Fsma-bridge%2Fv1%2Fcommand',restPath:u.pathname+'wp-json/sma-bridge/v1/command'};
}
export function publicIPv4(value){
 if(typeof value!=='string'||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value))return false;
 const a=value.split('.').map(Number);
 if(a.some((v,i)=>v>255||String(v)!==value.split('.')[i]))return false;
 return !(value==='168.63.129.16'||a[0]===0||a[0]===10||a[0]===127||a[0]>=224
  ||a[0]===100&&a[1]>=64&&a[1]<=127||a[0]===169&&a[1]===254||a[0]===172&&a[1]>=16&&a[1]<=31
  ||a[0]===192&&(a[1]===168||a[1]===0&&[0,2].includes(a[2])||a[1]===88&&a[2]===99)
  ||a[0]===198&&(a[1]===18||a[1]===19||a[1]===51&&a[2]===100)||a[0]===203&&a[1]===0&&a[2]===113);
}
export function readWordpressDns(data,hostname){
 const name=s=>typeof s==='string'?s.toLowerCase().replace(/\.$/,''):'';
 if(data?.Status!==0||data.TC!==false||data.CD===true||data.Question?.length!==1||data.Question[0].type!==1||name(data.Question[0].name)!==hostname||!Array.isArray(data.Answer)||data.Answer.length>32)error('PROVIDER_UNAVAILABLE');
 const owners=new Set([hostname]);
 for(let i=0;i<8;i++)for(const r of data.Answer)if(r.type===5&&owners.has(name(r.name)))owners.add(name(r.data));
 const ips=data.Answer.filter(r=>r.type===1&&owners.has(name(r.name))).map(r=>r.data);
 if(ips.length<1||ips.length>16||!ips.every(publicIPv4))error('TARGET_REJECTED');return ips;
}
export function parseWordpressHttp(bytes,{allowBridgeErrors=false,discovery=false}={}){
 const invalid=reason=>{throw Object.assign(new Error('PROVIDER_UNAVAILABLE'),{code:'PROVIDER_UNAVAILABLE',responseReason:reason});};
 if(!(bytes instanceof Uint8Array)||bytes.length>32768)invalid('size');
 const latin=new TextDecoder('latin1').decode(bytes),cut=latin.indexOf('\r\n\r\n');
 if(cut<0||cut>8192)invalid('headers');
 const lines=latin.slice(0,cut).split('\r\n');
 // Some hosts use plain permalinks or do not support OPTIONS on rewritten paths.
 if(discovery && /^HTTP\/1\.[01] (404|405|501)(?: [\x20-\x7e]*)?$/.test(lines[0]))return null;
 const status=/^HTTP\/1\.[01] (200|403|409)(?: [\x20-\x7e]*)?$/.exec(lines.shift());
 if(!status||status[1]!=='200'&&!allowBridgeErrors)invalid('status');
 const h={};
 for(const line of lines){
  const m=/^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*([\x20-\x7e\t]*)$/.exec(line);if(!m)invalid('header_line');
  const key=m[1].toLowerCase();
  if(Object.hasOwn(h,key)&&['content-length','transfer-encoding','content-type','content-encoding'].includes(key))invalid('duplicate_header');
  h[key]=m[2].trim();
 }
 if(h['content-encoding']&&h['content-encoding']!=='identity')invalid('content_encoding');
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h['content-type']||'')){
  if(/^text\/html(?:;|$)/i.test(h['content-type']||'')){
   if(discovery)return null;
   invalid('html_response');
  }
  invalid('media_type');
 }
 let body=bytes.subarray(cut+4);
 if(h['transfer-encoding']){
  if(h['transfer-encoding'].toLowerCase()!=='chunked'||h['content-length'])invalid('transfer_encoding');
  const parts=[];let offset=0,total=0;
  for(;;){
   const rest=new TextDecoder('latin1').decode(body.subarray(offset)),end=rest.indexOf('\r\n');
   if(end<1||end>8||!/^[0-9a-f]+$/i.test(rest.slice(0,end)))invalid('chunk_size');
   const n=parseInt(rest.slice(0,end),16);offset+=end+2;
   if(n===0){if(offset+2!==body.length||body[offset]!==13||body[offset+1]!==10)invalid('chunk_end');break;}
   if(total+n>16384||offset+n+2>body.length||body[offset+n]!==13||body[offset+n+1]!==10)invalid('chunk_data');
   parts.push(body.subarray(offset,offset+n));total+=n;offset+=n+2;
  }
  body=new Uint8Array(total);let at=0;for(const p of parts){body.set(p,at);at+=p.length;}
 }else if(h['content-length']!==undefined&&(!/^\d{1,5}$/.test(h['content-length'])||Number(h['content-length'])!==body.length))invalid('content_length');
 if(body.length>16384)invalid('body_size');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{invalid('json');}
 if(status[1]==='200')return value;
 if(status[1]==='409'&&value?.ok===false&&Object.keys(value).sort().join('|')==='code|ok'
  &&['PAGE_CHANGED','REVISION_CONFLICT','REQUEST_CONFLICT','WEBSITE_CHANGED','ACCESS_REVOKED','NOT_CONNECTED','TRANSACTION_REQUIRED','CONTENT_FILTERED'].includes(value.code))return {ok:false,code:value.code};
 if(status[1]==='403'&&value?.code==='sma_not_authorized'&&value?.data?.status===403)return {ok:false,code:'NOT_CONNECTED'};
 invalid('bridge_error');
}
export function createWordpressTransport({resolve,connect,startTls,timeoutMs=12000,allowBridgeErrors=false,onFailure}){
 return async(website,signed)=>{
  const {hostname,path,restPath}=wordpressTarget(website);
  if(typeof signed?.body!=='string'||encoder.encode(signed.body).length>2048||!/^[A-Za-z0-9+/]{300,700}={0,2}$/.test(signed.headers?.['X-SMA-Signature']||''))error('INVALID_REQUEST');
  let conn,closed=false,timer;
  let stage='dns',status;
  const timeout=()=>Object.assign(new Error('PROVIDER_UNAVAILABLE'),{name:'TimeoutError'});
  const close=()=>{try{conn?.close();}catch{}};
  const work=(async()=>{
   const addresses=await resolve(hostname);
   if(closed)error('PROVIDER_UNAVAILABLE');
   if(!Array.isArray(addresses)||addresses.length<1||addresses.length>16||!addresses.every(publicIPv4))error('TARGET_REJECTED');
   async function exchange(method,targetPath){
    stage='connect';
    conn=await connect(addresses[0]);if(closed){close();error('PROVIDER_UNAVAILABLE');}
    stage='tls';
    conn=await startTls(conn,hostname);if(closed){close();error('PROVIDER_UNAVAILABLE');}
    stage='handshake';
    const tls=await conn.handshake();if(closed||tls?.alpnProtocol&&!['http/1.1'].includes(tls.alpnProtocol))error('PROVIDER_UNAVAILABLE');
    const start=method+' '+targetPath+' HTTP/1.1\r\nHost: '+hostname+'\r\nConnection: close\r\nAccept: application/json\r\nAccept-Encoding: identity\r\n';
    const request=encoder.encode(method==='OPTIONS'?start+'\r\n':start+'Content-Type: application/json\r\nX-SMA-Signature: '+signed.headers['X-SMA-Signature']+'\r\nContent-Length: '+encoder.encode(signed.body).length+'\r\n\r\n'+signed.body);
    stage='write';
    for(let at=0;at<request.length;){const n=await conn.write(request.subarray(at));if(!Number.isInteger(n)||n<=0)error('PROVIDER_UNAVAILABLE');at+=n;}
    stage='read';
    const parts=[];let total=0;
    for(;;){const buffer=new Uint8Array(4096),n=await conn.read(buffer);if(n===null)break;if(!Number.isInteger(n)||n<=0)error('PROVIDER_UNAVAILABLE');total+=n;if(total>32768)error('PROVIDER_UNAVAILABLE');parts.push(buffer.slice(0,n));}
    const bytes=new Uint8Array(total);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
    stage='response';
    const line=new TextDecoder().decode(bytes.subarray(0,24));
    status=/^HTTP\/1\.[01] (\d{3})[ \r]/.exec(line)?.[1];
    return parseWordpressHttp(bytes,{allowBridgeErrors:method==='POST'&&allowBridgeErrors,discovery:method==='OPTIONS'});
   }
   // Check the registered endpoint before sending any command. Never replay a POST on another path.
   const route=await exchange('OPTIONS',restPath);
   close();conn=undefined;status=undefined;
   const canonical='https://'+hostname+restPath;
   const advertised=route?.namespace==='sma-bridge/v1' && Array.isArray(route.methods) && route.methods.includes('POST')
    && Array.isArray(route._links?.self) && route._links.self.some(link=>link?.href===canonical);
   return exchange('POST',advertised?restPath:path);
  })();
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeout()),timeoutMs);})]);}
  catch(e){
   // Log only a closed set of transport facts, never exception text, host, headers or payload.
   const kinds=['TypeError','NotSupported','PermissionDenied','InvalidData','ConnectionRefused','ConnectionReset','UnexpectedEof','TimedOut','TimeoutError','NotFound','NetworkUnreachable','NotCapable'];
   const kind=kinds.includes(e?.name)?e.name:'other';
   const reason=stage==='response'?e?.responseReason:undefined;
   if(onFailure)onFailure({stage,kind,...(status?{status}:{}),...(reason?{reason}:{})});
   if(reason==='html_response')error('WORDPRESS_HTML_RESPONSE');
   error(e?.code==='TARGET_REJECTED'?'TARGET_REJECTED':'PROVIDER_UNAVAILABLE');
  }
  finally{closed=true;clearTimeout(timer);close();}
 };
}
