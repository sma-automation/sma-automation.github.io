"""Build the independent n8n Cloud workflow using existing Drive and Supabase credentials."""
import copy
import json
from pathlib import Path
root = Path("n8n/publishing")
common = (root / "build-file-catalog.py").read_text()
exec(common[:common.index("node('Dateien abgleichen'")].replace("file-catalog-workflow.json","gallery-soundtrack-workflow.json"))
source_nodes = {n["name"]:n for n in json.loads((root/"editor-source-workflow.json").read_text())["nodes"]}
upload_nodes = {n["name"]:n for n in json.loads((root/"device-upload-workflow.json").read_text())["nodes"]}
mux = (root/"gallery-soundtrack.cjs").read_text().split("module.exports=")[0]
utils = (root/"device-upload.cjs").read_text().split("module.exports=")[0]
source_utils = (root/"editor-source.cjs").read_text().split("module.exports=")[0]
rpc_root = "https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/"
bg_rpc = rpc_root + "sma_gallery_background_v1"
ctx = "$('Eigene Datei prüfen').first().json"
def rpc(name, action, data, x, y=0):
    body = "={{ {p_action:'"+action+"',p_input:"+data+" } }}"
    return node(name,"httpRequest",{**http,"url":bg_rpc,"jsonBody":body,"authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth"},x,y,v=4.5,credentials=cred)
def reused(bank,name,x,y=0):
    n=bank[name]
    return node(name,n["type"].split(".")[-1],copy.deepcopy(n["parameters"]),x,y,v=n["typeVersion"],**{k:n[k] for k in ["credentials","alwaysOutputData"] if k in n})
def chain(*names):
    for a,b in zip(names,names[1:]):edge(a,b)
def guard(name,body,x,y=0):
    return code(name,body,x,y)

node("Galerieauftrag","webhook",{"httpMethod":"POST","path":"sma-gallery-soundtrack-v1","options":{"responseData":"noData"}},0,v=2.1)
code("Ticket prüfen","const b=$json.body,u=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;return b&&Object.keys(b).length===2&&u.test(b.id)&&u.test(b.ticket)?[{json:{id:b.id,ticket:b.ticket}}]:[];",220)
rpc("Eigene Datei prüfen","take","$json",440)
cond("Auftrag verfügbar?","={{ $json.ok === true && $json.can_publish === false }}",660)
cond("Synthetischer Prüflauf?","={{ $json.probe === true }}",770)
for i,name in enumerate(["Kundenordner zuordnen","Ordner prüfen","Dateimetadaten lesen","Dateistand prüfen","Originaldatei laden"]):
    reused(source_nodes,name,880+i*220)
code("Tonspur prüfen",source_utils+"\n"+mux+"""
const bytes=await this.helpers.getBinaryDataBuffer(0,'data');
const checked=editorSourceBytes(bytes,$('Eigene Datei prüfen').first().json,$('Dateistand prüfen').first().json);
let state;
try{state=inspectVideo(bytes).state;}catch(e){if(e.message!=='BACKGROUND_UNSUPPORTED')throw e;state='fallback';}
return [{json:{state,...(state==='silent'?{source:checked.data_base64}:{})}}];""",1980)
cond("Musik benötigt?","={{ $json.state === 'silent' }}",2200)
bound="{id:"+ctx+".id,lease:"+ctx+".lease}"
rpc("Tonentscheidung speichern","audio_present",bound,2640,280)
rpc("Browser übernehmen lassen","fallback",bound,2640,500)
cond("Ton vorhanden?","={{ $json.state === 'audio_present' }}",2420)
node("SMA-Musik laden","httpRequest",{"url":"={{ 'https://bnvnmdxosbnuzedokqgh.supabase.co/storage/v1/object/authenticated/sma-katalog/' + "+ctx+".audio_path }}","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","options":{**opts,"response":{"response":{"responseFormat":"file"}}}},2420,-120,v=4.5,credentials=cred)
code("Musikfassung erstellen",mux+"""
const {createHash}=require('crypto'),sum=b=>createHash('sha256').update(b).digest('hex');
const a=await this.helpers.getBinaryDataBuffer(0,'data'),c=$('Eigene Datei prüfen').first().json;
if(!c.audio_path.endsWith('/'+sum(a)+'.aac'))throw Error('MUSIC_CHANGED');
let r;try{r=soundtrackMP4(Buffer.from($('Tonspur prüfen').first().json.source,'base64'),a);}catch(e){if(e.message==='BACKGROUND_UNSUPPORTED')return [{json:{fallback:true}}];throw e;}
if(r.state!=='rendered')throw Error('RENDER_FAILED');
return [{json:{sha256:sum(r.bytes),size_bytes:r.bytes.length},binary:{data:await this.helpers.prepareBinaryData(r.bytes,'music.mp4','video/mp4')}}];""",2640,-120)
cond("Fassung bereit?","={{ !!$json.sha256 }}",2860)
reused(source_nodes,"Dateistand erneut lesen",3080)
code("Quelle erneut prüfen",source_utils+"\nconst after=editorSourceMetadata($json,$('Eigene Datei prüfen').first().json,$('Ordner prüfen').first().json.folders);if(JSON.stringify(after)!==JSON.stringify($('Dateistand prüfen').first().json))throw Error('FILE_CHANGED');return [{json:{ok:true}}];",3300)
rpc("Upload reservieren","reserve",bound[:-1]+",sha256:$('Musikfassung erstellen').first().json.sha256,size_bytes:$('Musikfassung erstellen').first().json.size_bytes}",3520)
code("Schreibrecht prüfen","if(!$json.ok||$json.can_publish!==false)throw Error('UPLOAD_UNAVAILABLE');return $json.status==='completed'?[]:$input.all();",3740)
reused(upload_nodes,"Entwurfsordner prüfen",4180)
table=upload_nodes["Kundenordner zuordnen"]
node("Zielkonto erneut lesen","dataTable",table["parameters"],3960,v=table["typeVersion"],alwaysOutputData=True)
cond("Neuer Upload?","={{ $('Upload reservieren').first().json.initialize === true }}",4400)
for i,name in enumerate(["Zielordner lesen","Schreibziel bestätigen","Datei-ID reservieren","Datei-ID prüfen","Übertragung vorbereiten","Sitzung binden","Uploadsitzung speichern"]):
    reused(upload_nodes,name,4620+i*220,-160)
