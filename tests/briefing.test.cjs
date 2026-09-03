'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../briefing-core.js');
const NOW='2026-09-03T06:00:00Z',SOURCE='2026-09-03T05:00:00Z';
const row=(y,m,name,pay,refund=0)=>[y,m,name,1,pay,refund,0,0,0,0,0,999999,777777,999999];
function sample(){return{raw:{camps:[{n:'A',rv:12,l:'https://camfit.co.kr/camp/a'},{n:'B',rv:0},{n:'C',rv:3}],monthly:[row(2026,7,'A',100,10),row(2026,8,'A',60,10),row(2026,7,'B',0),row(2026,8,'B',100),row(2026,7,'C',40),row(2026,9,'A',1)]},onlineRS:[]};}
function build(p=sample(),prev){return core.build(p,prev,{now:NOW,sourceUpdatedAt:SOURCE});}
function issueRow(name,sales={}){
  return{name,sales:{current:null,previous:null,diff:null,rate:null,state:'unavailable',...sales},reviews:{status:'not_connected',delta:null,items:[]},photos:{status:'not_connected'},events:{status:'not_connected',items:[]},mentions:[]};
}
const issueReport=rows=>({rows,sourceUpdatedAt:SOURCE,period:{kind:'month',current:'2026-08',incomplete:false}});
test('issue-free, missing, first baseline, small swings and indexed old posts are excluded',()=>{
  const rows=[issueRow('missing'),issueRow('small',{diff:-99999,rate:-99}),issueRow('stable',{diff:999999,rate:10})];
  rows[0].photos={status:'baseline',checkedAt:SOURCE,count:1};
  rows[0].mentions=[{verification:'indexed',publishedAt:'2026-09-02',checkedAt:SOURCE},{verification:'read',publishedAt:'2025-09-02',checkedAt:SOURCE}];
  assert.equal(core.selectBriefingRows(issueReport(rows),NOW).length,0);
  assert.equal(build().report.summary.briefingCount,0);
});
test('priority sorts urgent first then material impact, with explicit reasons',()=>{
  const rows=[issueRow('growth',{diff:9000000,rate:50}),issueRow('moderate',{diff:-500000,rate:-30}),issueRow('urgent small',{diff:-1200000,rate:-60}),issueRow('urgent large',{diff:-5000000,rate:-60})];
  const selected=core.selectBriefingRows(issueReport(rows),NOW);
  assert.deepEqual(selected.map(r=>r.name),['urgent large','urgent small','moderate','growth']);
  selected.forEach(r=>assert.ok(r.priority.reasons.length));
});
test('null rating is not negative; low review is urgent; expired signals disappear',()=>{
  const r=issueRow('reviews');r.reviews={status:'ok',checkedAt:SOURCE,items:[{date:'2026-09-02',text:'내용',rating:null}]};
  assert.equal(core.selectBriefingRows(issueReport([r]),NOW)[0].priority.level,1);
  r.reviews.items[0].rating=2;
  assert.equal(core.selectBriefingRows(issueReport([r]),NOW)[0].priority.level,3);
  assert.equal(core.selectBriefingRows(issueReport([r]),'2026-09-20T06:00:00Z').length,0);
});
test('photo changes, ending events, recent verified external posts qualify; stale sales do not',()=>{
  const photo=issueRow('photo');photo.photos={status:'ok',checkedAt:SOURCE,added:[],removed:[],mainChanged:true};
  const event=issueRow('event');event.events={status:'ok',checkedAt:SOURCE,items:[{start:'2026-09-01',end:'2026-09-05',title:'행사'}]};
  const post=issueRow('post');post.mentions=[{verification:'read',publishedAt:'2026-09-02',checkedAt:SOURCE}];
  const selected=core.selectBriefingRows(issueReport([photo,event,post]),NOW);
  assert.equal(selected.length,3);assert.equal(selected[0].name,'event');
  const stale=issueReport([issueRow('stale',{diff:-5000000,rate:-80})]);stale.period.current='2026-06';
  assert.equal(core.selectBriefingRows(stale,NOW).length,0);
});
test('new revenue and recent cumulative review changes expire or qualify independently',()=>{
  const r=issueRow('new',{current:100000,previous:0,diff:100000,rate:null,state:'new'});
  assert.deepEqual(core.selectBriefingRows(issueReport([r]),NOW)[0].priority.types,['growth']);
  const count=issueRow('count');count.reviews.delta=1;
  assert.equal(core.selectBriefingRows(issueReport([count]),NOW).length,1);
  assert.equal(core.selectBriefingRows(issueReport([count]),'2026-09-20T06:00:00Z').length,0);
});
test('external posts retain real checked dates, verification and history without implying photo changes',()=>{
  const item={title:'후기',url:'https://example.com/post',publishedAt:'2026-08-25',checkedAt:'2026-09-03T05:00:00Z',kind:'소개·추천글',summary:'요약',verification:'indexed',evidenceUrl:'https://example.com/list'};
  const externalSources={'https://camfit.co.kr/camp/a':[item,{...item,url:'https://example.com/old',publishedAt:'2025-05-20'},{...item,url:'javascript:alert(1)'},{...item,url:'https://example.com/future',publishedAt:'2027-01-01'}]};
  const first=core.build(sample(),undefined,{now:NOW,sourceUpdatedAt:SOURCE,externalSources});
  const a=first.report.rows.find(r=>r.name==='A');
  assert.equal(a.mentions.length,2);assert.equal(a.mentions[0].recent,true);assert.equal(a.mentions[1].recent,false);
  assert.equal(a.mentions[0].verification,'indexed');assert.equal(a.photos.status,'not_connected');
  assert.equal(first.report.summary.externalCamps,1);assert.equal(first.report.summary.recentMentions,1);
  const again=core.build(sample(),first.snapshot,{now:'2026-10-03T06:00:00Z'});
  assert.equal(again.report.rows.find(r=>r.name==='A').mentions[0].checkedAt,item.checkedAt.replace('Z','.000Z'));
  assert.equal(again.report.summary.recentMentions,0);
});
test('completed calendar month, net sales, missing row never false -100%',()=>{
  const r=build().report;assert.equal(r.period.current,'2026-08');assert.equal(r.period.previous,'2026-07');
  const a=r.rows.find(r=>r.name==='A');assert.equal(a.sales.current,50);assert.equal(a.sales.previous,90);assert.equal(a.sales.state,'decline');
  assert.equal(r.rows.find(r=>r.name==='B').sales.state,'new');assert.equal(r.rows.find(r=>r.name==='C').sales.rate,null);
});
test('non-adjacent months and partial months do not produce misleading comparisons',()=>{
  const p=sample();p.raw.monthly=[row(2026,6,'A',100),row(2026,8,'A',20)];
  assert.equal(build(p).report.rows[0].sales.rate,null);
  p.raw.monthly=[row(2026,9,'A',10)];
  assert.equal(build(p).report.period.incomplete,true);assert.equal(build(p).report.rows[0].sales.rate,null);
});
test('weekly settlement records take precedence; duplicate month does not enter comparison',()=>{
  const p=sample();p.settlements={A:[{date:'2026.08.26',pay:100,refund:10},{date:'2026.09.02',pay:70,refund:10}]};
  const r=build(p).report;assert.equal(r.period.kind,'week');assert.equal(r.rows.find(x=>x.name==='A').sales.diff,-30);
});
test('unconnected data never reports verified no-change/no-events',()=>{
  const r=build().report;assert.equal(r.summary.unconnected,3);
  r.rows.forEach(x=>{assert.equal(x.reviews.status,'not_connected');assert.equal(x.photos.status,'not_connected');assert.equal(x.events.status,'not_connected');assert.equal(x.reviews.delta,null);});
});
test('review baseline and repeated refresh preserve observed count change',()=>{
  const p=sample(),initial=core.build(p,undefined,{now:NOW,sourceUpdatedAt:'2026-09-02T00:00:00Z'});
  p.raw.camps[0].rv=15;
  const updated=build(p,initial.snapshot);
  assert.equal(updated.report.rows.find(x=>x.name==='A').reviews.delta,3);
  assert.equal(build(p,updated.snapshot).report.rows.find(x=>x.name==='A').reviews.delta,3);
});
test('verified feeds require source, freshness and event dates; first photos establish baseline',()=>{
  const p=sample(),key=core.campKey(p.raw.camps[0]);
  p.briefingSignals={[key]:{sourceUrl:key,collectedAt:SOURCE,reviews:{status:'ok',items:[{date:'2026-09-02',text:'좋아요'},{date:'2025-01-01',text:'old'}]},photos:{status:'ok',urls:['https://example.com/1.jpg']},events:{status:'ok',items:[{title:'진행',start:'2026-09-01',end:'2026-09-10'},{title:'만료',start:'2026-08-01',end:'2026-08-20'}]}}};
  const first=build(p),a=first.report.rows.find(r=>r.name==='A');assert.equal(a.photos.status,'baseline');assert.equal(a.events.items.length,1);assert.equal(a.reviews.items.length,1);
  p.briefingSignals[key].collectedAt='2026-09-03T05:30:00Z';p.briefingSignals[key].photos.urls=['https://example.com/2.jpg'];
  const second=build(p,first.snapshot),b=second.report.rows.find(r=>r.name==='A');assert.equal(b.photos.mainChanged,true);assert.equal(b.photos.removed.length,1);
  const third=build(p,second.snapshot);assert.equal(third.report.rows.find(r=>r.name==='A').photos.mainChanged,true);
  p.briefingSignals[key].collectedAt='2026-08-01T00:00:00Z';assert.equal(build(p,third.snapshot).report.rows.find(r=>r.name==='A').photos.status,'not_connected');
});
test('Korea daily/Thursday 09:00 schedule works across timezone boundary',()=>{
  assert.equal(core.nextDaily('2026-09-02T23:59:00Z'),'2026-09-03T00:00:00.000Z');
  assert.equal(core.nextDaily('2026-09-03T00:00:00Z'),'2026-09-04T00:00:00.000Z');
  assert.equal(core.nextThursday('2026-09-03T00:00:00Z'),'2026-09-10T00:00:00.000Z');
  assert.equal(core.nextThursday('2026-09-02T23:59:00Z'),'2026-09-03T00:00:00.000Z');
});
test('invalid dates and unsafe links are rejected',()=>{
  assert.equal(core.settledDate('2026-02-30'),null);assert.equal(core.safeUrl('javascript:alert(1)'), '');
  assert.equal(core.safeUrl('https://user:password@example.com'),'');
  assert.equal(core.build(sample(),{}, {now:NOW,sourceUpdatedAt:null}).report.sourceUpdatedAt,null);
});
test('weekly online RS totals use settlement dates, excluding future entries',()=>{
  const p={onlineRS:[['x','2026.08.26','A','',100],['x','2026.09.02','A','',150],['x','2026.09.02','B','',30],['x','2026.09.09','A','',1000]]};
  const r=core.onlineRsSummary(p,NOW);assert.equal(r.current,180);assert.equal(r.previous,100);assert.equal(r.rate,80);
});
const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
test('all dashboard scripts compile',()=>{
  for(const [,script] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script);
  new vm.Script(fs.readFileSync(require.resolve('../briefing-ui.js'),'utf8'));
});
function rsContext(rows){
  const section=html.slice(html.indexOf('function dashboardCurrentYear()'),html.indexOf('function onlineRsRateMatch('));
  const normal=html.slice(html.indexOf('function excelSerialToDateString('),html.indexOf('function getCellByHeaders('));
  const chart=html.slice(html.indexOf('function renderOverviewCharts(){'),html.indexOf('// 종합현황 매출/RS 필터 테이블'));
  const ctx=vm.createContext({ONLINE_RS:rows,Date,charts:{},Chart:function(el,config){Object.assign(this,config);},document:{getElementById:id=>({id})},activeMonthly:()=>[{y:2026,m:8,pay:100,fmd:9000,rmd:8000,hmd:7000}],activeCamps:()=>[],renderOvRS:()=>{},fmt:String,fmtN:String});
  vm.runInContext(normal+section+chart,ctx);return ctx;
}
test('plotted monthly RS equals online analysis totals, not fmd+rmd+hmd',()=>{
  const ctx=rsContext([['w1','2026.07.01','A','',100],['w2','2026.07.08','B','',20],['w3','2026.08.05','A','',150],['w3','2026.08.05','B','',-10]]);
  const points=vm.runInContext('onlineRsMonthlyTrend()',ctx);assert.deepEqual(JSON.parse(JSON.stringify(points)),[{period:'2026-07',rs:120},{period:'2026-08',rs:140}]);
  vm.runInContext('renderOverviewCharts()',ctx);
  assert.deepEqual(Array.from(ctx.charts.ch2.data.datasets[0].data),[120,140]);
  assert.deepEqual(Array.from(ctx.charts.ch2.data.labels),['2026-07','2026-08']);
});
test('RS chart stays empty when online RS is empty (no estimated fallback)',()=>{
  const ctx=rsContext([]);vm.runInContext('renderOverviewCharts()',ctx);assert.equal(ctx.charts.ch2.data.labels.length,0);
});
test('UI escapes untrusted text; settlement merging is idempotent',()=>{
  const ctx=vm.createContext({BriefingCore:core,console});
  vm.runInContext(fs.readFileSync(require.resolve('../briefing-ui.js'),'utf8'),ctx);
  assert.equal(vm.runInContext('briefEsc("<img onerror=x>")',ctx),'&lt;img onerror=x&gt;');
  const result=vm.runInContext("mergeBriefingSettlements({A:[{period:'w',date:'2026.09.02',pay:1}]},{A:[{period:'w',date:'2026-09-02',pay:2}]})",ctx);
  assert.equal(result.A.length,1);assert.equal(result.A[0].pay,2);
});
test('server scripts and tests are excluded from public hosting',()=>{
  const config=JSON.parse(fs.readFileSync(require.resolve('../firebase.json'),'utf8'));
  ['scripts/**','tests/**','node_modules/**','package.json','pnpm-lock.yaml'].forEach(x=>assert.ok(config.hosting.ignore.includes(x)));
});
test('card renderer excludes quiet clients in every filter and explains importance',()=>{
  const report=issueReport([issueRow('조용한 업체'),issueRow('중요 업체',{current:1000000,previous:3000000,diff:-2000000,rate:-66.7})]);
  const elements={briefCards:{innerHTML:'',insertAdjacentHTML(){}},briefSearch:{value:''},briefFilter:{value:'all'},briefCount:{}};
  const ctx=vm.createContext({BriefingCore:{...core,selectBriefingRows:r=>core.selectBriefingRows(r,NOW)},isHidden:()=>false,document:{getElementById:id=>elements[id]},report});
  vm.runInContext(fs.readFileSync(require.resolve('../briefing-ui.js'),'utf8'),ctx);
  vm.runInContext('briefingState={report};renderBriefingCards()',ctx);
  assert.match(elements.briefCards.innerHTML,/중요 업체/);assert.doesNotMatch(elements.briefCards.innerHTML,/조용한 업체/);
  assert.match(elements.briefCards.innerHTML,/우선 확인/);
  elements.briefFilter.value='reviews';
  vm.runInContext('renderBriefingCards()',ctx);
  assert.doesNotMatch(elements.briefCards.innerHTML,/<article/);assert.match(elements.briefCards.innerHTML,/주요 이슈가 없습니다/);
});
