(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BriefingCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DAY=86400000;
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const iso=v=>{if(v===null||v===undefined||v==='')return null;const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString():null;};
  const koreanDate=v=>new Date(new Date(v).getTime()+9*3600000).toISOString().slice(0,10);
  function monthKey(y,m){return /^\d{4}$/.test(String(y))&&num(m)>=1&&num(m)<=12?y+'-'+String(m).padStart(2,'0'):'';}
  function previousMonth(key){const [y,m]=key.split('-').map(Number);return monthKey(m===1?y-1:y,m===1?12:m-1);}
  function safeUrl(value){
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}
  }
  function campKey(c){return safeUrl(c.l)||String(c.n||'');}
  function settledDate(value){
    const m=String(value||'').match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if(!m)return null;
    const date=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
    const d=new Date(date+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===date?date:null;
  }
  function salesData(payload,now){
    const today=koreanDate(now),weekly=[];
    Object.entries(payload.settlements||{}).forEach(([name,items])=>{
      if(!Array.isArray(items))return;
      items.forEach(s=>{const date=settledDate(s.date);if(date&&date<=today)weekly.push({name,date,amount:num(s.pay)-num(s.refund)});});
    });
    if(weekly.length){
      const end=weekly.map(r=>r.date).sort().at(-1),endTime=Date.parse(end+'T00:00:00Z');
      const dayBefore=n=>new Date(endTime-n*DAY).toISOString().slice(0,10);
      const start=dayBefore(6),prevStart=dayBefore(13),prevEnd=dayBefore(7);
      const current=new Map(),previous=new Map();
      weekly.forEach(r=>{const map=r.date>=start?current:r.date>=prevStart&&r.date<=prevEnd?previous:null;if(map)map.set(r.name,(map.get(r.name)||0)+r.amount);});
      return{kind:'week',current,previous,comparable:previous.size>0,incomplete:false,currentLabel:start+' ~ '+end,previousLabel:prevStart+' ~ '+prevEnd,note:'정산일 기준 7일간 환불 제외 결제매출 · 업체별 내역이 없는 기간은 0원으로 단정하지 않습니다.'};
    }
    const monthly=(payload.raw?.monthly||[]).filter(r=>monthKey(r[0],r[1]));
    const periods=[...new Set(monthly.map(r=>monthKey(r[0],r[1])))].sort();
    const thisMonth=today.slice(0,7),complete=periods.filter(p=>p<thisMonth);
    const currentKey=complete.at(-1)||periods.filter(p=>p<=thisMonth).at(-1)||'';
    const prevKey=currentKey?previousMonth(currentKey):'';
    const current=new Map(),previous=new Map();
    monthly.forEach(r=>{
      const period=monthKey(r[0],r[1]),map=period===currentKey?current:period===prevKey?previous:null;
      if(map)map.set(String(r[2]),(map.get(String(r[2]))||0)+num(r[4])-num(r[5]));
    });
    return{kind:'month',current,previous,comparable:!!currentKey&&currentKey<thisMonth&&periods.includes(prevKey),incomplete:currentKey===thisMonth,currentLabel:currentKey||'내역 없음',previousLabel:prevKey||'내역 없음',note:'주간 원장이 아직 없어 월별 정산으로 비교합니다. 종료된 월 우선 · 환불 제외 결제매출 · 미집계/누락 내역은 0원으로 처리하지 않습니다.'};
  }
  function revenue(name,data){
    const current=data.current.has(name)?data.current.get(name):null,previous=data.previous.has(name)?data.previous.get(name):null;
    if(!data.comparable||current===null||previous===null)return{current,previous,diff:null,rate:null,state:'unavailable'};
    const diff=current-previous,rate=previous>0?diff/previous*100:null;
    return{current,previous,diff,rate,state:previous===0&&current>0?'new':previous<0?'negative_base':rate===null?'flat':rate<=-20?'decline':rate>=20?'growth':'stable'};
  }
  function verifiedFeed(payload,key,now){
    const feed=payload.briefingSignals?.[key];
    if(!feed||!safeUrl(feed.sourceUrl)||!iso(feed.collectedAt))return null;
    const age=new Date(now)-new Date(feed.collectedAt);
    return age>=0&&age<=7*DAY?feed:null;
  }
  function priorityFor(row,report={},now=new Date()){
    const time=new Date(now),today=koreanDate(time),reasons=[],types=[];
    const fresh=(value,days=7)=>!!iso(value)&&time-new Date(value)>=0&&time-new Date(value)<=days*DAY;
    let level=0;
    const add=(type,text,rank)=>{types.push(type);reasons.push(text);level=Math.max(level,rank);};
    const s=row.sales||{},period=report.period||{};
    let end=period.current?.split(' ~ ').at(-1);
    if(period.kind==='month'&&/^\d{4}-\d{2}$/.test(end||'')){
      const [y,m]=end.split('-').map(Number);end=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);
    }
    const salesFresh=!period.incomplete&&settledDate(end)&&fresh(end+'T00:00:00+09:00',period.kind==='week'?14:45);
    const impact=salesFresh?Math.abs(num(s.diff)):0;
    if(salesFresh&&s.diff!==null&&impact>=100000){
      if(s.rate!==null&&s.rate<=-20)add('decline','매출 '+Math.abs(s.rate).toFixed(1)+'% 감소 · '+Math.round(impact).toLocaleString('ko-KR')+'원 감소',s.rate<=-50&&impact>=1000000?3:2);
      else if(s.rate!==null&&s.rate>=20)add('growth','매출 '+s.rate.toFixed(1)+'% 증가 · '+Math.round(impact).toLocaleString('ko-KR')+'원 증가',1);
      else if(s.state==='new')add('growth','이전 0원 대비 매출 발생 · '+Math.round(impact).toLocaleString('ko-KR')+'원',1);
    }
    const reviews=row.reviews||{};
    const recentReviews=reviews.status==='ok'&&fresh(reviews.checkedAt)?(reviews.items||[]).filter(r=>fresh(r.date)&&String(r.text||'').trim()):[];
    const low=recentReviews.filter(r=>r.rating!==null&&Number(r.rating)>=1&&Number(r.rating)<=2);
    if(low.length)add('reviews','최근 7일 평점 2점 이하 리뷰 '+low.length+'건',3);
    else if(recentReviews.length)add('reviews','최근 7일 원문 확인 리뷰 '+recentReviews.length+'건',1);
    else if(reviews.delta>0&&fresh(report.sourceUpdatedAt))add('reviews','누적 리뷰 '+reviews.delta+'건 증가 · 본문 미확인',1);
    const photos=row.photos||{};
    if(photos.status==='ok'&&fresh(photos.checkedAt)&&(photos.mainChanged||photos.added?.length||photos.removed?.length))add('photos',photos.mainChanged?'캠핏 대표 사진 변경':'캠핏 사진 추가·삭제 확인',1);
    const events=row.events||{};
    const activeEvents=events.status==='ok'&&fresh(events.checkedAt)?(events.items||[]).filter(e=>settledDate(e.start)&&settledDate(e.end)&&e.start<=today&&e.end>=today):[];
    const ending=activeEvents.filter(e=>Date.parse(e.end+'T00:00:00+09:00')-Date.parse(today+'T00:00:00+09:00')<=3*DAY);
    if(activeEvents.length)add('events',ending.length?'3일 내 종료 이벤트 '+ending.length+'건':'진행 중 이벤트 '+activeEvents.length+'건',ending.length?2:1);
    const posts=(row.mentions||[]).filter(m=>m.verification==='read'&&fresh(m.checkedAt)&&fresh(m.publishedAt+'T00:00:00+09:00'));
    if(posts.length)add('mentions','최근 7일 원문 확인 외부 글 '+posts.length+'건',1);
    return{eligible:reasons.length>0,level,label:level===3?'우선 확인':level===2?'중요 변동':'업데이트',impact,reasons,types};
  }
  function selectBriefingRows(report,now=new Date()){
    return(report?.rows||[]).map(row=>({...row,priority:priorityFor(row,report,now)})).filter(r=>r.priority.eligible).sort((a,b)=>
      b.priority.level-a.priority.level||b.priority.impact-a.priority.impact||b.priority.reasons.length-a.priority.reasons.length||a.name.localeCompare(b.name,'ko'));
  }
  function onlineRsSummary(payload,now){
    const today=koreanDate(now),rows=(payload.onlineRS||[]).map(r=>({date:settledDate(r[1]),rs:num(r[4])})).filter(r=>r.date&&r.date<=today);
    if(!rows.length)return null;
    const end=rows.map(r=>r.date).sort().at(-1),time=Date.parse(end+'T00:00:00Z'),back=n=>new Date(time-n*DAY).toISOString().slice(0,10);
    const start=back(6),previousStart=back(13),previousEnd=back(7);
    const currentRows=rows.filter(r=>r.date>=start),previousRows=rows.filter(r=>r.date>=previousStart&&r.date<=previousEnd);
    const current=currentRows.reduce((s,r)=>s+r.rs,0),previous=previousRows.length?previousRows.reduce((s,r)=>s+r.rs,0):null;
    return{current,previous,diff:previous===null?null:current-previous,rate:previous>0?(current-previous)/previous*100:null,currentPeriod:start+' ~ '+end,previousPeriod:previousStart+' ~ '+previousEnd};
  }
  function build(payload,previous={},options={}){
    const now=iso(options.now||new Date())||new Date().toISOString();
    const sourceUpdatedAt=iso(options.sourceUpdatedAt)||null;
    const old=new Map((previous.camps||[]).map(c=>[c.key,c]));
    const data=salesData(payload,now),snapshot=[];
    const externalSources=options.externalSources||previous.externalSources||{};
    const rows=(payload.raw?.camps||[]).filter(c=>c.n).map(c=>{
      const key=campKey(c),baseline=old.get(key),feed=verifiedFeed(payload,key,now);
      const rawCount=c.rv;
      const count=rawCount!==null&&rawCount!==undefined&&rawCount!==''&&Number.isFinite(Number(rawCount))?num(rawCount):null;
      const delta=sourceUpdatedAt&&previous.sourceUpdatedAt===sourceUpdatedAt?(baseline?.reviewDelta??null):count!==null&&baseline?.reviewCount!==null&&baseline?.reviewCount!==undefined?count-baseline.reviewCount:null;
      const snap={key,name:String(c.n),reviewCount:count,reviewDelta:delta};
      const reviews={status:feed?.reviews?.status==='ok'?'ok':'not_connected',count,delta,items:[]};
      if(reviews.status==='ok'){
        reviews.checkedAt=feed.collectedAt;
        reviews.items=(feed.reviews.items||[]).filter(r=>iso(r.date)&&new Date(r.date)<=new Date(now)&&new Date(r.date)>=new Date(now)-7*DAY).slice(0,10).map(r=>({date:iso(r.date),text:String(r.text||'').slice(0,500),rating:r.rating!==null&&Number(r.rating)>=1&&Number(r.rating)<=5?Number(r.rating):null,url:safeUrl(r.url)}));
      }
      let photos={status:'not_connected'};
      if(feed?.photos?.status==='ok'&&Array.isArray(feed.photos.urls)){
        const urls=[...new Set(feed.photos.urls.map(safeUrl).filter(Boolean))];
        photos={status:Array.isArray(baseline?.photoUrls)?'ok':'baseline',checkedAt:feed.collectedAt,count:urls.length,added:[],removed:[],mainChanged:false};
        if(photos.status==='ok'){
          photos.added=urls.filter(u=>!baseline.photoUrls.includes(u));
          photos.removed=baseline.photoUrls.filter(u=>!urls.includes(u));
          photos.mainChanged=(urls[0]||'')!==(baseline.photoUrls[0]||'');
        }
        if(baseline?.photoFeedAt===feed.collectedAt&&baseline.photoChange)photos=baseline.photoChange;
        snap.photoUrls=urls;snap.photoFeedAt=feed.collectedAt;snap.photoChange=photos;
      }else if(baseline?.photoUrls)snap.photoUrls=baseline.photoUrls;
      let events={status:'not_connected',items:[]};
      if(feed?.events?.status==='ok'&&Array.isArray(feed.events.items)){
        events={status:'ok',checkedAt:feed.collectedAt,items:feed.events.items.filter(e=>e.title&&settledDate(e.start)&&settledDate(e.end)&&settledDate(e.start)<=koreanDate(now)&&settledDate(e.end)>=koreanDate(now)).slice(0,10).map(e=>({title:String(e.title).slice(0,200),start:e.start,end:e.end,url:safeUrl(e.url)}))};
      }
      snapshot.push(snap);
      const mentions=(externalSources[key]||[]).filter(m=>safeUrl(m.url)&&iso(m.checkedAt)&&new Date(m.checkedAt)<=new Date(now)&&settledDate(m.publishedAt)&&m.publishedAt<=koreanDate(now)).slice(0,8).map(m=>({
        title:String(m.title||'외부 글').slice(0,200),url:safeUrl(m.url),publishedAt:settledDate(m.publishedAt),checkedAt:iso(m.checkedAt),
        kind:['방문 후기','소개·추천글','공식 공지'].includes(m.kind)?m.kind:'외부 글',summary:String(m.summary||'').slice(0,500),
        verification:m.verification==='read'?'read':'indexed',evidenceUrl:safeUrl(m.evidenceUrl),
        recent:Date.parse(m.publishedAt+'T00:00:00+09:00')>=new Date(now)-30*DAY
      })).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
      return{key,name:String(c.n),url:safeUrl(c.l),status:String(c.s||''),sales:revenue(String(c.n),data),reviews,photos,events,mentions};
    });
    const summary={total:rows.length,declines:rows.filter(r=>r.sales.state==='decline').length,growth:rows.filter(r=>r.sales.state==='growth').length,newReviewCount:rows.reduce((s,r)=>s+Math.max(0,r.reviews.delta||0),0),photoChanges:rows.filter(r=>r.photos.status==='ok'&&(r.photos.added.length||r.photos.removed.length||r.photos.mainChanged)).length,events:rows.filter(r=>r.events.items.length).length,unconnected:rows.filter(r=>[r.reviews,r.photos,r.events].some(x=>x.status==='not_connected')).length};
    rows.sort((a,b)=>(a.sales.state==='decline'?-1:0)-(b.sales.state==='decline'?-1:0)||(a.sales.diff??0)-(b.sales.diff??0)||a.name.localeCompare(b.name,'ko'));
    const period={kind:data.kind,current:data.currentLabel,previous:data.previousLabel,incomplete:data.incomplete,note:data.note};
    summary.externalCamps=rows.filter(r=>r.mentions.length).length;
    summary.recentMentions=rows.reduce((s,r)=>s+r.mentions.filter(m=>m.recent).length,0);
    const shortlisted=selectBriefingRows({rows,period,sourceUpdatedAt},now);
    summary.briefingCount=shortlisted.length;summary.excluded=rows.length-shortlisted.length;
    summary.urgent=shortlisted.filter(r=>r.priority.level===3).length;
    return{report:{generatedAt:now,sourceUpdatedAt,reason:options.reason||'새로고침',period,summary,onlineRs:onlineRsSummary(payload,now),rows},snapshot:{sourceUpdatedAt,checkedAt:now,camps:snapshot,externalSources}};
  }
  function nextThursday(now=new Date()){
    const shifted=new Date(new Date(now).getTime()+9*3600000),day=shifted.getUTCDay();
    let offset=(4-day+7)%7;
    if(offset===0&&shifted.getUTCHours()>=9)offset=7;
    return new Date(Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate()+offset,0)).toISOString();
  }
  function nextDaily(now=new Date()){
    const time=new Date(now),shifted=new Date(time.getTime()+9*3600000);
    let next=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate(),0);
    if(next<=time.getTime())next+=DAY;
    return new Date(next).toISOString();
  }
  return{build,salesData,revenue,safeUrl,campKey,monthKey,previousMonth,nextThursday,nextDaily,koreanDate,settledDate,onlineRsSummary,priorityFor,selectBriefingRows};
});
