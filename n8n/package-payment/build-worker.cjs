const {randomUUID} = require('node:crypto');
const {readFileSync,writeFileSync} = require('node:fs');

// Take credential references and the table reference from the installed customer assistant.
function build(source,{renewalOnly=false}={}){
  const get=name=>{
    const n=source.nodes.find(n=>n.name===name);
    if(!n)throw Error('Quellknoten fehlt: '+name);
    return n;
  };
  const merchant=get('SMA – Mollie – Erste Zahlung erstellen').credentials;
  const database=get('SMA – Supabase – Bestellung spiegeln').credentials;
  const table=get('SMA – Paketauswahl – Kunde prüfen').parameters.dataTableId;
  if(!merchant?.httpHeaderAuth?.id||!database?.httpHeaderAuth?.id||!table?.value)throw Error('Verbindungsreferenz fehlt.');
  const nodes=[],connections={};
  function node(name,type,typeVersion,parameters,x,y,extra={}){
    nodes.push({name,type:'n8n-nodes-base.'+type,typeVersion,parameters,id:randomUUID(),position:[x,y],...extra});return name;
  }
  function edge(a,b,port=0){
    const outputs=(connections[a]??={main:[]}).main;
    while(outputs.length<=port)outputs.push([]);
    outputs[port].push({node:b,type:'main',index:0});
  }
  const webhook=node('Zahlungsdienst','webhook',2.1,{httpMethod:'POST',path:'sma-paket-dienst-v1',responseMode:'responseNode',options:{}},0,0,{webhookId:randomUUID()});
  const check=node('Auftragsschlüssel prüfen','code',2,{jsCode:"const ticket=$json.body?.ticket;if(typeof ticket!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(ticket))throw Error('INVALID');return [{json:{ticket}}];"},220,0);
  const options={timeout:12000,redirect:{redirect:{followRedirects:false}}};
  const claim=node('Einmalauftrag abrufen','httpRequest',4.5,{method:'POST',url:'https://bnvnmdxosbnuzedokqgh.supabase.co/rest/v1/rpc/sma_package_ticket_v1',
    authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:'={{ {p_id:$json.ticket} }}',options},440,0,{credentials:database});
  const routes=['lookup','customer','first','payment','subscribe','subscription','account','activate','disable'];
  const split=node('Vorgang auswählen','switch',3.4,{rules:{values:routes.map(op=>({renameOutput:true,outputKey:op,conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:3},conditions:[{id:randomUUID(),leftValue:'={{ $json.op }}',rightValue:op,operator:{type:'string',operation:'equals'}}],combinator:'and'}}))},options:{fallbackOutput:'extra'}},660,0);
  const answer=node('Antwort','respondToWebhook',1.5,{respondWith:'json',responseBody:'={{ $json }}',options:{responseHeaders:{entries:[{name:'Cache-Control',value:'no-store'}]}}},1550,0);
  edge(webhook,check);edge(check,claim);edge(claim,split);
  const short=node('Antwort begrenzen','code',2,{jsCode:`const op=$('Einmalauftrag abrufen').first().json.op;
const r=$input.first()?.json||{};
if(op==='account'){
 if($input.all().length!==1||!Number.isSafeInteger(r.id))return [{json:{ok:false}}];
 const vals={};for(const k of ['id','kunde_id','kunde_email','paket','mollie_customer_id','mollie_subscription_id','zugang_aktiv','zahlung_bestaetigt','demo_delta_aktiv'])vals[k]=r[k]??null;
 vals.has_access_token=typeof r.zugangs_token==='string'&&r.zugangs_token.length>0;
 return [{json:{ok:true,value:vals}}];
}
if(op==='activate'||op==='disable')return [{json:{ok:true,value:{}}}];
const vals={};for(const k of ['id','metadata','email','mode','sequenceType','customerId','amount','status','interval','startDate','nextPaymentDate','paidAt','expiresAt','amountRefunded','amountChargedBack'])if(k in r)vals[k]=r[k];
if(r._links?.checkout?.href)vals._links={checkout:{href:r._links.checkout.href}};
return [{json:{ok:true,value:vals}}];`},1330,0);
  edge(short,answer);
  const fail=node('Unbekannter Auftrag','code',2,{jsCode:'return [{json:{ok:false}}];'},1060,880);
  const health=node('Verbindung bestätigt','code',2,{jsCode:'return [{json:{ok:true,value:{version:1}}}];'},1060,-700);
  edge(split,fail,routes.length);edge(fail,answer);edge(split,health,0);edge(health,answer);
  for(const [i,op] of routes.entries()){
    if(op==='lookup')continue;
    const d='$json.data';const getPath={
      customer:"'/customers'",first:"'/payments'",payment:"'/payments/'+encodeURIComponent("+d+".payment)",
      subscribe:"'/customers/'+encodeURIComponent("+d+".customer)+'/subscriptions'",
      subscription:"'/customers/'+encodeURIComponent("+d+".customer)+'/subscriptions/'+encodeURIComponent("+d+".subscription)"
    };
    let n;
    if(Object.hasOwn(getPath,op)){
      const post=['customer','first','subscribe'].includes(op);
      const params={method:post?'POST':'GET',url:"={{ 'https://api.mollie.com/v2'+"+getPath[op]+' }}',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',options};
      if(post)Object.assign(params,{sendHeaders:true,headerParameters:{parameters:[{name:'Idempotency-Key',value:"={{ '"+op+"-'+$json.data.order }}"}]},
        sendBody:true,specifyBody:'json',jsonBody:op==='customer'?'={{ {name:$json.data.ref,email:$json.data.email,metadata:{order:$json.data.order}} }}':'={{ $json.data.body }}'});
      n=node('Mollie '+op,'httpRequest',4.5,params,1060,(i-4)*165,{credentials:merchant});
    }else{
      const vals={id:'row',kunde_id:'ref',kunde_email:'email'};
      if(op==='disable')Object.assign(vals,{paket:'plan',mollie_customer_id:'customer',mollie_subscription_id:'subscription'});
      const filters={conditions:Object.entries(vals).map(([keyName,v])=>({keyName,keyValue:'={{ $json.data.'+v+' }}'}))};
      let params={operation:op==='account'?'get':'update',dataTableId:table,matchType:'allConditions',filters};
      if(op!=='account'){
        filters.conditions.push({keyName:'demo_delta_aktiv',condition:'isFalse'},{keyName:'zugang_aktiv',condition:op==='activate'?'isFalse':'isTrue'},{keyName:'zahlung_bestaetigt',condition:op==='activate'?'isFalse':'isTrue'});
        if(op==='activate')for(const keyName of ['paket','mollie_customer_id','mollie_subscription_id','zugangs_token'])filters.conditions.push({keyName,condition:'isEmpty'});
        params.columns={mappingMode:'defineBelow',value:op==='activate'?{paket:'={{ $json.data.plan }}',mollie_customer_id:'={{ $json.data.customer }}',mollie_subscription_id:'={{ $json.data.subscription }}',
          zugang_aktiv:true,zahlung_bestaetigt:true,zugangs_token:'={{ $json.data.token }}'}:{zugang_aktiv:false,zahlung_bestaetigt:false},matchingColumns:[],schema:[],attemptToConvertTypes:false,convertFieldsToString:false};
        params.options={};
      }else params.limit=2;
      n=node('Kundenzeile '+op,'dataTable',1.1,params,1060,(i-4)*165,{alwaysOutputData:true});
    }
    edge(split,n,i);edge(n,short);
  }
  const originalCount=nodes.length;
  const start=node('Folgeabgleich','webhook',2.1,{httpMethod:'POST',path:'sma-paket-folge-dienst-v1',responseMode:'responseNode',options:{}},0,1400,{webhookId:randomUUID()});
  const validate=node('Folgeticket prüfen','code',2,getLocal(check).parameters,220,1400);
  const load=node('Folgeauftrag abrufen','httpRequest',4.5,getLocal(claim).parameters,440,1400,{credentials:database});
  const choices=structuredClone(getLocal(split).parameters);
  choices.rules.values=choices.rules.values.slice(0,2);
  ['renewals','restore'].forEach((op,i)=>{
    const rule=choices.rules.values[i];rule.outputKey=op;rule.conditions.conditions[0].rightValue=op;
  });
  const route=node('Folgeauftrag auswählen','switch',3.4,choices,660,1400);
  const url="={{ 'https://api.mollie.com/v2/customers/'+encodeURIComponent($json.data.customer)+'/subscriptions/'+encodeURIComponent($json.data.subscription)+'/payments?limit=50'+($json.data.cursor?'&from='+encodeURIComponent($json.data.cursor):'') }}";
  const list=node('Mollie Abozahlungen lesen','httpRequest',4.5,{...getLocal('Mollie subscription').parameters,url},900,1270,{credentials:merchant});
  const params=structuredClone(getLocal('Kundenzeile disable').parameters);
  for(const f of params.filters.conditions)if(['zugang_aktiv','zahlung_bestaetigt'].includes(f.keyName))f.condition='isFalse';
  params.filters.conditions.push({keyName:'zugangs_token',condition:'isNotEmpty'});
  params.columns.value={zugang_aktiv:true,zahlung_bestaetigt:true};
  const restore=node('Bestehenden Zugang fortsetzen','dataTable',1.1,params,900,1450,{alwaysOutputData:true});
  const small=node('Folgebelege begrenzen','code',2,{jsCode:`const r=$input.first().json;
const job=$('Folgeauftrag abrufen').first().json;
if(job.op==='restore')return [{json:{ok:true,value:{}}}];
const items=r._embedded?.payments;
if(!Array.isArray(items)||items.length!==r.count||items.length>50||!r._links)return [{json:{ok:false}}];
let next=null;
if(r._links.next!=null){
 const href=r._links.next.href;
 const prefix='https://api.mollie.com/v2/customers/'+job.data.customer+'/subscriptions/'+job.data.subscription+'/payments?';
 if(typeof href!=='string'||!href.startsWith(prefix))return [{json:{ok:false}}];
 next=href.slice(prefix.length).split('&').find(v=>v.startsWith('from='))?.slice(5);
 if(!next||!/^tr_[A-Za-z0-9]{1,64}$/.test(next))return [{json:{ok:false}}];
}
const payments=items.map(item=>{
 const out={};for(const k of ['id','mode','customerId','subscriptionId','sequenceType','amount','status','createdAt','paidAt','amountRefunded','amountChargedBack'])if(k in item)out[k]=item[k];
 if(item.metadata && typeof item.metadata==='object'){out.metadata={};for(const k of ['order','kunde_id','paket'])if(k in item.metadata)out.metadata[k]=item.metadata[k];}
 return out;
});
return [{json:{ok:true,value:{payments,next}}}];`},1140,1320);
  const invalid=node('Folgeauftrag unbekannt','code',2,getLocal(fail).parameters,900,1620);
  const reply=node('Folgeabgleich antworten','respondToWebhook',1.5,getLocal(answer).parameters,1380,1400);
  edge(start,validate);edge(validate,load);edge(load,route);edge(route,list);edge(route,restore,1);edge(route,invalid,2);
  edge(list,small);edge(restore,small);edge(small,reply);edge(invalid,reply);
  function getLocal(name){return nodes.find(n=>n.name===name);}
  if(renewalOnly){
    const added=nodes.slice(originalCount);
    return {nodes:added,connections:Object.fromEntries(added.filter(n=>connections[n.name]).map(n=>[n.name,connections[n.name]]))};
  }
  return {name:'SMA – Paketbuchung – Zahlungsdienst V1',nodes,connections,settings:{executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,saveExecutionProgress:false,executionTimeout:90,availableInMCP:false,callerPolicy:'workflowsFromSameOwner'}};
}
module.exports={build};
if(require.main===module){
  const source=JSON.parse(readFileSync(process.argv[2],'utf8'));
  writeFileSync(process.argv[3],JSON.stringify(build(Array.isArray(source)?source[0]:source)),{mode:0o600});
}
