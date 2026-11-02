"""Build a separate n8n Cloud photo-analysis workflow using existing credentials."""
import json,uuid
from pathlib import Path
root=Path('n8n/publishing')
w=json.loads((root/'content-review-workflow.json').read_text())
# Same authenticated file-reservation/download/verify/recheck pattern; independent analysis/cache.
raw=json.dumps(w,ensure_ascii=False).replace('sma-publication-content-review-v1','sma-publication-magic-effect-v1').replace('sma_publication_review_','sma_publication_magic_').replace('REVIEW_','MAGIC_').replace('VIDEO_PLAN_REQUIRED','MAGIC_PHOTO_REQUIRED')
w=json.loads(raw)
w['name']='SMA – Magic Effect – Fotoerkennung V1'
w['active']=False;w['pinData']={}
core=(root/'content-review.cjs').read_text().split('module.exports=')[0]
magic=(root/'magic-effect.cjs').read_text().split('module.exports=')[0].replace("const {verifyBytes}=require('./content-review.cjs');",'')
for n in w['nodes']:
 n['id']=str(uuid.uuid4())
 if 'webhookId' in n:n['webhookId']=str(uuid.uuid4())
 if n['name']=='Antwort vorbereiten':
  n['parameters']['jsCode']=n['parameters']['jsCode'].replace('review:r.ok===true?r.review','analysis:r.ok===true?r.analysis')
 if n['name']=='Prüfantwort':
  n['parameters']['responseBody']=n['parameters']['responseBody'].replace('review:$json.review','analysis:$json.analysis')
 if n['name']=='Dateiinhalt binden':
  n['parameters']['jsCode']=(core+'\n'+magic).replace("'use strict';",'')+"\nconst f=$('Dateistand prüfen').first().json;const bytes=await this.helpers.getBinaryDataBuffer(0,'data');return [{json:magicRequest(bytes,f,$('Prüfung reservieren').first().json)}];"
 if n['name']=='Sichtprüfung ausführen':
  n['parameters']={'method':'POST','url':'https://api.openai.com/v1/responses','authentication':'predefinedCredentialType','nodeCredentialType':'openAiApi','sendBody':True,'specifyBody':'json','jsonBody':'={{ $json.request }}','options':{'timeout':85000,'redirect':{'redirect':{'followRedirects':False}}}}
  n['credentials']={'openAiApi':{'id':'yjrYph78fR5JjBW3','name':'OpenAI account'}}
 if n['name']=='Prüfergebnis auswerten':
  n['parameters']['jsCode']=magic+"\nreturn [{json:{result:magicResult($input.first().json),sha256:$('Dateiinhalt binden').first().json.sha256}}];"
 if n['name']=='Prüffehler zuordnen':
  n['parameters']['jsCode']=n['parameters']['jsCode'].replace("'PROVIDER_FAILED'","'MAGIC_REFUSED','MAGIC_INVALID_RESULT','MAGIC_CONTEXT_INVALID','MODEL_FAILED'")
# The catalog helper import is inlined; validation needs no provider function.
names={'Inhalt prüfen':'Magic Effect anfordern','Prüfung reservieren':'Fotoerkennung reservieren','Prüfantwort':'Erkennungsauftrag bestätigen','Neue Prüfung?':'Neue Fotoerkennung?','Sichtprüfung ausführen':'Foto mit OpenAI erkennen','Prüfergebnis auswerten':'Erkannten Inhalt prüfen','Prüfergebnis speichern':'Fotoerkennung speichern','Prüffehler zuordnen':'Erkennungsfehler zuordnen','Prüffehler speichern':'Erkennungsfehler speichern'}
raw=json.dumps(w,ensure_ascii=False)
for before,after in names.items():raw=raw.replace(before,after)
w=json.loads(raw)
check={'id':str(uuid.uuid4()),'name':'Speicherung bestätigen','type':'n8n-nodes-base.code','typeVersion':2,'position':[3960,0],'parameters':{'jsCode':"if($input.first().json.ok!==true)throw Error('MAGIC_INVALID_RESULT');return [{json:{ok:true}}];"},'onError':'continueErrorOutput'}
w['nodes'].append(check)
w['connections']['Fotoerkennung speichern']['main'][0]=[{'node':'Speicherung bestätigen','type':'main','index':0}]
w['connections']['Speicherung bestätigen']={'main':[[],[{'node':'Erkennungsfehler zuordnen','type':'main','index':0}]]}
previous_path=root/'magic-effect-workflow.json'
if previous_path.exists():
 previous=json.loads(previous_path.read_text());by_name={n['name']:n for n in previous['nodes']}
 for n in w['nodes']:
  for k in ['id','webhookId','position']:
   if k in by_name.get(n['name'],{}):n[k]=by_name[n['name']][k]
if previous_path.exists():
 for k,v in previous.get('settings',{}).items():
  if k not in w['settings']:w['settings'][k]=v
previous_path.write_text(json.dumps(w,ensure_ascii=False,indent=2)+'\n')
print(len(w['nodes']),'nodes; existing OpenAI, Google Drive and Supabase credential refs only')
