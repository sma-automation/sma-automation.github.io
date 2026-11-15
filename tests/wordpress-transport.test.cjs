const test=require('node:test'),assert=require('node:assert/strict');
const ready=import('../supabase/functions/_shared/wordpress-transport.mjs');
const bytes=s=>new TextEncoder().encode(s);
test('DNS-over-HTTPS answers must belong to the exact question and its bounded CNAME chain',async()=>{
 const {readWordpressDns}=await ready;
 const d={Status:0,TC:false,CD:false,Question:[{name:'example.com.',type:1}],Answer:[{name:'example.com.',type:5,data:'edge.example.net.'},{name:'edge.example.net.',type:1,data:'93.184.216.34'},{name:'unrelated.example.net.',type:1,data:'8.8.8.8'}]};
 assert.deepEqual(readWordpressDns(d,'example.com'),['93.184.216.34']);
 for(const patch of [{Status:3},{TC:true},{Question:[{name:'other.example',type:1}]},{Answer:[{name:'example.com.',type:1,data:'127.0.0.1'}]}])assert.throws(()=>readWordpressDns({...d,...patch},'example.com'));
});
test('WordPress targets reject local, credentialed, ambiguous and non-root installation URLs',async()=>{
 const {wordpressTarget,publicIPv4}=await ready;
 assert.equal(wordpressTarget('https://example.com/blog/').path,'/blog/?rest_route=%2Fsma-bridge%2Fv1%2Fcommand');
 for(const s of ['http://example.com/','https://127.0.0.1/','https://user@example.com/','https://example.com:443/','https://example.com/a/../','https://example.com/%0a/','https://host.local/','https://example.com/blog'])assert.throws(()=>wordpressTarget(s));
 for(const s of ['127.1.1.1','10.0.0.1','169.254.169.254','100.100.100.200','172.20.0.1','192.168.1.2','192.0.0.8','198.18.0.1','203.0.113.1','224.1.1.1','::1','8.8.8.08','8.8.8.999'])assert.equal(publicIPv4(s),false,s);
 assert.equal(publicIPv4('93.184.216.34'),true);
});
test('HTTP parser accepts bounded JSON and chunks while rejecting redirects and ambiguous framing',async()=>{
 const {parseWordpressHttp}=await ready,head='HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n';
 assert.deepEqual(parseWordpressHttp(bytes(head+'Content-Length: 2\r\n\r\n{}')),{});
 assert.deepEqual(parseWordpressHttp(bytes(head+'Transfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n')),{});
 for(const s of ['HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/\r\n\r\n',head+'Content-Length: 3\r\n\r\n{}',head+'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}',head+'Transfer-Encoding: chunked\r\nContent-Length: 2\r\n\r\n{}',head+'Content-Encoding: gzip\r\n\r\n{}',head+'Transfer-Encoding: chunked\r\n\r\nffff\r\n{}',head+' folded: value\r\n\r\n{}'])assert.throws(()=>parseWordpressHttp(bytes(s)));
 assert.throws(()=>parseWordpressHttp(new Uint8Array(32769)));
});
function routeTransport(dependencies, responses) {
 const requests=[],closed=[];
 const call=dependencies.createWordpressTransport({
  resolve:async host=>{assert.equal(host,'example.com');return ['93.184.216.34'];},
  connect:async ip=>{
   assert.equal(ip,'93.184.216.34');
   const index=requests.length;requests.push('');let read=false;
   return {handshake:async()=>({alpnProtocol:'http/1.1'}),
    write:async data=>{requests[index]+=new TextDecoder().decode(data);return data.length;},
    read:async buffer=>{if(read)return null;read=true;const data=bytes(responses[index]);buffer.set(data);return data.length;},
    close:()=>closed.push(index)};
  },
  startTls:async(conn,host)=>{assert.equal(host,'example.com');return conn;}
 });
 return {call,requests,closed};
}
const testWebsite='https://example.com/blog/';
const canonical=testWebsite+'wp-json/sma-bridge/v1/command';
const signedCommand={body:'{}',headers:{'X-SMA-Signature':'A'.repeat(512)}};
const routeInfo=href=>({namespace:'sma-bridge/v1',methods:['POST'],_links:{self:[{href}]}});
const jsonResponse=data=>'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n'+JSON.stringify(data);
const htmlResponse='HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<html>Website</html>';

