import json,uuid
from pathlib import Path
source=Path('n8n/publishing/build-file-catalog.py').read_text()
exec(source[:source.index("node('Dateien abgleichen'")].replace('file-catalog-workflow.json','asset-preview-workflow.json'))
preview=Path('n8n/publishing/asset-preview.cjs').read_text().split('module.exports=')[0]
node('Medienvorschau','webhook',{'httpMethod':'POST','path':'sma-publication-asset-preview-v1','responseMode':'responseNode','options':{'allowedOrigins':'https://sma-automation.com'}},0,v=2.1,webhookId=str(uuid.uuid4()))
code('Anfrage prüfen',preview+'\nreturn [{json:previewRequest($input.first().json)}];',220)
cond('Anfrage gültig?','={{ $json.ok === true }}',440)
node('Eigene Datei prüfen','httpRequest',{**http,'url':'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_publication_asset_preview_v1','sendHeaders':True,'headerParameters':{'parameters':[{'name':'apikey','value':'sb_publishable_WbdlBQv6f_p5G8SZ_CMEAw_tMxHHklW'},{'name':'Authorization','value':'={{ $json.auth }}'}]},'jsonBody':'={{ $json.input }}'},660,v=4.5,onError='continueErrorOutput')
cond('Datei verfügbar?','={{ $json.ok === true }}',880)
node('Kundenordner zuordnen','dataTable',{'operation':'get','dataTableId':{'__rl':True,'value':'oVIgtuR95fFUbMrN','mode':'list','cachedResultName':'SMA_Kunden'},'matchType':'allConditions','filters':{'conditions':[{'keyName':'kunde_id','keyValue':'={{ $json.n8n_kunde_id }}'},{'keyName':'kunde_email','keyValue':'={{ $json.kunde_email }}'},{'keyName':'zugang_aktiv','condition':'isTrue'}]},'limit':2},1100,v=1,alwaysOutputData=True,onError='continueErrorOutput')
code('Ordner prüfen',core+"\nreturn [{json:verifiedFolders($input.all().map(x=>x.json),$('Eigene Datei prüfen').first().json)}];",1320,onError='continueErrorOutput')
node('Dateimetadaten lesen','httpRequest',{'url':'={{ "https://www.googleapis.com/drive/v3/files/"+$("Eigene Datei prüfen").first().json.drive_file_id }}','authentication':'predefinedCredentialType','nodeCredentialType':'googleDriveOAuth2Api','sendQuery':True,'queryParameters':{'parameters':[{'name':'fields','value':'id,mimeType,parents,trashed,version,size,md5Checksum,sha256Checksum,thumbnailLink'},{'name':'supportsAllDrives','value':'true'}]},'options':opts},1540,v=4.5,credentials=drive,onError='continueErrorOutput')
code('Vorschaulink prüfen',preview+"\nreturn [{json:previewMetadata($input.first().json,$('Eigene Datei prüfen').first().json,$('Ordner prüfen').first().json.folders)}];",1760,onError='continueErrorOutput')
node('Vorschaubild laden','httpRequest',{'url':'={{ $json.url }}','authentication':'predefinedCredentialType','nodeCredentialType':'googleDriveOAuth2Api','options':{**opts,'response':{'response':{'responseFormat':'file'}}}},1980,v=4.5,credentials=drive,onError='continueErrorOutput')
code('Vorschaubild prüfen',preview.replace("'use strict';",'')+"\nconst bytes=await this.helpers.getBinaryDataBuffer(0,'data');return [{json:previewImage(bytes,$('Eigene Datei prüfen').first().json)}];",2200,onError='continueErrorOutput')
code('Vorschaufehler',"return [{json:{ok:false,code:'PREVIEW_UNAVAILABLE',can_publish:false}}];",2200,400)
code('Vorschauantwort bereinigen',"const r=$input.first().json;return [{json:r.ok===true?r:{ok:false,code:['AUTH_REQUIRED','INVALID_INPUT','FILE_UNAVAILABLE','FILE_CHANGED','ACCESS_INACTIVE','ACCOUNT_UNAVAILABLE','FOLDER_UNAVAILABLE'].includes(r.code)?r.code:'PREVIEW_UNAVAILABLE',can_publish:false}}];",2420)
node('Vorschauantwort','respondToWebhook',{'respondWith':'json','responseBody':'={{ $json }}','options':{'responseCode':200,'responseHeaders':{'entries':[{'name':'Cache-Control','value':'private, no-store'},{'name':'Access-Control-Allow-Origin','value':'https://sma-automation.com'},{'name':'Vary','value':'Origin'}]}}},2640,v=1.5)
chain=['Medienvorschau','Anfrage prüfen','Anfrage gültig?','Eigene Datei prüfen','Datei verfügbar?','Kundenordner zuordnen','Ordner prüfen','Dateimetadaten lesen','Vorschaulink prüfen','Vorschaubild laden','Vorschaubild prüfen','Vorschauantwort bereinigen','Vorschauantwort']
for a,b in zip(chain,chain[1:]):edge(a,b)
for a in ['Anfrage gültig?','Datei verfügbar?']:edge(a,'Vorschauantwort bereinigen',1)
for a in ['Eigene Datei prüfen','Kundenordner zuordnen','Ordner prüfen','Dateimetadaten lesen','Vorschaulink prüfen','Vorschaubild laden','Vorschaubild prüfen']:edge(a,'Vorschaufehler',1)
edge('Vorschaufehler','Vorschauantwort bereinigen')
w={'name':'SMA – Medienvorschau – Kundenordner V1','nodes':nodes,'connections':connections,'pinData':{},'settings':{'executionOrder':'v1','saveDataErrorExecution':'none','saveDataSuccessExecution':'none','saveManualExecutions':False,'saveExecutionProgress':False,'executionTimeout':120,'callerPolicy':'workflowsFromSameOwner','availableInMCP':False},'active':False}
Path('n8n/publishing/asset-preview-workflow.json').write_text(json.dumps(w,ensure_ascii=False,indent=2));print(len(nodes),'nodes')
