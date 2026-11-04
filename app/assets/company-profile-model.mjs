export const companyFields={
 company_name:{label:'Vollständiger Firmenname',max:100,group:'company',required:true,autocomplete:'organization'},
 legal_form:{label:'Rechtsform',max:60,group:'company'},industry:{label:'Branche',max:100,group:'company'},representative:{label:'Vertretungsberechtigte Person',max:120,group:'company'},
 street:{label:'Straße',max:120,group:'address',autocomplete:'address-line1'},house_number:{label:'Hausnummer / Zusatz',max:20,group:'address',autocomplete:'address-line2'},
 postal_code:{label:'Postleitzahl',max:20,group:'address',autocomplete:'postal-code'},city:{label:'Ort / Firmensitz',max:100,group:'address',autocomplete:'address-level2'},country:{label:'Land',max:80,group:'address',autocomplete:'country-name'},
 public_email:{label:'Öffentliche E-Mail-Adresse',max:254,group:'contact',type:'email'},phone:{label:'Öffentliche Telefonnummer',max:60,group:'contact',type:'tel',autocomplete:'tel'},
 contact_person:{label:'Öffentliche Ansprechperson',max:120,group:'contact'},opening_hours:{label:'Öffnungs- / Erreichbarkeitszeiten',max:1000,group:'contact',multiline:true},
 vat_id:{label:'UID / Umsatzsteuer-ID',max:40,group:'register'},register_number:{label:'Firmenbuch- / Handelsregisternummer',max:80,group:'register'},register_court:{label:'Registergericht',max:120,group:'register'}
};
const fail=code=>{throw Object.assign(new Error(code),{code});};
export const emptyCompanyProfile=()=>Object.fromEntries(Object.keys(companyFields).map(k=>[k,'']));
export function readCompanyProfile(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==Object.keys(companyFields).sort().join('|'))fail('INVALID_PROFILE');
 if(new TextEncoder().encode(JSON.stringify(value)).length>16000)fail('INVALID_PROFILE');
 const profile={};
 for(const [key,{max,multiline}] of Object.entries(companyFields)){
  const text=value[key];if(typeof text!=='string'||[...text].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)||!multiline&&/[\r\n]/.test(text))fail('INVALID_PROFILE');profile[key]=text;
 }
 if(!profile.company_name.trim()||profile.public_email&&!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(profile.public_email))fail('INVALID_PROFILE');
 return profile;
}
export function companyAddress(p){return [[p.street,p.house_number].filter(Boolean).join(' '),[p.postal_code,p.city].filter(Boolean).join(' '),p.country].filter(Boolean).join('\n');}
export function readCompanyState(r){
 if(r?.ok!==true)fail(r?.code||'UNAVAILABLE');
 if(!Number.isSafeInteger(r.revision)||r.revision<0||r.revision>2147483647||typeof r.can_edit!=='boolean'||(r.revision===0)!==(r.profile===null))fail('INVALID_RESPONSE');
 let suggested=null;
 if(r.suggested){suggested={};for(const [key,max] of [['company_name',100],['public_email',254],['phone',60],['previous_address',400]]){
  if(typeof r.suggested[key]!=='string'||[...r.suggested[key]].length>max)fail('INVALID_RESPONSE');suggested[key]=r.suggested[key];
 }}
 return {revision:r.revision,profile:r.profile?readCompanyProfile(r.profile):null,canEdit:r.can_edit,suggested};
}
export function createCompanyProfileClient({request,getOwnerId,uuid=()=>crypto.randomUUID()}){
 let owner=null,revision=0,pending=null,busy=false,epoch=0;
 async function run(action,value){if(busy)fail('BUSY');busy=true;const version=epoch;
  try{
   const uid=await getOwnerId();if(!uid||action==='save'&&uid!==owner)fail('AUTH_REQUIRED');let input={};
   if(action==='save'){
    const profile=readCompanyProfile(value),signature=JSON.stringify(profile);
    if(!pending||pending.signature!==signature)pending={signature,input:{profile,expected_revision:revision,request_id:uuid()}};input=pending.input;
   }
   const result=await request(action,input);if(version!==epoch||await getOwnerId()!==uid)fail('AUTH_REQUIRED');
   const state=readCompanyState(result);owner=uid;revision=state.revision;pending=null;return state;
  }finally{busy=false;}
 }
 return {load:()=>run('get'),save:p=>run('save',p),invalidate(){epoch++;owner=null;pending=null;revision=0;}};
}
