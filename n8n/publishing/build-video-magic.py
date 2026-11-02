"""Authenticated async video Magic Effect, reusing the verified private evidence pipeline."""
import copy,json,subprocess,sys,tempfile,uuid
from pathlib import Path
root=Path(__file__).parent
with tempfile.TemporaryDirectory() as tmp:
 fixture=Path(tmp)/'context.json';fixture.write_text('{}')
 output=Path(tmp)/'probe.json'
 subprocess.run([sys.executable,str(root/'build-video-evidence-probe.py'),'--fixture',str(fixture),'--output',str(output)],check=True)
 probe=json.loads(output.read_text())
photo=json.loads((root/'magic-effect-workflow.json').read_text())
photo=json.loads(json.dumps(photo,ensure_ascii=False).replace('sma_publication_magic_','sma_publication_video_magic_').replace('sma-publication-magic-effect-v1','sma-publication-video-magic-effect-v1').replace('Fotoerkennung','Videoerkennung').replace('MAGIC_PHOTO_REQUIRED','VIDEO_UNSUPPORTED'))
byname={n['name']:n for n in photo['nodes']}
prefix=['Magic Effect anfordern','Anfrage prüfen','Anmeldung vorhanden?','Videoerkennung reservieren','Antwort vorbereiten','Erkennungsauftrag bestätigen','Neue Videoerkennung?','Kundenordner zuordnen','Ordner prüfen']
nodes=[copy.deepcopy(byname[n]) for n in prefix]
connections={k:copy.deepcopy(v) for k,v in photo['connections'].items() if k in prefix}
lib=(root/'video-evidence.cjs').read_text().split('module.exports=')[0].replace("'use strict';",'')
magic=(root/'video-magic.cjs').read_text().split('module.exports=')[0].replace("const {checkedDriveRevision,evidenceManifest}=require('./video-evidence.cjs');",'').replace("'use strict';",'')
def code(name,source):
 return {'name':name,'type':'n8n-nodes-base.code','typeVersion':2,'parameters':{'jsCode':lib+'\n'+magic+'\n'+source}}
nodes.append(copy.deepcopy(byname['Dateistand lesen']))
nodes.append(code('Dateistand prüfen',"return [{json:videoFile($input.first().json,$('Videoerkennung reservieren').first().json,$('Ordner prüfen').first().json.folders)}];"))
pipeline=[]
for n in probe['nodes']:
 if n['name'] in ['Manueller Videotest','Ausgewählte Testdatei','Dateistand lesen','Dateistand prüfen','Dateistand erneut lesen','Dateistand bestätigen','Prüfergebnis']:continue
 n=copy.deepcopy(n)
 n=json.loads(json.dumps(n,ensure_ascii=False).replace("$('Ausgewählte Testdatei')","$('Videoerkennung reservieren')"))
 if n['name']=='Transkript prüfen':n=code(n['name'],"return [{json:videoTranscript($input.first().json)}];")
 if n['name']=='Erkennung vorbereiten':
  original=n['parameters']['jsCode'][len(lib)+1:]
  n=code(n['name'],"const prepared=(()=>{"+original+"})();return [{json:videoRecognitionRequest(prepared[0].json)}];")
 if n['name']=='Inhaltsabgleich vorbereiten':n=code(n['name'],"return [{json:{request:reviewRequest($input.first().json,$('Erkennung vorbereiten').first().json,videoRecognitionResult)}}];")
 if n['name']=='Videoergebnis prüfen':n=code(n['name'],"return [{json:{result:videoMagicResult($input.first().json,$('Erkennung vorbereiten').first().json.evidence,$('Videobytes binden').first().json),sha256:$('Videobytes binden').first().json.sha256}}];")
 pipeline.append(n)
nodes+=pipeline
nodes.append(code('Entfernung bestätigen',"containerDeleted($input.first().json,$('Privaten Arbeitsbereich erstellen').first().json.id);return [{json:{ok:true}}];"))
again=copy.deepcopy(byname['Kundenordner zuordnen']);again['name']='Kundenordner erneut zuordnen';nodes.append(again)
again=copy.deepcopy(byname['Ordner prüfen']);again['name']='Ordner erneut prüfen';nodes.append(again)
nodes.append(copy.deepcopy(byname['Dateistand erneut lesen']))
nodes.append(code('Unverändertes Video bestätigen',"videoFile($input.first().json,$('Videoerkennung reservieren').first().json,$('Ordner erneut prüfen').first().json.folders);const c=$('Videoerkennung reservieren').first().json,r=$('Videoergebnis prüfen').first().json;return [{json:{p_asset_id:c.asset_id,p_lease_id:c.lease_id,p_result:r.result,p_sha256:r.sha256}}];"))
nodes.append(copy.deepcopy(byname['Videoerkennung speichern']))
nodes.append(copy.deepcopy(byname['Speicherung bestätigen']))
def edge(a,b,port=0):
 slots=connections.setdefault(a,{'main':[]})['main']
 while len(slots)<=port:slots.append([])
 slots[port].append({'node':b,'type':'main','index':0})
