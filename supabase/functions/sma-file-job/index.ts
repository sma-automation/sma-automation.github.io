import {createFileJobHandler} from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
async function rpc(name:string,key:string,authorization:string,action:string,input:unknown){
 const response=await fetch(base+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',
  headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},
  body:JSON.stringify({p_action:action,p_input:input}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('FILE_JOB_UNAVAILABLE');
 return response.json();
}
Deno.serve(createFileJobHandler({
 authorize:(auth:string,action:string,input:unknown)=>rpc('sma_file_job_v1',anon,auth,action,input),
 worker:(action:string,input:unknown)=>rpc('sma_file_job_worker_v1',service,'Bearer '+service,action,input),
}));
