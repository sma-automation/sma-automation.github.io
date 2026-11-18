'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

async function fixture(){
  const {createPaymentHandler}=await import('../supabase/functions/sma-package-payment/handler.mjs');
  const calls=[];
  const forbidden=name=>async()=>{calls.push(name);throw Error('Unexpected provider call: '+name);};
  return {
    handler:createPaymentHandler({
      authorize:async()=>{calls.push('authorize');return false;},
      worker:forbidden('worker'),bridge:forbidden('bridge'),
      renewal:forbidden('renewal'),consumeRenewal:forbidden('consumeRenewal'),
      schedule:{claim:forbidden('schedule.claim'),record:forbidden('schedule.record')},
      signature:async()=> 'fixture-proof',callback:'https://fixture.invalid/payment'
    }),
    calls
  };
}
const request=(url,body,headers={})=>new Request(url,{
  method:'POST',headers,body,duplex:'half'
});
const code=async response=>(await response.json()).code;
const base='https://fixture.invalid/payment';

test('Oversized customer stream is rejected at the byte boundary and canceled before authorization',async()=>{
  const x=await fixture();let canceled=0;
  const stream=new ReadableStream({
    start(controller){
      controller.enqueue(new Uint8Array(2000).fill(32));
      controller.enqueue(new Uint8Array(49).fill(32));
    },
    cancel(){canceled++;}
  });
  const response=await x.handler(request(base,stream,{authorization:'Bearer session'}));
  assert.equal(response.status,413);
  assert.equal(await code(response),'INVALID');
  assert.equal(canceled,1);
  assert.deepEqual(x.calls,[]);
});

test('Scheduled and signed callback routes also reject oversized streams without provider work',async()=>{
  const x=await fixture();
  const schedule=await x.handler(request(base+'?scheduled=1','x'.repeat(101),{
    'content-type':'application/json'
  }));
  assert.equal(schedule.status,400);
  assert.equal(await code(schedule),'INVALID');

  const event=await x.handler(request(base+'?order='+randomUUID()+'&proof=fixture-proof',
    'x'.repeat(151),{'content-type':'application/x-www-form-urlencoded'}));
  assert.equal(event.status,400);
  assert.equal(await code(event),'INVALID');
  assert.deepEqual(x.calls,[]);
});

test('Declared size hints, UTF-8 bytes and invalid encoding cannot bypass the body limit',async()=>{
  const x=await fixture();
  const declared=await x.handler(request(base,'{}',{
    authorization:'Bearer session','content-length':'4096'
  }));
  assert.equal(declared.status,413);
  assert.equal(await code(declared),'INVALID');

  const misleading=await x.handler(request(base,'é'.repeat(1100),{
    authorization:'Bearer session','content-length':'2'
  }));
  assert.equal(misleading.status,413);
  assert.equal(await code(misleading),'INVALID');

  const invalid=await x.handler(request(base,new Uint8Array([0xff]),{
    authorization:'Bearer session'
  }));
  assert.equal(invalid.status,400);
  assert.equal(await code(invalid),'INVALID');
  assert.deepEqual(x.calls,[]);
});

test('Normal chunked customer JSON still reaches authorization but never the payment worker if denied',async()=>{
  const x=await fixture();
  const bytes=new TextEncoder().encode(JSON.stringify({order:randomUUID(),owner:randomUUID()}));
  const stream=new ReadableStream({
    start(controller){
      controller.enqueue(bytes.subarray(0,8));
      controller.enqueue(bytes.subarray(8,bytes.byteLength-7));
      controller.enqueue(bytes.subarray(bytes.byteLength-7));
      controller.close();
    }
  });
  const response=await x.handler(request(base,stream,{authorization:'Bearer session'}));
  assert.equal(response.status,403);
  assert.equal(await code(response),'DENIED');
  assert.deepEqual(x.calls,['authorize']);
});
