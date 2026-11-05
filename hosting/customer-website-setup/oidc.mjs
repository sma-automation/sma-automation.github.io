// GitHub-issued signatures only; token-controlled URLs/algorithms are never used.
const issuer='https://token.actions.githubusercontent.com';
export const bootstrapAudience='https://bnvnmdxosbnuzedokqgh.supabase.co/functions/v1/sma-website-setup';
const reject=()=>{throw Error('BOOTSTRAP_REJECTED');};
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function verifyBootstrapIdentity(token,{fetchImpl=fetch,now=Date.now()}={}){
 try{
  if(typeof token!=='string'||token.length>16000)reject();
  const parts=token.split('.');if(parts.length!==3||parts.some(p=>!/^[-_A-Za-z0-9]+$/.test(p)))reject();
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if(header.alg!=='RS256'||header.typ!=='JWT'||typeof header.kid!=='string'||header.jku||header.jwk||header.x5u)reject();
  const seconds=Math.floor(now/1000);
  if(claims.iss!==issuer||claims.aud!==bootstrapAudience||claims.sub!=='repo:sma-automation/sma-automation.github.io:ref:refs/heads/customer-domain-automation'
   ||claims.repository_id!=='1371569809'||claims.repository!=='sma-automation/sma-automation.github.io'
   ||claims.ref!=='refs/heads/customer-domain-automation'||claims.event_name!=='push'
   ||claims.workflow_ref!=='sma-automation/sma-automation.github.io/.github/workflows/customer-domain-bootstrap.yml@refs/heads/customer-domain-automation'
   ||!Number.isFinite(claims.exp)||claims.exp<=seconds||!Number.isFinite(claims.iat)||claims.iat>seconds+30||claims.iat<seconds-600
   ||(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>seconds+30))
   ||!/^[a-f0-9]{40}$/.test(claims.sha)||claims.workflow_sha!==claims.sha)reject();
  const r=await fetchImpl(issuer+'/.well-known/jwks',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)reject();const raw=await r.text();if(raw.length>65536)reject();const keys=JSON.parse(raw).keys;
  const matches=keys?.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use==='sig');if(matches?.length!==1)reject();
  const key=await crypto.subtle.importKey('jwk',matches[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))reject();
  return {sha:claims.sha};
 }catch{reject();}
}
