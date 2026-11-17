'use strict';

// An offline, deterministic planning model for billed external n8n starts.
// It has no network access, credentials, customer IDs or production switches.
// Sub-workflow nodes and individual n8n nodes must NOT be counted as new starts
// unless the chosen n8n billing plan actually charges for those executions.
const defaults=Object.freeze({
  monthlyLimit:10000,
  reserve:2000,
  monthlyFixed:0,
  dailyFixed:0,
  dailyPerCustomer:0
});
const required=Object.freeze(['customers','filesPerDay','days','executionsPerFile']);
const names=Object.freeze({
  '--customers':'customers',
  '--files-per-day':'filesPerDay',
  '--days':'days',
  '--executions-per-file':'executionsPerFile',
  '--monthly-limit':'monthlyLimit',
  '--reserve':'reserve',
  '--monthly-fixed':'monthlyFixed',
  '--daily-fixed':'dailyFixed',
  '--daily-per-customer':'dailyPerCustomer'
});

function integer(value,name,{minimum=0,maximum=Number.MAX_SAFE_INTEGER}={}){
  if(!Number.isSafeInteger(value)||value<minimum||value>maximum)
    throw new RangeError(name+' must be an integer between '+minimum+' and '+maximum);
  return value;
}
function plus(...values){
  let sum=0;
  for(const value of values){
    if(!Number.isSafeInteger(value)||!Number.isSafeInteger(sum+value))
      throw new RangeError('budget arithmetic overflow');
    sum+=value;
  }
  return sum;
}
function times(...values){
  let product=1;
  for(const value of values){
    if(!Number.isSafeInteger(value)||!Number.isSafeInteger(product*value))
      throw new RangeError('budget arithmetic overflow');
    product*=value;
  }
  return product;
}
function forecast(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new TypeError('budget input must be an object');
  const cfg={...defaults,...input};
  for(const field of required)if(!Object.hasOwn(input,field))
    throw new TypeError('missing required assumption: '+field);
  for(const name of Object.keys(cfg))if(!Object.values(names).includes(name))
    throw new TypeError('unknown assumption: '+name);
  for(const [name,value] of Object.entries(cfg))
    integer(value,name,{minimum:name==='customers'||name==='days'||name==='monthlyLimit'?1:0,
      maximum:name==='days'?31:Number.MAX_SAFE_INTEGER});
  if(cfg.reserve>cfg.monthlyLimit)
    throw new RangeError('reserve exceeds monthly limit');

  const files=times(cfg.customers,cfg.filesPerDay,cfg.days);
  const fileExecutions=times(files,cfg.executionsPerFile);
  const recurringExecutions=times(cfg.dailyFixed,cfg.days);
  const perCustomerExecutions=times(cfg.dailyPerCustomer,cfg.customers,cfg.days);
  const fixedExecutions=plus(cfg.monthlyFixed,recurringExecutions);
  const nonFileExecutions=plus(fixedExecutions,perCustomerExecutions);
  const estimatedExecutions=plus(fileExecutions,nonFileExecutions);
  const usableExecutions=cfg.monthlyLimit-cfg.reserve;
  const perCustomerCost=plus(
    times(cfg.filesPerDay,cfg.days,cfg.executionsPerFile),
    times(cfg.days,cfg.dailyPerCustomer)
  );
  const remainingAfterFixed=Math.max(0,usableExecutions-fixedExecutions);
  const customerCapacityAtTheseRates=perCustomerCost===0?null:
    Math.floor(remainingAfterFixed/perCustomerCost);
  const maxExecutionsPerFile=files===0?null:
    Math.floor(Math.max(0,usableExecutions-nonFileExecutions)/files);

  return {
    model:'SMA_N8N_EXTERNAL_STARTS_V1',
    verifiedAgainstActualN8nUsage:false,
    assumptions:cfg,
    monthlyFiles:files,
    fileExecutions,
    fixedExecutions,
    perCustomerExecutions,
    estimatedExecutions,
    usableExecutions,
    remainingIncludingReserve:cfg.monthlyLimit-estimatedExecutions,
    headroomAfterReserve:usableExecutions-estimatedExecutions,
    maxExecutionsPerFile,
    customerCapacityAtTheseRates,
    status:estimatedExecutions>usableExecutions?'OVER_MODELLED_BUDGET':'WITHIN_MODELLED_BUDGET',
    note:'Plan only: count actual billed external workflow starts; allow for provider callbacks, retries, login and background traffic.'
  };
}
function readArgs(argv){
  if(argv.includes('--help'))return null;
  if(argv.length%2!==0)throw new TypeError('each flag requires one integer value');
  const input={};
  for(let i=0;i<argv.length;i+=2){
    const key=names[argv[i]];
    if(!key||Object.hasOwn(input,key))throw new TypeError('unknown or duplicate option: '+argv[i]);
    const value=argv[i+1];
    if(!/^\d+$/.test(value))throw new TypeError('invalid integer for '+argv[i]);
    input[key]=Number(value);
  }
  return input;
}
function usage(){
  return [
    'SMA – execution capacity planning (no network, no n8n calls)',
    'node n8n/consolidation/execution-budget.cjs --customers 20 --files-per-day 3 --days 31 --executions-per-file 26',
    'Options: --monthly-limit 10000 --reserve 2000 --monthly-fixed 0 --daily-fixed 0 --daily-per-customer 0',
    'All traffic and event rates are assumptions until confirmed by n8n billing data.'
  ].join('\n');
}
if(require.main===module){
  try{
    const opts=readArgs(process.argv.slice(2));
    if(opts===null)console.log(usage());
    else console.log(JSON.stringify(forecast(opts),null,2));
  }catch(error){
    console.error('BUDGET_INPUT_INVALID: '+error.message);
    console.error(usage());
    process.exitCode=1;
  }
}
module.exports={forecast,readArgs};
