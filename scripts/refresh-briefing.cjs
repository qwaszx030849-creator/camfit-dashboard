'use strict';
const {context}=require('./firebase-context.cjs');
const {build,campKey,safeUrl,settledDate,koreanDate}=require('../briefing-core.js');
async function main(){
  const c=await context(),source=await c.load();
  if(!source.payload)throw new Error('저장된 대시보드 데이터가 없습니다.');
  const previous=await c.load('briefing','briefingChunks');
  const externalSources={...(previous.payload?.snapshot?.externalSources||{})};
  if(process.argv.includes('--sources-stdin')){
    let input='';for await(const part of process.stdin){input+=part;if(input.length>200000)throw new Error('외부 출처 입력이 너무 큽니다.');}
    const items=JSON.parse(input),known=new Set(source.payload.raw.camps.map(campKey));
    if(!Array.isArray(items)||items.length>100)throw new Error('외부 출처는 최대 100건 배열이어야 합니다.');
    for(const m of items){
      const key=safeUrl(m.campUrl),publishedAt=settledDate(m.publishedAt),checkedAt=new Date(m.checkedAt);
      if(!known.has(key)||!safeUrl(m.url)||!m.title||!m.summary||!publishedAt||publishedAt>koreanDate(new Date())||!Number.isFinite(checkedAt.getTime())||checkedAt>new Date()||!['read','indexed'].includes(m.verification)||!m.identityEvidence)throw new Error('거래처·출처·작성일·확인일·식별 근거를 확인해 주세요.');
      if(m.verification==='indexed'&&!safeUrl(m.evidenceUrl))throw new Error('원문 미확인 글은 발견 출처 URL이 필요합니다.');
      const item={url:safeUrl(m.url),title:String(m.title).slice(0,200),summary:String(m.summary).slice(0,500),publishedAt,checkedAt:checkedAt.toISOString(),kind:String(m.kind||'외부 글'),verification:m.verification,evidenceUrl:safeUrl(m.evidenceUrl),identityEvidence:String(m.identityEvidence).slice(0,300)};
      externalSources[key]=[item,...(externalSources[key]||[]).filter(old=>old.url!==item.url)].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,8);
    }
  }
  const thursday=new Date(Date.now()+9*3600000).getUTCDay()===4;
  const reason=process.argv.includes('--weekly')||thursday?'목요일 정산 요약 포함':'매일 거래처 브리핑';
  const next=build(source.payload,previous.payload?.snapshot,{sourceUpdatedAt:source.meta.updatedAt,reason,externalSources});
  if(process.argv.includes('--candidates')){
    const camps=source.payload.raw.camps.filter(x=>safeUrl(x.l)).sort((a,b)=>a.n.localeCompare(b.n,'ko'));
    const priority=next.report.rows.filter(r=>r.sales.state==='decline').slice(0,5).map(r=>camps.find(c=>campKey(c)===r.key)).filter(Boolean);
    const offset=(Math.floor(Date.now()/86400000)*5)%Math.max(camps.length,1);
    const rotation=Array.from({length:Math.min(5,camps.length)},(_,i)=>camps[(offset+i)%camps.length]);
    console.log(JSON.stringify([...new Map([...priority,...rotation].map(c=>[campKey(c),{name:c.n,address:c.a,camfitUrl:c.l,existing:externalSources[campKey(c)]||[]}])).values()],null,2));return;
  }
  if(process.argv.includes('--write'))await c.saveBriefing(next,source.updateTime,reason,previous.meta?.version);
  const r=next.report;
  console.log(JSON.stringify({saved:process.argv.includes('--write'),reason,generatedAt:r.generatedAt,sourceUpdatedAt:r.sourceUpdatedAt,sourceUnchanged:previous.payload?.report?.sourceUpdatedAt===r.sourceUpdatedAt,period:r.period,summary:r.summary,onlineRs:r.onlineRs,topDeclines:r.rows.filter(x=>x.sales.state==='decline').slice(0,5).map(x=>({name:x.name,rate:Math.round(x.sales.rate*10)/10,diff:x.sales.diff})),externalSources:'외부 글은 확인된 거래처만 제공하며, 캠핏 직접 수집과 구분합니다. 전체 거래처 검색 완료를 의미하지 않습니다.'},null,2));
}
main().catch(e=>{console.error('브리핑 갱신 실패: '+e.message);process.exitCode=1;});
