'use strict';
let briefingState=null,briefingError='',briefingBusy=false,briefingUnsubscribe=null,briefingSourceTime=null;
const briefEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const briefTime=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}):'아직 없음';
const briefMoney=value=>value===null?'내역 없음':Math.round(value).toLocaleString('ko-KR')+'원';
function briefingTab(){
  return '<div class="brief-head"><div><h2>거래처 브리핑</h2><p>최근 리뷰 · 사진 변경 · 진행 이벤트 · 매출 증감</p></div><button class="btn btn-primary" id="briefRefresh" onclick="refreshBriefingNow()">저장 데이터로 새로고침</button></div>'+
    '<div class="brief-status" id="briefStatus" role="status" aria-live="polite">브리핑을 불러오는 중입니다.</div><p class="brief-meta">오전 9시 자동 갱신·알림은 현재 PC의 Codex 예약 실행입니다. PC와 앱이 실행 중이어야 하며, 실패 시 마지막 정상 결과가 유지됩니다.</p>'+
    '<div id="briefSummary" class="kpi-row"></div><div id="briefWeekly" class="panel"></div>'+
    '<div class="brief-notice">브리핑할 이슈가 있는 거래처만 중요도 → 매출 영향액 순으로 표시합니다. 매출은 20% 이상·10만 원 이상 변동, 외부 글은 최근 7일 원문 확인 건이 기준입니다. 과거 글·원문 미확인·자료 부족·미연동만 있는 거래처는 제외합니다. 캠핏 직접 수집은 미연동이며 “변경 없음”을 뜻하지 않습니다.</div>'+
    '<div class="filter-row"><input class="search" id="briefSearch" aria-label="브리핑 거래처 검색" placeholder="거래처 이름 검색" oninput="renderBriefingCards()"><select id="briefFilter" aria-label="브리핑 유형" onchange="renderBriefingCards()"><option value="all">전체 거래처</option><option value="decline">매출 20% 이상 감소</option><option value="growth">매출 20% 이상 증가</option><option value="reviews">리뷰 증가 / 최근 리뷰</option><option value="photos">사진 변경</option><option value="events">진행 이벤트</option></select><span id="briefCount"></span></div>'+
    '<p id="briefPeriod" class="brief-meta"></p><div id="briefCards" class="brief-grid"></div>';
}
async function readBriefing(uid){
  const metaRef=secureDb.doc('users/'+uid+'/briefing/latest'),metaDoc=await metaRef.get();
  if(!metaDoc.exists)return null;
  const meta=metaDoc.data(),parts=[];
  if(!Number.isInteger(meta.chunks)||meta.chunks<0||meta.chunks>400)throw new Error('브리핑 형식이 올바르지 않습니다.');
  for(let i=0;i<meta.chunks;i++){
    const doc=await secureDb.doc('users/'+uid+'/briefingChunks/'+String(i).padStart(3,'0')).get();
    if(!doc.exists||doc.data().version!==meta.version)throw new Error('브리핑이 갱신 중입니다. 잠시 후 새로고침해 주세요.');
    parts.push(doc.data().payload||'');
  }
  return parts.length?{...JSON.parse(parts.join('')),version:meta.version}:null;
}
function stopBriefingUpdates(){
  if(briefingUnsubscribe)briefingUnsubscribe();
  briefingUnsubscribe=null;briefingState=null;briefingError='';briefingSourceTime=null;
}
function startBriefingUpdates(){
  stopBriefingUpdates();
  const uid=secureUid;
  briefingUnsubscribe=secureDb.doc('users/'+uid+'/briefing/latest').onSnapshot(async doc=>{
    try{
      const value=doc.exists?await readBriefing(uid):null;
      if(secureUid!==uid)return;
      briefingState=value;briefingError='';renderBriefingUI();
    }catch(e){if(secureUid===uid){briefingError=e.message;renderBriefingUI();}}
  },()=>{if(secureUid===uid){briefingError='브리핑을 불러오지 못했습니다. 로그인 및 연결 상태를 확인해 주세요.';renderBriefingUI();}});
}
async function saveBriefingForPayload(payload,reason,sourceDoc){
  const uid=secureUid;
  if(!secureUser||uid==='guest')return;
  const source=sourceDoc||await secureDb.doc('users/'+uid+'/dashboard/meta').get();
  const sourceData=source.data()||{},sourceTime=sourceData.updatedAt?.toDate?.().toISOString()||null;
  const previous=await readBriefing(uid);
  const next=BriefingCore.build(payload,previous?.snapshot,{sourceUpdatedAt:sourceTime,reason});
  const text=JSON.stringify(next),parts=[],version=new Date().toISOString();
  for(let i=0;i<text.length;i+=180000)parts.push(text.slice(i,i+180000));
  if(parts.length>390)throw new Error('브리핑 저장 한도를 초과했습니다.');
  const ref=secureDb.doc('users/'+uid+'/briefing/latest');
  await secureDb.runTransaction(async tx=>{
    const fresh=await tx.get(secureDb.doc('users/'+uid+'/dashboard/meta'));
    const old=await tx.get(ref);
    const freshTime=fresh.data()?.updatedAt?.toDate?.().toISOString()||null;
    if(freshTime!==sourceTime||secureUid!==uid)throw new Error('정산 데이터가 변경되어 새로고침이 필요합니다.');
    const oldVersion=old.data()?.version;
    if((oldVersion||null)!==(previous?.version||null))throw new Error('새 브리핑이 생성되었습니다. 다시 불러와 주세요.');
    parts.forEach((part,i)=>tx.set(secureDb.doc('users/'+uid+'/briefingChunks/'+String(i).padStart(3,'0')),{payload:part,version}));
    for(let i=parts.length;i<(old.data()?.chunks||0);i++)tx.delete(secureDb.doc('users/'+uid+'/briefingChunks/'+String(i).padStart(3,'0')));
    tx.set(ref,{chunks:parts.length,version,updatedAt:version,sourceUpdatedAt:sourceTime,reason});
  });
  if(secureUid===uid){briefingState=next;briefingError='';renderBriefingUI();}
}
async function refreshBriefingNow(){
  if(briefingBusy||!secureUser)return;
  briefingBusy=true;briefingError='';renderBriefingUI();
  const uid=secureUid;
  try{
    const source=await secureDb.doc('users/'+uid+'/dashboard/meta').get();
    const payload=await loadSecurePayload(uid);
    if(secureUid!==uid)return;
    if(!payload)throw new Error('정산 데이터를 먼저 가져와 주세요.');
    await saveBriefingForPayload(payload,'저장 데이터 새로고침',source);
  }catch(e){briefingError=e.message;}
  finally{briefingBusy=false;renderBriefingUI();}
}
function renderBriefingUI(){
  const el=document.getElementById('briefStatus');
  if(!el)return;
  const r=briefingState?.report,button=document.getElementById('briefRefresh');
  button.disabled=briefingBusy;button.textContent=briefingBusy?'집계 중…':'저장 데이터로 새로고침';
  el.textContent=briefingError?'갱신 실패: '+briefingError:r?'마지막 집계 '+briefTime(r.generatedAt)+' · 원천 데이터 저장 '+briefTime(r.sourceUpdatedAt)+' · 다음 알림 '+briefTime(BriefingCore.nextDaily())+' · 매주 목요일 정산 요약 추가 (한국시간)':'아직 저장된 브리핑이 없습니다. 정산 데이터를 가져오거나 새로고침해 주세요.';
  el.classList.toggle('brief-error',!!briefingError);
  if(r)el.textContent+=' · 외부 글 확보 '+(r.summary.externalCamps||0)+'/'+r.summary.total+'개 거래처 (전체 수집 완료 아님)';
  const filterEl=document.getElementById('briefFilter');
  if(filterEl)filterEl.querySelector('option[value="all"]').textContent='전체 주요 이슈';
  if(filterEl&&!filterEl.querySelector('option[value="mentions"]'))filterEl.insertAdjacentHTML('beforeend','<option value="mentions">외부 후기·블로그 있음</option>');
  const allRows=(r?.rows||[]).filter(x=>!isHidden(x.name));
  const rows=BriefingCore.selectBriefingRows(r).filter(x=>!isHidden(x.name));
  const kpis=[
    ['브리핑 대상',rows.length+'개'],
    ['우선 확인',rows.filter(x=>x.priority.level===3).length+'개'],
    ['주요 매출 감소',rows.filter(x=>x.priority.types.includes('decline')).length+'개'],
    ['노출 기준 미충족',(allRows.length-rows.length)+'개']
  ];
  document.getElementById('briefSummary').innerHTML=kpis.map(([label,value])=>'<div class="kpi"><div class="label">'+label+'</div><div class="value">'+value+'</div></div>').join('');
  document.getElementById('briefPeriod').textContent=r?'매출 비교: '+r.period.previous+' → '+r.period.current+' · '+r.period.note:'';
  const rs=r?.onlineRs;
  document.getElementById('briefWeekly').innerHTML=rs?'<h3>최신 주간 온라인 RS 정산</h3><p class="brief-meta">'+briefEsc(rs.previousPeriod)+' → '+briefEsc(rs.currentPeriod)+'</p><p>'+briefMoney(rs.previous)+' → <strong>'+briefMoney(rs.current)+'</strong> · '+(rs.rate===null?'이전 비교 기준 부족':(rs.rate>=0?'+':'')+rs.rate.toFixed(1)+'%')+'</p>':'주간 온라인 RS 정산 내역이 없습니다.';
  renderBriefingCards();
}
function briefReviewHTML(review){
  const count=review.count==null?'누적 리뷰 수 없음':'누적 '+review.count.toLocaleString()+'건';
  const delta=review.delta===null?'첫 비교 기준 저장':review.delta>0?'이전 자료 대비 +'+review.delta+'건':review.delta<0?'이전 자료 대비 '+review.delta+'건':'누적 수 변화 없음';
  return '<strong>'+count+'</strong><p>'+delta+'</p>'+(review.status==='ok'?review.items.map(i=>'<p class="brief-review">'+briefEsc(i.text)+'<span class="brief-meta">'+briefTime(i.date)+'</span></p>').join('')||'<p>확인된 최근 7일 리뷰 없음</p>':'<span class="tag tag-orange">최근 본문 연동 필요</span>');
}
function briefPhotoHTML(photo){
  if(photo.status==='not_connected')return '<span class="tag tag-orange">연동 필요</span><p>사진 변경 여부를 확인하지 못했습니다.</p>';
  if(photo.status==='baseline')return '<p>사진 '+photo.count+'장 · 첫 비교 기준 저장</p>';
  return '<p>추가 '+photo.added.length+'장 / 삭제 '+photo.removed.length+'장</p><p>'+(photo.mainChanged?'대표 사진 변경':'대표 사진 동일')+'</p>';
}
function briefEventHTML(events){
  if(events.status!=='ok')return '<span class="tag tag-orange">연동 필요</span><p>이벤트 진행 여부를 확인하지 못했습니다.</p>';
  return events.items.map(e=>'<p><strong>'+briefEsc(e.title)+'</strong></p><p>'+briefEsc(e.start)+' ~ '+briefEsc(e.end)+'</p>').join('')||'<p>확인된 진행 이벤트 없음</p>';
}
function briefMentionsHTML(items){
  if(!items?.length)return '<section><h4>외부 후기·블로그</h4><p class="brief-meta">아직 확인된 외부 글이 없습니다. 검색 완료 또는 후기 없음의 의미는 아닙니다.</p></section>';
  return '<section><h4>외부 후기·블로그</h4>'+items.map(m=>'<div class="brief-review"><a href="'+briefEsc(BriefingCore.safeUrl(m.url))+'" target="_blank" rel="noopener noreferrer">'+briefEsc(m.title)+' ↗</a><p class="brief-meta">'+briefEsc(m.kind)+' · 작성 '+briefEsc(m.publishedAt)+' · '+(m.recent?'최근 30일 글':'과거 참고 글')+' · 확인 '+briefTime(m.checkedAt)+'</p><p>'+briefEsc(m.summary)+'</p>'+(m.verification==='read'?'<span class="tag">원문 확인</span>':'<span class="tag tag-orange">검색·목록에서 발견 / 원문 미확인</span>')+(m.evidenceUrl?'<a href="'+briefEsc(BriefingCore.safeUrl(m.evidenceUrl))+'" target="_blank" rel="noopener noreferrer"> 확인 출처 ↗</a>':'')+'</div>').join('')+'</section>';
}
function renderBriefingCards(){
  const target=document.getElementById('briefCards');if(!target)return;
  const q=(document.getElementById('briefSearch')?.value||'').trim().toLowerCase(),filter=document.getElementById('briefFilter')?.value||'all';
  const rows=BriefingCore.selectBriefingRows(briefingState?.report).filter(r=>!isHidden(r.name)&&r.name.toLowerCase().includes(q)).filter(r=>filter==='all'||r.priority.types.includes(filter));
  document.getElementById('briefCount').textContent=rows.length+'개 거래처';
  target.innerHTML=rows.slice(0,100).map(r=>{
    const s=r.sales;
    const change=s.diff===null?'비교 자료 부족':s.state==='new'?'이전 0원 → 매출 발생':s.rate===null?'기준 매출 0원 이하 · 증감률 제외':(s.rate>=0?'+':'')+s.rate.toFixed(1)+'%';
    const diff=s.diff===null?'':(s.diff>=0?'+':'')+briefMoney(s.diff);
    const href=BriefingCore.safeUrl(r.url);
    return '<article class="brief-card"><div class="brief-card-head"><h3>'+briefEsc(r.name)+'</h3>'+(href?'<a class="camp-link" href="'+briefEsc(href)+'" target="_blank" rel="noopener noreferrer">거래처 보기 ↗</a>':'')+'</div><div class="brief-notice"><strong>'+briefEsc(r.priority.label)+'</strong><p>'+r.priority.reasons.map(briefEsc).join(' · ')+'</p></div>'+
      '<div class="brief-sales"><span>환불 제외 결제매출</span><strong class="'+(s.diff<0?'down':s.diff>0?'up':'')+'">'+change+'</strong><span>'+briefMoney(s.previous)+' → '+briefMoney(s.current)+'</span><span>'+diff+'</span></div>'+
      '<div class="brief-details"><section><h4>최근 리뷰</h4>'+briefReviewHTML(r.reviews)+'</section><section><h4>사진 변경</h4>'+briefPhotoHTML(r.photos)+'</section><section><h4>진행 이벤트</h4>'+briefEventHTML(r.events)+'</section></div>'+briefMentionsHTML(r.mentions)+'</article>';
  }).join('')||'<div class="panel">현재 조건에서 브리핑할 주요 이슈가 없습니다. 자료 부족·미연동 여부는 전체 변경 없음으로 해석하지 않습니다.</div>';
  if(rows.length>100)target.insertAdjacentHTML('beforeend','<div class="brief-meta">처음 100개를 표시합니다. 거래처 이름이나 유형으로 범위를 좁혀 주세요.</div>');
}
function mergeBriefingSettlements(base={},incoming={}){
  const merged={...base};
  Object.entries(incoming||{}).forEach(([name,items])=>{
    const key=s=>String(s.period||'')+'|'+String(s.date||'').replaceAll('.','-').replaceAll('/','-');
    merged[name]=[...new Map([...(Array.isArray(base?.[name])?base[name]:[]),...(Array.isArray(items)?items:[])].map(s=>[key(s),s])).values()];
  });
  return merged;
}
