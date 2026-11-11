/**
 * Optional private Google Drive OAuth refresh provider.
 * Use only with an EXISTING operator-approved Drive OAuth credential.
 * Keep client secret and refresh token in the server's secret manager.
 * No new consent/login, OAuth browser flow, or token logging here.
 */
const must=(condition,code)=>{if(!condition)throw Error(code);};
const nonblank=x=>typeof x==='string'&&x.length>=6&&x.length<=16384&&!/[\r\n]/.test(x);
const OAUTH_ENDPOINT='https://oauth2.googleapis.com/token';
export function createGoogleDriveRefreshProvider({
 clientId,clientSecret,refreshToken,fetchImpl=globalThis.fetch,
 now=()=>Date.now()
}){
 must(nonblank(clientId)&&nonblank(clientSecret)&&nonblank(refreshToken),
  'GOOGLE_OAUTH_CREDENTIAL_MISSING');
 must(typeof fetchImpl==='function'&&typeof now==='function','GOOGLE_OAUTH_CLIENT_INVALID');
 let cachedToken=null,cachedUntil=0,inFlight=null;
 async function fetchNewToken(){
  const form=new URLSearchParams({client_id:clientId,
   client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'});
  let response;
  try{
   response=await fetchImpl(OAUTH_ENDPOINT,{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:form.toString(),redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(15000)
   });
  }catch{throw Error('GOOGLE_TOKEN_REFRESH_UNAVAILABLE');}
  must(response?.status===200&&response.body,'GOOGLE_TOKEN_REFRESH_DENIED');
  let text='';let size=0;
  for await(const part of response.body){
   must(part instanceof Uint8Array,'GOOGLE_TOKEN_RESPONSE_INVALID');
   size+=part.byteLength;
   must(size<=16384,'GOOGLE_TOKEN_RESPONSE_TOO_LARGE');
   text+=Buffer.from(part).toString('utf8');
  }
  let json;try{json=JSON.parse(text);}catch{throw Error('GOOGLE_TOKEN_RESPONSE_INVALID');}
  must(json?.token_type==='Bearer'&&typeof json.access_token==='string'
   &&json.access_token.length>=12&&json.access_token.length<16384
   &&Number.isInteger(json.expires_in)&&json.expires_in>=90
   &&json.expires_in<=86400,'GOOGLE_TOKEN_RESPONSE_INVALID');
  cachedToken=json.access_token;
  cachedUntil=now()+json.expires_in*1000;
  return cachedToken;
 }
 return async()=>{
  if(cachedToken&&now()<cachedUntil-60000)return cachedToken;
  if(!inFlight)inFlight=fetchNewToken().finally(()=>{inFlight=null;});
  return inFlight;
 };
}
