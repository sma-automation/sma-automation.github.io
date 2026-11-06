import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from './sql-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite(),id=n=>'ab115000-0000-4000-9000-'+String(n).padStart(12,'0'),uid=id(91),other=id(92),sha='a'.repeat(64),revision='sha256:'+sha+':1';let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;},source=async name=>readFile(new URL('../supabase/sql/'+name+'.sql',import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema sma_private;grant usage on schema sma_private,auth to authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.sma_kunden(id bigint primary key,user_id uuid,n8n_kunde_id text,kunde_email text,aktiv boolean,demo_delta_aktiv boolean,zahlung_bestaetigt boolean);grant select on public.sma_kunden to service_role;`);
 await db.exec((await source('publication-preview')).split('-- Definer is needed only')[0]);await db.exec((await source('publication-files')).split('-- Metadata precheck')[0]);
 for(const name of ['publication-magic-effect','publication-video-magic','publication-video-technical'])await db.exec(await source(name));
 await db.query("insert into public.sma_kunden values(91,$1,'fixture','fixture@example.invalid',true,true,false),(92,$2,'other','other@example.invalid',true,false,true)",[uid,other]);
 for(const [n,owner,customer,kind] of [[1,uid,91,'image'],[2,uid,91,'video'],[3,other,92,'image'],[4,uid,91,'image']])await db.query("insert into sma_private.publication_files_v1(id,user_id,customer_id,drive_file_id,name,media_kind,mime_type,revision,modified_at,size_bytes,duration_ms) values($1,$2,$3,$4,'Original filename',$5,$6,$7,now(),1000,$8)",[id(n),owner,customer,'fixture-'+n,kind,kind==='image'?'image/png':'video/mp4',revision,kind==='image'?null:10000]);
 const call=async(query,args=[],owner=uid,role='authenticated')=>{await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);try{return(await db.query(query,args)).rows[0].r;}finally{await db.exec('reset role');}};
 const request=(n,action='start',kind='image',owner=uid)=>call(`select public.sma_publication_${kind==='video'?'video_magic':'magic'}_v1($1,$2) as r`,[action,JSON.stringify({asset_id:id(n),asset_revision:revision})],owner);
 const finish=(n,lease,result=null,error=null,kind='image')=>call(`select public.sma_publication_${kind==='video'?'video_magic':'magic'}_finish_v1($1,$2,$3,$4,$5) as r`,[id(n),lease,result===null?null:JSON.stringify(result),sha,error],'','service_role');
 const history=(input={month:null},owner=uid)=>call('select public.sma_publication_analysis_history_v1($1) as r',[JSON.stringify(input)],owner);
 const journal=async()=>(await db.query('select * from sma_private.publication_analysis_history_v1 order by id')).rows;
 const relax=()=>db.exec("update sma_private.publication_magic_rate_v1 set attempts=0,last_started=null");
 const photo={policy_version:'magic-photo-2026-11-02.1',subject_type:'other',description:'Eine blaue Schale steht auf einer hellen Tischfläche.',observations:['Blaue Schale'],visible_text:[],uncertainties:[],requires_confirmation:true,can_publish:false};
 const old=await request(4);eq((await finish(4,old.lease_id,photo)).ok,true);await relax();
 const cacheBefore=(await db.query('select * from sma_private.publication_magic_results_v1 order by asset_id')).rows;
 await db.exec(await source('publication-analysis-history'));eq(await journal(),[]);eq((await db.query('select * from sma_private.publication_magic_results_v1 order by asset_id')).rows,cacheBefore);eq((await history()).total,0);
 eq((await request(4)).lease_id,undefined);eq(await journal(),[]); // A cached result never fabricates a start.
 let started=await request(1);eq(started.ok,true);eq((await journal()).length,1);eq((await history()).entries[0].status,'processing');
 eq((await request(1)).lease_id,undefined);eq((await journal()).length,1);await request(1,'get');eq((await journal()).length,1);
 const frozen=await journal();eq((await finish(1,id(999),photo)).code,'INVALID_LEASE');eq((await finish(1,started.lease_id,{...photo,can_publish:true})).code,'INVALID_RESULT');eq(await journal(),frozen);
 await db.query("update sma_private.publication_files_v1 set name='Changed filename' where id=$1",[id(1)]);
 eq((await finish(1,started.lease_id,photo)).ok,true);eq((await journal()).length,2);eq((await journal()).filter(e=>e.event==='started'),frozen);
 let h=await history();eq(h.total,1);eq(h.can_publish,false);eq(h.entries[0].status,'completed');eq(h.entries[0].file_name,'Original filename');eq(Object.keys(h.entries[0]).sort(),['error_code','file_name','finished_at','id','media_kind','started_at','status']);
 eq((await finish(1,started.lease_id,photo)).code,'INVALID_LEASE');eq((await journal()).length,2);
 const video={policy_version:'magic-video-2026-11-03.1',subject_type:'other',description:'Ein blaues Quadrat bewegt sich von links nach rechts.',spoken_summary:'',observations:['Ein blaues Quadrat'],visible_text:[],uncertainties:[],transcript:'',audio_status:'no_audio_stream',content_comparison:'model_checked_sampled_evidence',requires_confirmation:true,can_publish:false,evidence:{source_sha256:sha,source_size_bytes:1000,duration_ms:10000,positions_ms:[0,9850],frame_sha256:['b'.repeat(64),'c'.repeat(64)],sampling:'representative_frames_not_full_moderation',technical:{schema:'sma-video-technical-v1',decode:'complete',video_codec:'h264',pixel_format:'yuv420p',width_px:720,height_px:1280,frame_rate_num:25,frame_rate_den:1,decoded_frames:250,min_frame_interval_us:40000,max_frame_interval_us:40000,video_bit_rate_bps:100000,audio_codec:null,audio_sample_rate_hz:null,audio_channels:null,audio_bit_rate_bps:null}}};
 await relax();started=await request(2,'start','video');eq(started.ok,true);eq((await finish(2,started.lease_id,video,null,'video')).ok,true);eq((await history()).total,2);eq((await journal()).find(e=>e.event==='completed'&&e.media_kind==='video').result.transcript,'');
 // A failing attempt and its retry remain two distinct attempts with immutable events.
 await relax();started=await request(3,'start','image',other);eq(started.ok,true);eq((await finish(3,started.lease_id,null,'MODEL_FAILED')).code,'MODEL_FAILED');
 const failedSnapshot=(await journal()).filter(e=>e.asset_id===id(3));eq(failedSnapshot.length,2);eq((await history({},other)).entries[0].error_code,'MAGIC_UNAVAILABLE');
 await relax();const retried=await request(3,'start','image',other);eq(retried.ok,true);assert.notEqual(retried.lease_id,started.lease_id);checks++;eq((await history({},other)).total,2);eq((await journal()).filter(e=>failedSnapshot.some(x=>x.id===e.id)),failedSnapshot);
 eq((await finish(3,started.lease_id,photo)).code,'INVALID_LEASE');eq((await finish(3,retried.lease_id,photo)).ok,true);eq((await history()).total,2);
 // Atomic rollback includes both cache and journal; a failing journal write cannot commit the cache alone.
 await db.exec('begin');await db.query("update sma_private.publication_files_v1 set revision='sha256:'||repeat('a',64)||':2' where id=$1",[id(4)]);
 await db.query("update sma_private.publication_magic_results_v1 set status='processing',lease_id=$1,lease_until=now()+interval '4 minutes',started_at=now(),finished_at=null,result=null,content_sha256=null,asset_revision='sha256:'||repeat('a',64)||':2' where asset_id=$2",[id(888),id(4)]);eq((await journal()).length,9);await db.exec('rollback');eq((await journal()).length,8);
 await db.exec('begin');
 await db.exec("create function sma_private.fixture_reject_analysis_event() returns trigger language plpgsql as $$begin raise exception 'fixture journal failure';end$$;create trigger fixture_reject_analysis_event before insert on sma_private.publication_analysis_history_v1 for each row execute function sma_private.fixture_reject_analysis_event();");
 const beforeFailure=(await db.query('select * from sma_private.publication_magic_results_v1 order by asset_id')).rows;
 await db.exec('savepoint reject_event');await assert.rejects(()=>db.query("update sma_private.publication_magic_results_v1 set status='processing',lease_id=$1,lease_until=now()+interval '4 minutes',started_at=now(),finished_at=null,result=null,content_sha256=null where asset_id=$2",[id(889),id(4)]),/fixture journal failure/);checks++;
 await db.exec('rollback to savepoint reject_event');eq((await db.query('select * from sma_private.publication_magic_results_v1 order by asset_id')).rows,beforeFailure);await db.exec('rollback');
 // Late/no-result attempts use lease expiry only; reading never writes a false completion event.
 await db.exec('begin');await db.query("update sma_private.publication_magic_results_v1 set status='processing',lease_id=$1,lease_until=now()-interval '1 minute',started_at=now()-interval '5 minutes',finished_at=null,result=null,content_sha256=null where asset_id=$2",[id(777),id(4)]);
 const expired=await journal();eq((await history()).entries.find(e=>e.id===expired.find(e=>e.attempt_id===id(777)).id).status,'timed_out');await history();eq(await journal(),expired);eq((await finish(4,id(777),photo)).code,'INVALID_LEASE');await relax();eq((await request(4)).ok,true);eq((await history()).total,4);await db.exec('rollback');
 // History belongs to the original owner/account binding and file, even after revisions/availability change.
 await db.query("update sma_private.publication_files_v1 set revision='r2',available=false where id=$1",[id(1)]);eq((await history()).total,2);
 await db.query('update sma_private.publication_files_v1 set user_id=$1,customer_id=92 where id=$2',[other,id(1)]);eq((await history()).total,1);eq((await history({},other)).total,2);
 await db.query('update sma_private.publication_files_v1 set user_id=$1,customer_id=91 where id=$2',[uid,id(1)]);await db.exec("update public.sma_kunden set n8n_kunde_id='changed' where id=91");eq((await history()).total,0);await db.exec("update public.sma_kunden set n8n_kunde_id='fixture' where id=91");
 // Synthetic journal rows test timestamp ties, Vienna month boundaries and the bounded cursor.
 await db.exec('delete from sma_private.publication_analysis_history_v1');
 const seed=(n,at)=>db.query("insert into sma_private.publication_analysis_history_v1(id,attempt_id,event,asset_id,asset_revision,policy_version,user_id,customer_id,n8n_kunde_id,kunde_email,file_name,media_kind,started_at,lease_until) values($1,$1,'started',$2,$3,'magic-photo-2026-11-02.1',$4,91,'fixture','fixture@example.invalid','Historical name','image',$5,$5::timestamptz+interval '4 minutes')",[id(n),id(1),revision,uid,at]);
 const dates=['2026-10-31T22:59:59.999Z','2026-10-31T23:00:00Z','2026-11-30T22:59:59.999Z','2026-11-30T23:00:00Z','2026-03-31T21:59:59.999Z','2026-03-31T22:00:00Z'];for(let n=0;n<dates.length;n++)await seed(100+n,dates[n]);
 eq((await history({month:'2026-11'})).entries.map(e=>e.id),[id(102),id(101)]);eq((await history({month:'2026-04'})).entries.map(e=>e.id),[id(105)]);eq((await history({month:'2026-03'})).entries.map(e=>e.id),[id(104)]);
 for(let n=200;n<225;n++)await seed(n,'2026-11-05T12:00:00Z');const first=await history({month:'2026-11'}),second=await history({month:'2026-11',...first.next});eq(first.entries.length,20);eq(second.entries.length,7);eq(first.total,27);eq(new Set([...first.entries,...second.entries].map(e=>e.id)).size,27);eq(second.has_more,false);
 const cursor={month:'2026-11',before_at:'2026-11-05T12:00:00Z',before_id:id(500)};
 for(const input of [null,[],{customer_id:92},{month:'2026-13'},{month:'1999-01'},{month:202611},{before_id:id(1)},{before_at:cursor.before_at},{...cursor,month:undefined},{...cursor,before_at:null},{...cursor,before_at:'2026-02-31T12:00:00Z'},{...cursor,before_at:'2026-11-30T23:00:00Z'},{...cursor,before_id:'bad'}])eq((await history(input)).code,'INVALID_INPUT');
 const beforeRead=await journal();await history();await history({month:'2026-11'});eq(await journal(),beforeRead);
 eq((await history({},'')).code,'AUTH_REQUIRED');await db.exec('update public.sma_kunden set aktiv=false where id=91');eq((await history()).code,'ACCESS_INACTIVE');await db.exec('update public.sma_kunden set aktiv=true,demo_delta_aktiv=false where id=91');eq((await history()).code,'ACCESS_INACTIVE');await db.query('update public.sma_kunden set user_id=$1 where id=92',[uid]);eq((await history()).code,'ACCOUNT_UNAVAILABLE');
 for(const role of ['anon','authenticated','service_role']){
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])eq((await db.query("select has_table_privilege($1,'sma_private.publication_analysis_history_v1',$2) as allowed",[role,privilege])).rows[0].allowed,false);
  await db.exec('set role '+role);for(const query of ['select * from sma_private.publication_analysis_history_v1','delete from sma_private.publication_analysis_history_v1',"update sma_private.publication_analysis_history_v1 set file_name='changed'",'select sma_private.publication_analysis_record_v1()',...(role==='authenticated'?[]:['select public.sma_publication_analysis_history_v1()'])]){await assert.rejects(()=>db.query(query),/permission denied/);checks++;}await db.exec('reset role');
 }
 eq((await db.query("select relrowsecurity from pg_class where oid='sma_private.publication_analysis_history_v1'::regclass")).rows[0].relrowsecurity,true);
 eq((await db.query("select provolatile,prosecdef,proconfig from pg_proc where oid='sma_private.publication_analysis_history_read_v1(jsonb)'::regprocedure")).rows[0],{provolatile:'s',prosecdef:true,proconfig:['search_path=""']});
 console.log(`${checks} analysis-history SQL checks passed.`);
}finally{await db.close();}
