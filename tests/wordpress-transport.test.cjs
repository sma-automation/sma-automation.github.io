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
test('transport pins the resolved IP but validates TLS and Host against the original domain',async()=>{
 const {createWordpressTransport}=await ready;const calls=[];let read=false,closed=0,written='';
 const conn={handshake:async()=>{calls.push('handshake');return {alpnProtocol:'http/1.1'};},write:async b=>{written+=new TextDecoder().decode(b);return b.length;},read:async b=>{if(read)return null;read=true;const v=bytes('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}');b.set(v);return v.length;},close(){closed++;}};
 const send=createWordpressTransport({resolve:async h=>{calls.push(['dns',h]);return ['93.184.216.34'];},connect:async ip=>{calls.push(['ip',ip]);return conn;},startTls:async(c,h)=>{assert.equal(c,conn);calls.push(['tls',h]);return conn;}});
 assert.deepEqual(await send('https://example.com/',{body:'{}',headers:{'X-SMA-Signature':'A'.repeat(512)}}),{});
 assert.deepEqual(calls,[['dns','example.com'],['ip','93.184.216.34'],['tls','example.com'],'handshake']);assert.match(written,/Host: example.com\r\n/);assert.equal(closed,1);
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
 let received=false;
 const conn={handshake:async()=>({}),write:async b=>b.length,close(){},read:async b=>{
  if(received)return null;
  received=true;
  const raw=bytes('HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n<html>Website</html>');
  b.set(raw);return raw.length;
 }};
 const call=createWordpressTransport({resolve:async()=>['93.184.216.34'],connect:async()=>conn,startTls:async()=>conn});
 await assert.rejects(call('https://example.com/',{body:'{}',headers:{'X-SMA-Signature':'A'.repeat(512)}}),{code:'WORDPRESS_HTML_RESPONSE'});
});