code("Uploadziel binden",utils+"""
const u=$('Upload reservieren').first().json,d=$('Entwurfsordner prüfen').first().json.folder_id;
if($json.ok!==true||u.initialize!==true&&u.folder_id!==d)throw Error('FOLDER_UNAVAILABLE');
const target=checkedUploadURL(u.initialize?$json.upload_url:u.upload_url);
const driveId=u.initialize?$('Datei-ID prüfen').first().json.drive_file_id:u.drive_file_id;
if(!/^[A-Za-z0-9_-]{10,200}$/.test(driveId))throw Error('UPLOAD_UNAVAILABLE');
return [{json:{target,drive_file_id:driveId,folder_id:d}}];""",6160)
rpc("Übertragung bestätigen","check",bound,6380)
code("Kontoprüfung bestätigen","if($json.ok!==true||$json.asset_revision!==$('Eigene Datei prüfen').first().json.asset_revision)throw Error('FILE_CHANGED');return $input.all();",6490)
node("Übertragungsstand lesen","httpRequest",{"method":"PUT","url":"={{ $('Uploadziel binden').first().json.target }}","sendHeaders":True,
    "headerParameters":{"parameters":[{"name":"Content-Range","value":"={{ 'bytes */'+$('Musikfassung erstellen').first().json.size_bytes }}"},{"name":"Content-Length","value":"0"}]},
    "options":{**opts,"response":{"response":{"fullResponse":True,"neverError":True,"responseFormat":"text"}}}},6540,v=4.5)
code("Restliche Bytes bestimmen","""
const n=$('Musikfassung erstellen').first().json.size_bytes;
if([200,201,404,410].includes($json.statusCode))return [{json:{verify:true}}];
if($json.statusCode!==308)throw Error('UPLOAD_UNAVAILABLE');
const range=$json.headers?.range;
if(range!==undefined&&!/^bytes=0-[0-9]+$/.test(range))throw Error('UPLOAD_INCOMPLETE');
const offset=range===undefined?0:Number(range.slice(8))+1;
if(!Number.isSafeInteger(offset)||offset<0||offset>=n)throw Error('UPLOAD_INCOMPLETE');
return [{json:{offset},binary:$('Musikfassung erstellen').first().binary}];""",6560)
cond("Bytes benötigt?","={{ $json.verify !== true }}",6580)
code("Bytes übernehmen","""
const offset=$json.offset,source=await this.helpers.getBinaryDataBuffer(0,'data');
const u=$('Uploadziel binden').first().json;
return [{json:{...u,range:'bytes '+offset+'-'+(source.length-1)+'/'+source.length},
 binary:{data:offset===0?$input.first().binary.data:await this.helpers.prepareBinaryData(source.subarray(offset),'music.mp4','video/mp4')}}];""",6600)
