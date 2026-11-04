import {readFile} from 'node:fs/promises';
import {PHP,loadPHPRuntime} from './php-runtime/node_modules/@php-wasm/universal/index.js';
import {getPHPLoaderModule} from './php-runtime/node_modules/@php-wasm/node-8-3/index.js';
import {createBridgeKeys,signBridgeCommand} from '../supabase/functions/_shared/wordpress-bridge.mjs';
const php=new PHP(await loadPHPRuntime(await getPHPLoaderModule()));
try{
 const now=1800000000,keys=await createBridgeKeys(),other=await createBridgeKeys();
 const attemptId='a1000000-0000-4000-8000-000000000101',requestId='b1000000-0000-4000-8000-000000000101';
 const defaults={privateKey:keys.privateKey,attemptId,requestId,issuedAt:now};
 const sign=patch=>signBridgeCommand({...defaults,...patch});
 const commands={
  inspect:await sign({action:'inspect'}),wrongKey:await sign({action:'inspect',privateKey:other.privateKey}),
  wrongAttempt:await sign({action:'inspect',attemptId:requestId}),
  create:await sign({action:'sync_draft',expectedRevision:0}),
  replayLater:await sign({action:'sync_draft',expectedRevision:0,issuedAt:now+120}),
  sameIdChangedIntent:await sign({action:'sync_draft',expectedRevision:1}),
  oldRevision:await sign({action:'sync_draft',expectedRevision:0,requestId:crypto.randomUUID()}),
  update:await sign({action:'sync_draft',expectedRevision:1,requestId:crypto.randomUUID()}),
  updateAgain:await sign({action:'sync_draft',expectedRevision:2,requestId:crypto.randomUUID()})
 };
 commands.publish={...commands.create,body:commands.create.body.replace('sync_draft','publish')};
 commands.tampered={...commands.create,body:commands.create.body.replace('"expected_revision":0','"expected_revision":1')};
 for(const name of ['protocol.php','store.php','sma-bridge.php']){
  php.writeFile('/'+name,await readFile(new URL('../wordpress/sma-bridge/'+name,import.meta.url),'utf8'));
  const lint=await php.run({code:`<?php token_get_all(file_get_contents('/${name}'), TOKEN_PARSE); echo 'ok';`});
  if(lint.exitCode!==0||lint.text!=='ok')throw Error('PHP parse failed: '+name+' '+lint.errors);
 }
 php.writeFile('/vectors.json',JSON.stringify({now,commands,privateKey:keys.privateKey,approval:{ok:true,attempt_id:attemptId,website_url:'https://example.com/',shop_slug:'sma-testkunde',account_label:'Synthetic SMA customer',public_key:keys.publicKey,expires_at:now+300}}));
 console.log('PHP '+(await php.run({code:'<?php echo PHP_VERSION;'})).text+'; real OpenSSL verification of JavaScript signatures; WordPress storage double');
 for(const file of ['wordpress-bridge.php','wordpress-bridge-boundaries.php']){
  php.writeFile('/test.php',await readFile(new URL('./'+file,import.meta.url),'utf8'));
  const result=await php.run({scriptPath:'/test.php'});
  if(result.exitCode!==0||result.errors)throw Error(result.errors||'PHP test failed');
  console.log(result.text.trim());
 }
}finally{php.exit();}
