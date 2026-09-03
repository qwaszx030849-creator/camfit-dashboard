'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {context}=require('./firebase-context.cjs');
async function main(){
  const c=await context(),source=await c.load(),saved=await c.load('briefing','briefingChunks');
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const normal=html.slice(html.indexOf('function excelSerialToDateString('),html.indexOf('function getCellByHeaders('));
  const rs=html.slice(html.indexOf('function dashboardCurrentYear()'),html.indexOf('function onlineRsRateMatch('));
  const ctx=vm.createContext({ONLINE_RS:source.payload.onlineRS,Date});
  vm.runInContext(normal+rs,ctx);
  const trend=vm.runInContext('onlineRsMonthlyTrend()',ctx);
  for(const point of trend){
    const actual=vm.runInContext('Object.values(onlineRsAggregate('+JSON.stringify(point.period)+',"month")).reduce((s,r)=>s+r.rs,0)',ctx);
    assert.equal(point.rs,actual);
  }
  assert.equal(saved.payload.report.summary.total,source.payload.raw.camps.filter(c=>c.n).length);
  assert.equal(saved.payload.report.sourceUpdatedAt,source.meta.updatedAt);
  const computed={};
  source.payload.onlineRS.forEach(r=>{
    const key=vm.runInContext('onlineRsMonthKey('+JSON.stringify(r[1])+')',ctx);
    if(key&&Number(r[4])!==0)computed[key]=(computed[key]||0)+(Number(r[4])||0);
  });
  for(const point of trend)assert.equal(point.rs,computed[point.period]);
  console.log(JSON.stringify({ok:true,matchingRsMonths:trend.length,onlineRsRows:source.payload.onlineRS.length,briefingClients:saved.payload.report.summary.total,reportSourceMatches:true,sourceModified:false},null,2));
}
main().catch(e=>{console.error('실데이터 검증 실패: '+e.message);process.exitCode=1;});