chain=['Dateistand lesen','Dateistand prüfen']+[n['name'] for n in pipeline]+['Entfernung bestätigen','Kundenordner erneut zuordnen','Ordner erneut prüfen','Dateistand erneut lesen','Unverändertes Video bestätigen','Videoerkennung speichern','Speicherung bestätigen']
for a,b in zip(chain,chain[1:]):
 if a not in ['Transkript prüfen','Ohne Tonspur fortsetzen']:edge(a,b)
edge('Tonspur vorhanden?','Ohne Tonspur fortsetzen',1)
edge('Transkript prüfen','Erkennung vorbereiten');edge('Ohne Tonspur fortsetzen','Erkennung vorbereiten')
# Every post-reservation error takes a bounded best-effort cleanup path. There is
# no provider body/error text in stored failures, and no arbitrary deletion URL.
nodes.append(code('Videoanalysefehler zuordnen',"const c=$('Videoerkennung reservieren').first().json;const r=$input.first().json;const msg=String(r.message||r.error?.message||r.error||'');const codes=['FOLDER_UNAVAILABLE','FILE_CHANGED','CHECKSUM_REQUIRED','VIDEO_UNSUPPORTED','TRANSCRIPT_INVALID','VIDEO_RECOGNITION_INVALID','VIDEO_RECOGNITION_FAILED','VIDEO_EVIDENCE_INVALID','VIDEO_EXTRACTION_UNVERIFIED','VIDEO_CLEANUP_UNVERIFIED'];let id=null;try{id=containerId($('Privaten Arbeitsbereich erstellen').first().json.id);}catch{}return [{json:{container_id:id,error_body:{p_asset_id:c.asset_id,p_lease_id:c.lease_id,p_error:codes.find(x=>msg.includes(x))||'MAGIC_UNAVAILABLE'}}}];"))
gate=copy.deepcopy(byname['Neue Videoerkennung?']);gate['name']='Arbeitsbereich vorhanden?';gate['parameters']['conditions']['conditions'][0]['leftValue']="={{ typeof $json.container_id === 'string' }}";nodes.append(gate)
cleanup=copy.deepcopy(next(n for n in pipeline if n['name']=='Arbeitsbereich entfernen'))
cleanup['name']='Arbeitsbereich bei Fehler entfernen';cleanup['parameters']['url']="={{ 'https://api.openai.com/v1/containers/'+$('Videoanalysefehler zuordnen').first().json.container_id }}";cleanup['onError']='continueRegularOutput';nodes.append(cleanup)
nodes.append(code('Fehlerbericht vorbereiten',"return [{json:$('Videoanalysefehler zuordnen').first().json.error_body}];"))
nodes.append(copy.deepcopy(byname['Erkennungsfehler speichern']))
edge('Videoanalysefehler zuordnen','Arbeitsbereich vorhanden?');edge('Arbeitsbereich vorhanden?','Arbeitsbereich bei Fehler entfernen');edge('Arbeitsbereich vorhanden?','Fehlerbericht vorbereiten',1);edge('Arbeitsbereich bei Fehler entfernen','Fehlerbericht vorbereiten');edge('Fehlerbericht vorbereiten','Erkennungsfehler speichern')
protected=set(prefix[:7]+['Videoanalysefehler zuordnen','Arbeitsbereich vorhanden?','Arbeitsbereich bei Fehler entfernen','Fehlerbericht vorbereiten','Erkennungsfehler speichern'])
for i,n in enumerate(nodes):
 n['id']=str(uuid.uuid5(uuid.NAMESPACE_URL,'sma-video-magic/'+n['name']));n['position']=[(i%12)*240,(i//12)*260]
 if 'webhookId' in n:n['webhookId']=str(uuid.uuid5(uuid.NAMESPACE_URL,'sma-video-magic-webhook'))
 if n['name'] not in protected:
  n['onError']='continueErrorOutput'
  connections.setdefault(n['name'],{'main':[[]]})['main']=connections.get(n['name'],{'main':[[]]})['main'][:1]
  edge(n['name'],'Videoanalysefehler zuordnen',1)
# The IF's false output is a successful no-audio branch; its error output is 2.
connections['Tonspur vorhanden?']['main'][1]=[{'node':'Ohne Tonspur fortsetzen','type':'main','index':0}]
edge('Tonspur vorhanden?','Videoanalysefehler zuordnen',2)
w={'name':'SMA – Magic Effect – Videoanalyse V1','active':False,'pinData':{},'nodes':nodes,'connections':connections,
 'settings':{**photo['settings'],'executionTimeout':600}}
(root/'video-magic-workflow.json').write_text(json.dumps(w,ensure_ascii=False,indent=2)+'\n')
print(len(nodes),'authenticated video nodes generated')
