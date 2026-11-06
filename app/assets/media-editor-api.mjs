import {fetchAssetThumbnail} from './asset-thumbnail.mjs?v=1';
const origin='https://bnvnmdxosbnuzedokqgh.supabase.co',key='sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW';let client;
async function auth(){if(!client){const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.57.4');client=createClient(origin,key);}return client;}
async function session(owner){const {data,error}=await (await auth()).auth.getSession();if(error||!data?.session||owner&&data.session.user.id!==owner)throw Error('AUTH_REQUIRED');return data.session;}
export async function getOwnerId(){try{return (await session()).user.id;}catch{return null;}}
export async function watchOwner(callback){return (await auth()).auth.onAuthStateChange((_event,s)=>callback(s?.user?.id||null)).data.subscription;}
async function rpc(name,body,owner){const s=await session(owner);const response=await fetch(origin+'/rest/v1/rpc/'+name,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',apikey:key,Authorization:'Bearer '+s.access_token},body:JSON.stringify(body)});if(!response.ok)throw Error('UNAVAILABLE');return response.json();}
export const editorRequest=(action,input,owner)=>rpc('sma_publication_editor_v1',{p_action:action,p_input:input},owner);
export const editorFiles=owner=>rpc('sma_publication_files_v1',{p_action:'list'},owner);
export async function editorThumbnail(file,signal,owner){return fetchAssetThumbnail(file,(await session(owner)).access_token,signal);}
