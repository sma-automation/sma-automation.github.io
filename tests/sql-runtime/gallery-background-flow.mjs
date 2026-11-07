// Execute the exported n8n graph, substituting only Drive/Data Table/Storage transport.
// Expressions, Code nodes, both ticket gates, upload binding and receipt use production code.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
export async function backgroundFlow({db,value,pick,uid,sha,file,browserJob}){
 await value("select public.sma_gallery_music_v1('audio_present',$1) v",[{id:browserJob.id,lease:browserJob.lease}]);
 const fixture=JSON.parse(await readFile('n8n/publishing/fixtures/gallery-music-probe.json'));
 const video=Buffer.from(fixture.video,'base64'),audio=Buffer.from(fixture.audio,'base64');
 const audioPath='render/'+sha+'/'+hash(audio)+'.aac';
 await db.query("update storage.objects set name=$1,metadata=$2 where name like 'render/%'",[audioPath,{size:audio.length,mimetype:'audio/aac'}]);
 const sourceId=await file(3,'Demo-SKU.mp4');
 await db.query("update sma_private.publication_files_v1 set revision=$1,size_bytes=$2 where id=$3",['sha256:'+hash(video)+':1',video.length,sourceId]);
 const folder='fixture_processing_folder',driveId='fixture_generated_file_03';
 const grantUrl='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=fixture';
 const sourceMeta={id:'file_fixture_3',mimeType:'video/mp4',parents:[folder],size:String(video.length),sha256Checksum:hash(video),version:'1',trashed:false,capabilities:{canDownload:true}};
 const shape=json=>[{json}],w=JSON.parse(await readFile('n8n/publishing/gallery-soundtrack-workflow.json'));
 const nodes=new Map(w.nodes.map(n=>[n.name,n])),ctx=new Map(),ticket=await pick();
 assert.ok(ticket);
 let nodeName='Galerieauftrag',input=shape({body:ticket}),written=null,end;
 const ref=name=>({first:()=>ctx.get(name)?.[0],isExecuted:ctx.has(name)});
 function expression(v){
  if(!v.startsWith('={{'))return v;
  assert.ok(!v.slice(3,-2).includes('}}'),'premature n8n expression delimiter');
  return Function('$json','$','return ('+v.slice(3,-2)+')')(input[0].json,ref);
 }
 while(nodeName){
  const node=nodes.get(nodeName),p=node.parameters;let output=input,branch=0;
  const type=node.type.split('.').at(-1);
  if(type==='if')branch=expression(p.conditions.conditions[0].leftValue)?0:1;
  if(type==='code'){
   const helpers={getBinaryDataBuffer:async(i,k)=>input[i].binary[k],prepareBinaryData:async b=>b};
   output=await new AsyncFunction('$json','$input','$','require','Buffer',p.jsCode).call({helpers},input[0].json,{first:()=>input[0],all:()=>input},ref,require,Buffer);
  }
  if(type==='dataTable')output=shape({kunde_id:'fixture',kunde_email:'owner@example.invalid',zugang_aktiv:true,zahlung_bestaetigt:true,upload_folder_id:'fixture_upload_folder',processing_folder_id:folder});
  if(type==='httpRequest'){
   const url=expression(p.url);
   if(url.includes('/rest/v1/rpc/')){
    const body=expression(p.jsonBody),name=url.split('/').at(-1);
    if(name==='sma_gallery_background_v1')output=shape(await value('select public.sma_gallery_background_v1($1,$2) v',[body.p_action,body.p_input]));
    else if(name==='sma_publication_upload_bind_v1')output=shape(await value('select public.sma_publication_upload_bind_v1($1,$2,$3,$4,$5) v',[body.p_id,body.p_lease_id,body.p_drive_file_id,body.p_folder_id,body.p_upload_url]));
    else if(name==='sma_publication_upload_finish_v1')output=shape(await value('select public.sma_publication_upload_finish_v1($1,$2) v',[body.p_id,body.p_file]));
    else assert.fail(name);
   }else if(nodeName==='Dateimetadaten lesen'||nodeName==='Dateistand erneut lesen')output=shape(sourceMeta);
   else if(nodeName==='Originaldatei laden')output=[{json:{},binary:{data:video}}];
   else if(nodeName==='SMA-Musik laden'){assert.ok(url.endsWith('/'+audioPath));output=[{json:{},binary:{data:audio}}];}
   else if(nodeName==='Zielordner lesen')output=shape({id:folder,trashed:false,mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});
   else if(nodeName==='Datei-ID reservieren')output=shape({ids:[driveId]});
   else if(nodeName==='Übertragung vorbereiten'){const b=expression(p.jsonBody);assert.equal(b.id,driveId);assert.deepEqual(b.parents,[folder]);assert.equal(b.appProperties.sma_upload_id,ticket.id);output=shape({statusCode:200,headers:{location:grantUrl}});}
   else if(nodeName==='Übertragungsstand lesen'){assert.equal(url,grantUrl);output=shape({statusCode:308,headers:{range:'bytes=0-99'}});}
   else if(nodeName==='Musikfassung übertragen'){
    assert.equal(url,grantUrl);const full=ref('Musikfassung erstellen').first().binary.data;
    assert.equal(input[0].json.range,'bytes 100-'+(full.length-1)+'/'+full.length);
    written=Buffer.concat([full.subarray(0,100),input[0].binary.data]);assert.equal(hash(written),fixture.expected);output=shape({statusCode:201});
   }else if(nodeName==='Hochgeladene Datei prüfen'){
    assert.ok(url.endsWith('/'+driveId));const u=ref('Upload reservieren').first().json;
    output=shape({...sourceMeta,id:driveId,size:String(written.length),sha256Checksum:hash(written),name:u.name,modifiedTime:'2026-11-07T12:00:00Z',appProperties:{sma_upload_id:u.upload_id}});
   }else assert.fail(nodeName);
  }
  ctx.set(nodeName,output);end=nodeName;
  nodeName=output.length?w.connections[nodeName]?.main[branch]?.[0]?.node:null;input=output;
 }
 assert.equal(end,'Speicherung prüfen');assert.equal(input[0].json.can_publish,false);
 assert.equal(await value("select state v from sma_private.gallery_music_v1 where id=$1",[ticket.id]),'completed');
 assert.equal(await value("select count(*)::int v from sma_private.publication_uploads_v1 where id=$1 and status='completed'",[ticket.id]),1);
 console.log('Full background graph: closed-dashboard dispatch, verified source and track, resumable upload, correct AAC and one stored receipt.');
 return ticket.id;
}
