(function(){
  const STORE='camfit_monitoring_v1_';
  const today=()=>new Date().toISOString().slice(0,10);
  const uid=()=>window.secureUid||'local';
  const key=()=>STORE+uid();
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmtMoney=n=>typeof window.fmt==='function'?window.fmt(n):Number(n||0).toLocaleString('ko-KR');
  const load=()=>{try{return JSON.parse(localStorage.getItem(key())||'{"clients":[],"items":[],"logs":[]}')}catch(e){return{clients:[],items:[],logs:[]}}};
  const save=s=>localStorage.setItem(key(),JSON.stringify(s));
  const month=d=>String(d||'').slice(0,7);
  function allCamps(){try{if(typeof window.activeCamps==='function')return window.activeCamps()}catch(e){}return[]}
  function allMonthly(){try{if(typeof window.activeMonthly==='function')return window.activeMonthly()}catch(e){}return[]}
  function campNames(){
    try{
      const names=[];
      allCamps().forEach(c=>{if(c?.n)names.push(c.n)});
      allMonthly().forEach(r=>{if(r?.n)names.push(r.n)});
      try{(typeof window.cmLoad==='function'?window.cmLoad():[]).forEach(c=>{if(c?.name)names.push(c.name)})}catch(e){}
      try{load().clients.forEach(c=>{if(c?.name)names.push(c.name)})}catch(e){}
      return [...new Set(names.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
    }catch(e){return[]}
  }
  function seed(){
    const s=load();
    if(!s.clients.length){
      let names=[];
      try{names=(typeof window.cmLoad==='function'?window.cmLoad():[]).map(c=>c.name)}catch(e){}
      if(!names.length)names=campNames().slice(0,10);
      s.clients=names.slice(0,10).map(name=>({name,keywords:[name],active:true,createdAt:today()}));
      save(s);
    }
    return s;
  }
  function clientData(name){
    try{
      const camp=allCamps().find(c=>c.n===name)||{};
      const latest=allMonthly().filter(r=>r.n===name).sort((a,b)=>(b.y*100+b.m)-(a.y*100+a.m))[0]||{};
      return {region:(camp.a||'').split(' ').slice(0,2).join(' '),plan:camp.p||camp.mp||'-',pay:latest.pay||0,link:camp.l||''};
    }catch(e){return{region:'',plan:'-',pay:0,link:''}}
  }
  function classify(title,summary){
    const text=(title+' '+summary).toLowerCase();
    if(/불친절|별로|실망|최악|환불|취소|민원|컴플레인|냄새|더러|불편|소음/.test(text))return '주의';
    if(/추천|좋았|만족|깨끗|친절|재방문|힐링|감성|최고|아이|애견/.test(text))return '긍정';
    return '중립';
  }
  function searchUrls(c){
    const q=encodeURIComponent((c.keywords?.length?c.keywords:[c.name]).join(' ')+' 캠핑장');
    return {
      blog:'https://search.naver.com/search.naver?where=blog&query='+q+'&sm=tab_opt&nso=so:r,p:1m',
      news:'https://search.naver.com/search.naver?where=news&query='+q+'&sm=tab_opt&sort=1',
      google:'https://www.google.com/search?q='+q+'+후기+OR+리뷰'
    };
  }
  function kakaoMessage(i){
    const lead=i.sentiment==='주의'?'확인해보시면 좋을 내용이 보여서 공유드립니다.':i.sentiment==='긍정'?'좋은 후기가 올라와서 공유드립니다.':'관련 언급이 확인되어 공유드립니다.';
    const action=i.sentiment==='주의'?'응대나 시설 안내 문구를 한 번 점검하면 좋겠습니다. 필요하시면 제가 답변/안내 문안까지 정리해드릴게요.':i.sentiment==='긍정'?'캠핏 소개문이나 네이버 플레이스에 활용하기 좋은 포인트가 있습니다. 다음 업데이트 때 반영해보겠습니다.':'노출 흐름 확인용으로 보시면 좋겠습니다.';
    return `${i.client} 대표님, 안녕하세요. 캠핏 박해준입니다.\n\n${lead}\n\n[${i.source||'웹'}] ${i.title}\n${i.url||''}\n\n제가 보기에는 ${action}\n\n이번 달 모니터링 계속 체크해드리겠습니다.`;
  }
  window.monitoringTab=function(){
    const s=seed();
    const pending=s.items.filter(i=>i.status==='pending').length;
    const attention=s.items.filter(i=>i.status==='pending'&&i.sentiment==='주의').length;
    const sent=s.items.filter(i=>i.status==='sent'&&month(i.sentAt)===month(today())).length;
    return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px">
      <div><h2 style="font-size:22px">거래처 모니터링</h2><p style="color:var(--text2);font-size:13px;margin-top:6px">업체 관련 블로그·뉴스·후기를 발견하면 대표님께 보낼 개인톡 문안을 자동 정리합니다.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" onclick="monOpenBatchSearch()">오늘 검색 열기</button><button class="btn" style="background:var(--card2);color:var(--text)" onclick="monExport()">JSON 내보내기</button></div>
    </div>
    <div class="kpi-row">
      <div class="kpi"><div class="label">모니터링 거래처</div><div class="value">${s.clients.filter(c=>c.active!==false).length}개</div></div>
      <div class="kpi"><div class="label">승인 대기</div><div class="value" style="color:var(--orange)">${pending}건</div></div>
      <div class="kpi"><div class="label">주의 필요</div><div class="value down">${attention}건</div></div>
      <div class="kpi"><div class="label">이번 달 발송완료</div><div class="value" style="color:var(--green)">${sent}건</div></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3><span class="icon" style="background:var(--accent)"></span>거래처 등록</h3>
        <div class="filter-row"><div style="position:relative;flex:1;min-width:240px"><input class="search" id="monClientName" placeholder="캠핑장명 또는 키워드 입력..." autocomplete="off" oninput="monClientAutoComplete()" onfocus="monClientAutoComplete()" style="width:100%"><div id="monClientAC" style="position:absolute;top:100%;left:0;width:100%;max-height:240px;overflow-y:auto;background:var(--card);border:1px solid var(--border);border-radius:8px;display:none;z-index:70;box-shadow:0 12px 30px rgba(0,0,0,.24)"></div></div><button class="btn btn-green" onclick="monAddClient()">추가</button></div>
        <div id="monClientList"></div>
      </div>
      <div class="panel"><h3><span class="icon" style="background:var(--green)"></span>발견 글 등록</h3>
        <div class="filter-row"><select id="monItemClient" style="min-width:180px">${s.clients.map(c=>`<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</select><select id="monItemSource"><option>네이버 블로그</option><option>네이버 뉴스</option><option>인스타그램</option><option>카페/커뮤니티</option><option>기타</option></select></div>
        <input class="search" id="monItemTitle" placeholder="글 제목" style="width:100%;margin-bottom:8px">
        <input class="search" id="monItemUrl" placeholder="URL" style="width:100%;margin-bottom:8px">
        <textarea id="monItemSummary" placeholder="핵심 내용 메모" style="width:100%;min-height:88px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px;font-family:inherit"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" onclick="monAddItem()">등록</button></div>
      </div>
    </div>
    <div class="panel"><h3><span class="icon" style="background:var(--orange)"></span>승인 대기 큐</h3><div id="monPendingList"></div></div>
    <div class="panel"><h3><span class="icon" style="background:var(--accent2)"></span>발송/보류 이력</h3><div id="monHistoryList"></div></div>`;
  };
  window.initMonitoring=function(){renderClients();renderItems()};
  window.monClientAutoComplete=function(){
    const input=document.getElementById('monClientName');
    const ac=document.getElementById('monClientAC');
    if(!input||!ac)return;
    const raw=input.value.trim();
    const q=raw.toLowerCase().replace(/\s+/g,'');
    const selected=new Set(load().clients.map(c=>c.name));
    if(!q){ac.style.display='none';return}
    const pool=campNames();
    const matches=pool.filter(n=>n.toLowerCase().replace(/\s+/g,'').includes(q)).slice(0,15);
    if(!matches.length){ac.innerHTML='<div style="padding:12px 14px;color:var(--text2);font-size:13px">검색 결과가 없습니다. 거래처 목록/정산 데이터를 먼저 불러왔는지 확인해주세요.</div>';ac.style.display='block';return}
    ac.innerHTML=matches.map(n=>{const d=clientData(n);const registered=selected.has(n);return `<div style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);color:var(--text)" onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''" onclick="monPickClient('${esc(n)}')"><strong style="font-size:13px">${esc(n)}</strong>${registered?' <span class="tag tag-blue">등록됨</span>':''}<div style="font-size:11px;color:var(--text2);margin-top:3px">${esc(d.region||'지역 정보 없음')} · ${esc(d.plan)} · 최근 ${fmtMoney(d.pay)}</div></div>`}).join('');
    ac.style.display='block';
  };
  window.monPickClient=function(name){const input=document.getElementById('monClientName');const ac=document.getElementById('monClientAC');if(input)input.value=name;if(ac)ac.style.display='none'};
  window.monAddClient=function(){const el=document.getElementById('monClientName');const name=(el?.value||'').trim();if(!name)return alert('캠핑장명을 입력해주세요.');const s=load();if(s.clients.some(c=>c.name===name))return alert('이미 등록된 거래처입니다.');s.clients.push({name,keywords:[name],active:true,createdAt:today()});save(s);renderTab('monitoring')};
  window.monRemoveClient=function(name){if(!confirm(name+' 모니터링을 해제할까요?'))return;const s=load();s.clients=s.clients.filter(c=>c.name!==name);save(s);renderTab('monitoring')};
  window.monOpenSearch=function(name,type){const c=load().clients.find(x=>x.name===name);if(!c)return;window.open(searchUrls(c)[type]||searchUrls(c).blog,'_blank','noopener')};
  window.monOpenBatchSearch=function(){load().clients.filter(c=>c.active!==false).slice(0,5).forEach((c,i)=>setTimeout(()=>window.open(searchUrls(c).blog,'_blank','noopener'),i*250))};
  window.monAddItem=function(){const client=document.getElementById('monItemClient')?.value;const title=(document.getElementById('monItemTitle')?.value||'').trim();const url=(document.getElementById('monItemUrl')?.value||'').trim();const summary=(document.getElementById('monItemSummary')?.value||'').trim();const source=document.getElementById('monItemSource')?.value||'웹';if(!client||!title)return alert('거래처와 제목은 필수입니다.');const s=load();if(url&&s.items.some(i=>i.url===url))return alert('이미 등록된 URL입니다.');s.items.unshift({id:'mon_'+Date.now(),client,title,url,summary,source,date:today(),sentiment:classify(title,summary),status:'pending'});save(s);renderTab('monitoring')};
  window.monCopyMessage=function(id){const i=load().items.find(x=>x.id===id);if(!i)return;navigator.clipboard.writeText(kakaoMessage(i)).then(()=>alert('카카오톡에 붙여넣을 문안을 복사했습니다.'))};
  window.monMark=function(id,status){const s=load();const i=s.items.find(x=>x.id===id);if(!i)return;i.status=status;if(status==='sent')i.sentAt=today();if(status==='skipped')i.skippedAt=today();s.logs.unshift({id:'log_'+Date.now(),itemId:id,client:i.client,status,date:today()});save(s);renderTab('monitoring')};
  window.monDeleteItem=function(id){if(!confirm('이 모니터링 항목을 삭제할까요?'))return;const s=load();s.items=s.items.filter(i=>i.id!==id);save(s);renderTab('monitoring')};
  window.monExport=function(){const blob=new Blob([JSON.stringify(load(),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='client-monitoring-'+today()+'.json';a.click();URL.revokeObjectURL(a.href)};
  function renderClients(){const el=document.getElementById('monClientList');if(!el)return;const s=load();el.innerHTML=s.clients.map(c=>{const d=clientData(c.name);return `<div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;background:var(--bg)"><div style="display:flex;justify-content:space-between;gap:10px"><div><strong>${esc(c.name)}</strong><div style="color:var(--text2);font-size:11px;margin-top:3px">${esc(d.region)} · ${esc(d.plan)} · 최근 ${fmtMoney(d.pay)}</div></div><button class="btn-del" onclick="monRemoveClient('${esc(c.name)}')">해제</button></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px"><button class="btn" style="background:var(--card2);color:var(--text);font-size:11px" onclick="monOpenSearch('${esc(c.name)}','blog')">블로그</button><button class="btn" style="background:var(--card2);color:var(--text);font-size:11px" onclick="monOpenSearch('${esc(c.name)}','news')">뉴스</button><button class="btn" style="background:var(--card2);color:var(--text);font-size:11px" onclick="monOpenSearch('${esc(c.name)}','google')">구글</button></div></div>`}).join('')||'<div style="color:var(--text2);text-align:center;padding:24px">등록된 거래처가 없습니다.</div>'}
  function itemCard(i,history){const tag=i.sentiment==='주의'?'tag-red':i.sentiment==='긍정'?'tag-green':'tag-blue';const text=esc(kakaoMessage(i)).replace(/\n/g,'<br>');return `<div style="border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:10px;background:${history?'var(--bg)':'rgba(245,158,11,.06)'}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><strong>${esc(i.client)}</strong> <span class="tag ${tag}">${esc(i.sentiment)}</span> <span style="color:var(--text2);font-size:11px">${esc(i.date)} · ${esc(i.source)}</span><div style="margin-top:7px"><a class="camp-link" target="_blank" rel="noopener" href="${esc(i.url||'#')}">${esc(i.title)}</a></div><p style="color:var(--text2);font-size:12px;line-height:1.55;margin-top:6px;white-space:normal">${esc(i.summary||'메모 없음')}</p></div><button class="btn-del" onclick="monDeleteItem('${i.id}')">삭제</button></div><details style="margin-top:10px"><summary style="cursor:pointer;color:var(--accent);font-size:12px;font-weight:700">카카오 발송 문안 보기</summary><div class="msg-template" style="white-space:normal;margin-top:8px">${text}</div></details>${history?`<div style="margin-top:10px;color:var(--text2);font-size:12px">상태: ${i.status==='sent'?'발송완료 '+esc(i.sentAt||''):'보류 '+esc(i.skippedAt||'')}</div>`:`<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn btn-primary" onclick="monCopyMessage('${i.id}')">문안 복사</button><button class="btn btn-green" onclick="monMark('${i.id}','sent')">발송완료</button><button class="btn" style="background:var(--card2);color:var(--text)" onclick="monMark('${i.id}','skipped')">보류</button></div>`}</div>`}
  function renderItems(){const s=load();const pending=document.getElementById('monPendingList');const history=document.getElementById('monHistoryList');if(!pending||!history)return;const p=s.items.filter(i=>i.status==='pending');const h=s.items.filter(i=>i.status!=='pending').slice(0,20);pending.innerHTML=p.map(i=>itemCard(i,false)).join('')||'<div style="color:var(--text2);text-align:center;padding:26px">승인 대기 항목이 없습니다. 오늘 검색을 열어 새 글을 등록하세요.</div>';history.innerHTML=h.map(i=>itemCard(i,true)).join('')||'<div style="color:var(--text2);text-align:center;padding:22px">아직 발송/보류 이력이 없습니다.</div>'}
})();