test('use the registered canonical route, with one signed POST and pinned TLS on both requests',async()=>{
 const t=routeTransport(await ready,[jsonResponse(routeInfo(canonical)),jsonResponse({ok:true})]);
 assert.deepEqual(await t.call(testWebsite,signedCommand),{ok:true});
 assert.match(t.requests[0],/^OPTIONS \/blog\/wp-json\/sma-bridge\/v1\/command HTTP/);
 assert.doesNotMatch(t.requests[0],/X-SMA-Signature|Content-Length/);
 assert.match(t.requests[1],/^POST \/blog\/wp-json\/sma-bridge\/v1\/command HTTP/);
 assert.match(t.requests[1],/Host: example.com\r\n/);assert.match(t.requests[1],/X-SMA-Signature: A+/);
 assert.deepEqual(t.closed,[0,1]);
});
test('plain permalinks remain usable and provider-supplied URLs are never followed',async()=>{
 for(const reply of [htmlResponse,'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n',jsonResponse({}),jsonResponse(routeInfo('https://other.example/shop')),jsonResponse({...routeInfo(canonical),methods:['GET']})]){
  const t=routeTransport(await ready,[reply,jsonResponse({ok:true})]);
  assert.deepEqual(await t.call(testWebsite,signedCommand),{ok:true});
  assert.match(t.requests[1],/^POST \/blog\/\?rest_route=%2Fsma-bridge%2Fv1%2Fcommand HTTP/);
  assert.equal(t.requests.length,2);
 }
});
test('denied discovery is not followed by a signed command',async()=>{
 const t=routeTransport(await ready,['HTTP/1.1 403 Forbidden\r\nContent-Type: text/html\r\n\r\nForbidden']);
 await assert.rejects(t.call(testWebsite,signedCommand),{code:'PROVIDER_UNAVAILABLE'});
 assert.equal(t.requests.length,1);
});
test('mixed public/private DNS results never open a socket and late timed-out sockets are closed',async()=>{
 const {createWordpressTransport}=await ready;let opened=0,closed=0;
 const signed={body:'{}',headers:{'X-SMA-Signature':'A'.repeat(512)}};
 const blocked=createWordpressTransport({resolve:async()=>['93.184.216.34','127.0.0.1'],connect:async()=>{opened++;},startTls:async()=>{}});
 await assert.rejects(blocked('https://example.com/',signed),{code:'TARGET_REJECTED'});assert.equal(opened,0);
 let release;const late=createWordpressTransport({resolve:async()=>['93.184.216.34'],connect:()=>new Promise(r=>{release=r;}),startTls:async()=>{throw Error('must not start');},timeoutMs:10});
 await assert.rejects(late('https://example.com/',signed));release({close(){closed++;}});await new Promise(r=>setImmediate(r));assert.equal(closed,1);
});

test('failure diagnostics report only the failing stage, allowed error kind, status and response category',async()=>{
 const {createWordpressTransport}=await ready;
 const signed={body:'{}',headers:{'X-SMA-Signature':'A'.repeat(512)}};
 const reports=[];
 const options={resolve:async()=>['93.184.216.34'],onFailure:facts=>reports.push(facts)};
 const transport=createWordpressTransport({...options,connect:async()=>{throw new TypeError('private error details');}});
 await assert.rejects(transport('https://example.com/',signed),{code:'PROVIDER_UNAVAILABLE'});
 assert.deepEqual(reports,[{stage:'connect',kind:'TypeError'}]);
 let sent=false;
 const conn={handshake:async()=>({}),write:async b=>b.length,close(){},read:async b=>{
  if(sent)return null;
  sent=true;const raw=bytes('HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\nprivate response');
  b.set(raw);return raw.length;
 }};
 const rejected=createWordpressTransport({...options,connect:async()=>conn,startTls:async()=>conn});
 await assert.rejects(rejected('https://example.com/',signed),{code:'PROVIDER_UNAVAILABLE'});
 assert.deepEqual(reports[1],{stage:'response',kind:'other',status:'503',reason:'status'});
});

test('the HTML response from an external host is never accepted as a WordPress acknowledgement',async()=>{
 const {createWordpressTransport}=await ready;
 const t=routeTransport({createWordpressTransport},[jsonResponse(routeInfo(canonical)),htmlResponse]);
 await assert.rejects(t.call(testWebsite,signedCommand),{code:'WORDPRESS_HTML_RESPONSE'});
 assert.equal(t.requests.length,2,'failed POST must never be replayed on another route');
});