node("Musikfassung übertragen","httpRequest",{"method":"PUT","url":"={{ $json.target }}","sendHeaders":True,"headerParameters":{"parameters":[{"name":"Content-Type","value":"video/mp4"},{"name":"Content-Range","value":"={{ $json.range }}"}]},"sendBody":True,"contentType":"binaryData","inputDataFieldName":"data","options":{**opts,"timeout":150000,"response":{"response":{"neverError":True,"responseFormat":"text"}}}},6820,v=4.5,onError="continueRegularOutput")
check=reused(upload_nodes,"Hochgeladene Datei prüfen",7040)
check["parameters"]["url"]="={{ 'https://www.googleapis.com/drive/v3/files/'+$('Uploadziel binden').first().json.drive_file_id }}"
code("Datei zuordnen",core+"\n"+utils+"""
const u=$('Upload reservieren').first().json,b=$('Uploadziel binden').first().json;
const f=uploadedFile($json,{...u,...b},b.folder_id);
if(f.revision.split(':')[1]!==$('Musikfassung erstellen').first().json.sha256)throw Error('UPLOAD_INCOMPLETE');
return [{json:{p_id:u.upload_id,p_file:f}}];""",7260)
reused(upload_nodes,"Upload abschließen",7480)
code("Speicherung prüfen","if(!$json.ok||$json.status!=='completed'||$json.can_publish!==false)throw Error('UPLOAD_INCOMPLETE');return [{json:{status:'completed',can_publish:false}}];",7700)
chain("Galerieauftrag","Ticket prüfen","Eigene Datei prüfen","Auftrag verfügbar?","Synthetischer Prüflauf?")
edge("Synthetischer Prüflauf?","Kundenordner zuordnen",1)
chain("Kundenordner zuordnen","Ordner prüfen","Dateimetadaten lesen","Dateistand prüfen","Originaldatei laden","Tonspur prüfen","Musik benötigt?","SMA-Musik laden","Musikfassung erstellen","Fassung bereit?","Dateistand erneut lesen","Quelle erneut prüfen","Upload reservieren","Schreibrecht prüfen","Zielkonto erneut lesen","Entwurfsordner prüfen","Neuer Upload?","Zielordner lesen","Schreibziel bestätigen","Datei-ID reservieren","Datei-ID prüfen","Übertragung vorbereiten","Sitzung binden","Uploadsitzung speichern","Uploadziel binden","Übertragung bestätigen","Kontoprüfung bestätigen","Übertragungsstand lesen","Restliche Bytes bestimmen","Bytes benötigt?","Bytes übernehmen","Musikfassung übertragen","Hochgeladene Datei prüfen","Datei zuordnen","Upload abschließen","Speicherung prüfen")
edge("Bytes benötigt?","Hochgeladene Datei prüfen",1)
edge("Musik benötigt?","Ton vorhanden?",1);edge("Ton vorhanden?","Tonentscheidung speichern");edge("Ton vorhanden?","Browser übernehmen lassen",1)
edge("Fassung bereit?","Browser übernehmen lassen",1)
code("Bestehende Sitzung prüfen","const u=$('Upload reservieren').first().json;if(!u.ok||u.status!=='ready')throw Error('UPLOAD_UNAVAILABLE');return [{json:u}];",4620,160)
edge("Neuer Upload?","Bestehende Sitzung prüfen",1);edge("Bestehende Sitzung prüfen","Uploadziel binden")
# A manual private proof runs the same muxer, without customer input or destination.
fixture=(root/"fixtures/gallery-music-probe.json").read_text()
node("Isolierten Tontest starten","manualTrigger",{},0,520,v=1)
code("Testmusik und Videospur prüfen",mux+"\nconst fixture="+fixture+""";
const {createHash}=require('crypto'),v=Buffer.from(fixture.video,'base64'),a=Buffer.from(fixture.audio,'base64');
const out=soundtrackMP4(v,a),digest=createHash('sha256').update(out.bytes).digest('hex');
if(digest!==fixture.expected||inspectVideo(out.bytes).state!=='audio_present')throw Error('PROBE_FAILED');
return [{json:{ok:true,video:'1 Sekunde',audio:'AAC',sha256:digest,can_publish:false}}];""",220,520)
edge("Isolierten Tontest starten","Testmusik und Videospur prüfen")
edge("Synthetischer Prüflauf?","Testmusik und Videospur prüfen")
cond("Prüfbeleg angefordert?","={{ $('Eigene Datei prüfen').isExecuted && $('Eigene Datei prüfen').first().json.probe === true }}",440)
edge("Testmusik und Videospur prüfen","Prüfbeleg angefordert?")
rpc("Prüfbeleg speichern","probe_receipt","{id:"+ctx+".id,receipt:"+ctx+".receipt,sha256:$json.sha256}",660,520)
edge("Prüfbeleg angefordert?","Prüfbeleg speichern")
settings={"executionOrder":"v1","binaryMode":"separate","timeSavedMode":"fixed","saveDataErrorExecution":"none",
          "callerPolicy":"workflowsFromSameOwner","availableInMCP":False,"saveDataSuccessExecution":"none"}
w={"name":"SMA – Galerie – Automatische Vertonung V1","nodes":nodes,"connections":connections,"pinData":{},"settings":settings}
(root/"gallery-soundtrack-workflow.json").write_text(json.dumps(w,ensure_ascii=False,indent=2)+"\n")
