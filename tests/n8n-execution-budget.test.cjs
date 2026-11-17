const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {resolve}=require('node:path');
const {forecast,readArgs}=require('../n8n/consolidation/execution-budget.cjs');
const standard={customers:20,filesPerDay:3,days:30,executionsPerFile:26};

test('20 customers and three daily files expose the 26-start cost overrun',()=>{
 const result=forecast(standard);
 assert.equal(result.monthlyFiles,1800);
 assert.equal(result.fileExecutions,46800);
 assert.equal(result.estimatedExecutions,46800);
 assert.equal(result.usableExecutions,8000);
 assert.equal(result.maxExecutionsPerFile,4);
 assert.equal(result.customerCapacityAtTheseRates,3);
 assert.equal(result.status,'OVER_MODELLED_BUDGET');
 assert.equal(result.verifiedAgainstActualN8nUsage,false);
});

test('four external starts per file fits a 31-day month only without extra overhead',()=>{
 const result=forecast({...standard,days:31,executionsPerFile:4});
 assert.equal(result.monthlyFiles,1860);
 assert.equal(result.estimatedExecutions,7440);
 assert.equal(result.customerCapacityAtTheseRates,21);
 assert.equal(result.maxExecutionsPerFile,4);
 assert.equal(result.headroomAfterReserve,560);
 assert.equal(result.status,'WITHIN_MODELLED_BUDGET');
});

test('realistic fixed and per-customer activity is not mistaken for free capacity',()=>{
 const r=forecast({...standard,days:31,executionsPerFile:4,
   monthlyFixed:100,dailyFixed:5,dailyPerCustomer:1});
 assert.equal(r.fixedExecutions,255);
 assert.equal(r.perCustomerExecutions,620);
 assert.equal(r.estimatedExecutions,8315);
 assert.equal(r.maxExecutionsPerFile,3);
 assert.equal(r.customerCapacityAtTheseRates,19);
 assert.equal(r.headroomAfterReserve,-315);
 assert.equal(r.status,'OVER_MODELLED_BUDGET');
});

test('the budget has no hard-coded 20-customer limit',()=>{
 const base={...standard,days:31,executionsPerFile:1,reserve:0};
 const at20=forecast(base),at60=forecast({...base,customers:60});
 assert.equal(at20.estimatedExecutions,1860);
 assert.equal(at60.estimatedExecutions,5580);
 assert.equal(at60.customerCapacityAtTheseRates,107);
 assert.equal(at60.status,'WITHIN_MODELLED_BUDGET');
});

test('the usable-budget boundary is inclusive, but reserve remains untouched',()=>{
 const at=forecast({...standard,executionsPerFile:4,monthlyFixed:800});
 assert.equal(at.estimatedExecutions,8000);
 assert.equal(at.status,'WITHIN_MODELLED_BUDGET');
 assert.equal(at.remainingIncludingReserve,2000);
 const above=forecast({...standard,executionsPerFile:4,monthlyFixed:801});
 assert.equal(above.status,'OVER_MODELLED_BUDGET');
});

test('zero files never divides by zero or invents unlimited billable usage',()=>{
 const r=forecast({customers:40,filesPerDay:0,days:31,executionsPerFile:0});
 assert.equal(r.monthlyFiles,0);
 assert.equal(r.maxExecutionsPerFile,null);
 assert.equal(r.customerCapacityAtTheseRates,null);
 assert.equal(r.estimatedExecutions,0);
});

test('invalid or oversized values are rejected before any forecast',()=>{
 const bad=[
  {},{...standard,customers:0},{...standard,customers:-1},
  {...standard,days:32},{...standard,monthlyLimit:1000,reserve:2000},
  {...standard,reserve:10001},{...standard,filesPerDay:0.5},
  {...standard,unknown:1},
  {...standard,customers:Number.MAX_SAFE_INTEGER,filesPerDay:2,days:1,executionsPerFile:1}
 ];
 for(const obj of bad)assert.throws(()=>forecast(obj),/missing|required|integer|unknown|overflow|exceeds/);
 assert.throws(()=>readArgs(['--customers','-4']),/invalid integer/);
 assert.throws(()=>readArgs(['--customers','2','--customers','3']),/duplicate/);
 assert.throws(()=>readArgs(['--files-per-day']),/requires one/);
 assert.throws(()=>readArgs(['--secret','1']),/unknown/);
});

test('CLI is deterministic JSON and never performs a network or production operation',()=>{
 const file=resolve(__dirname,'../n8n/consolidation/execution-budget.cjs');
 const a=spawnSync(process.execPath,[file,'--customers','20','--files-per-day','3',
  '--days','30','--executions-per-file','26'],{encoding:'utf8',timeout:5000});
 assert.equal(a.status,0,a.stderr);
 assert.equal(JSON.parse(a.stdout).estimatedExecutions,46800);
 const bad=spawnSync(process.execPath,[file,'--customers','not-a-number'],{
  encoding:'utf8',timeout:5000});
 assert.equal(bad.status,1);
 assert.match(bad.stderr,/BUDGET_INPUT_INVALID/);
});
