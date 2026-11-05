const {test}=require('node:test');const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const json=value=>new Response(JSON.stringify({success:true,result:value}),{headers:{'Content-Type':'application/json'}});
const job={id:'ab660000-0000-4000-8000-000000000091',customer_id:91,site_id:'ab660000-0000-4000-8000-000000000092',marker:'ab660000-0000-4000-8000-000000000093',hostname:'seite-91-ab660000.sma-automation.com',project_name:'sma-site-ab660000000040008000000000000091',phase:'project',provider_state:{}};
const providers={account_id:'a'.repeat(32),cloudflare_token:'fixture-cloudflare-token',zone:'sma-automation.com'};
const project={id:'project-1',name:job.project_name,production_branch:'main',deployment_configs:{production:{env_vars:{SMA_SETUP_OWNER:{type:'plain_text',value:job.marker}}}}};
test('server derives exact customer host and project before contacting any provider',async()=>{
 const {performSetupStep}=await import('../hosting/customer-website-setup/pages.mjs');let calls=0;
 for(const change of [{hostname:'other.sma-automation.com'},{project_name:'foreign-project'},{customer_id:92},{site_id:'ab660001-0000-4000-8000-000000000092'}])await assert.rejects(performSetupStep({job:{...job,...change},providers,fetchImpl:()=>{calls++;}}),/INVALID_JOB/);
 assert.equal(calls,0);
});
test('foreign Pages project cannot be adopted or overwritten',async()=>{
 const {performSetupStep}=await import('../hosting/customer-website-setup/pages.mjs');const methods=[];
 await assert.rejects(performSetupStep({job,providers,fetchImpl:async(_,o)=>{methods.push(o.method);return json({...project,deployment_configs:{}});}}),/RESOURCE_CONFLICT/);assert.deepEqual(methods,['GET']);
});
test('owned project is reused after a lost create response without another POST',async()=>{
 const {performSetupStep}=await import('../hosting/customer-website-setup/pages.mjs');const methods=[];
 assert.deepEqual(await performSetupStep({job,providers,fetchImpl:async(_,o)=>{methods.push(o.method);return json(project);}}),{project_id:'project-1'});assert.deepEqual(methods,['GET']);
});
test('new Pages project receives the durable ownership marker',async()=>{
 const {performSetupStep}=await import('../hosting/customer-website-setup/pages.mjs');let n=0;
 const result=await performSetupStep({job,providers,fetchImpl:async(_,o)=>{if(!n++)return new Response('',{status:404});const body=JSON.parse(o.body);assert.equal(body.name,job.project_name);assert.equal(body.deployment_configs.production.env_vars.SMA_SETUP_OWNER.value,job.marker);return json(project);}});assert.equal(result.project_id,project.id);assert.equal(n,2);
});
test('lost deployment response finds its original deployment instead of uploading again',async()=>{
 const {performSetupStep}=await import('../hosting/customer-website-setup/pages.mjs');const urls=[];
 const result=await performSetupStep({job:{...job,phase:'deploy'},providers,template:{version:'v1',files:{}},fetchImpl:async(url,o)=>{urls.push(url);assert.equal(o.method,'GET');return json(url.includes('/deployments?')?[{id:'dep-1',environment:'production',deployment_trigger:{metadata:{commit_message:'sma-setup:'+job.id+':v1'}},latest_stage:{name:'deploy',status:'success'}}]:project);}});assert.deepEqual(result,{deployment_id:'dep-1'});assert.equal(urls.length,2);
});
test('deployment replacement blocks domain or DNS mutations',async()=>{
 const {performSetupStep}=await import('../hosting/customer-website-setup/pages.mjs');let calls=0;
 await assert.rejects(performSetupStep({job:{...job,phase:'domain',provider_state:{deployment_id:'owned'}},providers,fetchImpl:async()=>{calls++;return json({...project,canonical_deployment:{id:'foreign'}});}}),/DEPLOYMENT_CHANGED/);assert.equal(calls,1);
});
test('OIDC requires a verified signature, exact repository, branch, workflow and audience',async()=>{
 const {verifyBootstrapIdentity,bootstrapAudience}=await import('../hosting/customer-website-setup/oidc.mjs');
 const keys=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await webcrypto.subtle.exportKey('jwk',keys.publicKey),kid:'fixture',use:'sig'};
 const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),now=Date.now(),seconds=Math.floor(now/1000);
 const claims={iss:'https://token.actions.githubusercontent.com',aud:bootstrapAudience,sub:'repo:sma-automation/sma-automation.github.io:ref:refs/heads/customer-domain-automation',repository_id:'1371569809',repository:'sma-automation/sma-automation.github.io',ref:'refs/heads/customer-domain-automation',event_name:'push',workflow_ref:'sma-automation/sma-automation.github.io/.github/workflows/customer-domain-bootstrap.yml@refs/heads/customer-domain-automation',sha:'a'.repeat(40),workflow_sha:'a'.repeat(40),iat:seconds,nbf:seconds,exp:seconds+300};
 const sign=async(c,h={alg:'RS256',typ:'JWT',kid:'fixture'})=>{const body=enc(h)+'.'+enc(c);return body+'.'+Buffer.from(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,Buffer.from(body))).toString('base64url');};
 const options={now,fetchImpl:async url=>{assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');return new Response(JSON.stringify({keys:[jwk]}));}};
 assert.deepEqual(await verifyBootstrapIdentity(await sign(claims),options),{sha:claims.sha});
 for(const change of [{aud:'foreign'},{repository_id:'12'},{ref:'refs/heads/main'},{workflow_ref:'foreign'},{exp:seconds-1},{sha:'b'.repeat(40)},{event_name:'pull_request'}])await assert.rejects(verifyBootstrapIdentity(await sign({...claims,...change}),options),/BOOTSTRAP_REJECTED/);
 const signed=await sign(claims);await assert.rejects(verifyBootstrapIdentity(signed.slice(0,-20)+'a'.repeat(20),options),/BOOTSTRAP_REJECTED/);
 await assert.rejects(verifyBootstrapIdentity(await sign(claims,{alg:'none',typ:'JWT',kid:'fixture'}),options),/BOOTSTRAP_REJECTED/);
});
