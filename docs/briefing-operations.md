# 거래처 브리핑 운영

대상 서비스: https://camfit-md-dashboard-phj.web.app/

## 실행

    node scripts/refresh-briefing.cjs

저장 없이 계산한다. 다음 명령은 본인 Firebase 계정의 브리핑만 갱신한다.

    node scripts/refresh-briefing.cjs --write

한국시간 목요일에는 자동으로 정산 요약 모드를 사용하며 --weekly 로도 지정할 수 있다.
매일 한국시간 오전 9시 현재 대화의 예약 실행에서 위 명령을 실행하고 결과를 사용자에게 알려준다.
로컬 실행 환경과 기존 Firebase 로그인이 필요하다. PC/앱 미실행, 네트워크/인증 문제로
실행하지 못하면 최신화됐다고 표시하지 않는다. 앱 예약 실행은 서버 상시 실행을 대체하지 않는다.

## 데이터와 개인정보

- 관리자 본인 이메일을 Firebase Auth의 정상 계정 조회로 확인한 뒤 해당 UID만 조회한다.
- CLI의 이미 구성된 Firebase 로그인만 사용한다. 비밀값을 직접 읽거나 출력하지 않는다.
- 원천: users/{uid}/dashboard/meta, users/{uid}/dashboardChunks.
- 생성 결과: users/{uid}/briefing/latest, users/{uid}/briefingChunks.
- 원천 정산 데이터는 갱신 스크립트에서 수정하지 않는다.
- 원천/이전 보고서가 갱신 중이면 조건부 쓰기로 중단한다. 불완전한 조각은 사용하지 않는다.
- 자료와 생성 결과는 정적 웹 호스팅, 소스 저장소, 외부 API에 업로드하지 않는다.
- 원천이 전일과 같으면 신규 변동처럼 알리지 않는다. 원천 저장 시각과 비교 기간을 표시한다.

## 계산 기준

- 월별 RS 그래프는 ONLINE_RS와 onlineRsAggregate를 온라인 RS 분석과 공용으로 사용한다.
- 매출은 정산의 결제금액에서 환불금액을 뺀 값이다. RS와 매출을 혼동하지 않는다.
- 주간 원장 settlements가 있으면 최근 정산일 기준 7일과 직전 7일을 비교한다.
- 주간 원장이 없으면 종료된 최근 달과 직전 달을 비교한다. 현재 월만 있으면 비교를 보류한다.
- 업체별 기간 내역이 없으면 0원/-100%로 추정하지 않는다.
- 누적 리뷰 수 증가는 목록 스냅샷의 차이일 뿐, 새 리뷰 본문 확인을 의미하지 않는다.
- 리뷰 본문·사진·이벤트는 미연동 상태다. 공개 캠핏 페이지 접근 확인에 막혔으므로
  추가 요청 없이 토큰, 쿠키, 브라우저 우회 등 다른 접근 경로를 시도하지 않는다.
  사용자에게 승인된 API/내보내기 자료 연동 방향을 확인한 뒤 확장한다.

## 공개 블로그·후기 검색

매일 매출 감소 상위 5곳과 날짜별 순환 5곳을 검색 대상으로 제시한다. 전체 1,007곳을 매일
검색한 것으로 보고하지 않는다. 검색 시 공개 거래처명·주소·캠핏 링크만 이용하고 내부 매출은
검색엔진이나 외부 서비스에 전송하지 않는다.

    node scripts/refresh-briefing.cjs --candidates

공개 검색으로 이름과 지역/주소가 일치하는 글을 찾고 원문을 확인한다. 실제 방문 후기와
소개·추천글을 구분하고, 작성일이 30일 넘은 글은 과거 참고로 표시한다. 검색 목록만 확인한
네이버 글은 원문 확인으로 표시하지 않는다. 같은 글의 재배포는 중복 제외한다. 이번 검색에서
찾지 못한 경우 후기 없음으로 단정하지 않는다. 접근 제한은 우회하지 않는다.

확인한 출처 배열을 아래 명령의 표준입력에 UTF-8 JSON으로 전달한다. 파일에 원천 거래처
목록을 저장하거나 정적 호스팅에 올리지 않는다. 저장은 기존 비공개 브리핑 컬렉션에만 한다.

    node scripts/refresh-briefing.cjs --write --sources-stdin

각 항목 필드:

~~~
{
  "campUrl": "원천 거래처의 https 캠핏 URL",
  "url": "공개 글 원문 https URL",
  "title": "글 제목",
  "publishedAt": "YYYY-MM-DD",
  "checkedAt": "실제 확인 ISO 시각",
  "kind": "방문 후기 / 소개·추천글 / 공식 공지 중 하나",
  "summary": "캠핑장 관련 내용만 짧은 자체 요약. 원문 미확인은 그 사실 명시",
  "verification": "read 또는 indexed",
  "evidenceUrl": "indexed일 때 실제 확인한 검색 목록 페이지 URL 필수",
  "identityEvidence": "거래처 이름 및 지역/주소 일치 근거"
}
~~~

출처는 다음 새로고침에도 보존된다. 다시 읽지 않은 글의 checkedAt을 바꾸지 않는다.
외부 글의 사진을 캠핏 대표 사진 변경으로 처리하거나 후기가 매출 감소 원인이라고 단정하지
않는다. 별도 검색 결과가 없거나 검색 실패여도 정산 브리핑 갱신은 진행하되 확인 범위를 알린다.

## 승인된 캠핏 직접 자료의 향후 연결 형식

사용자가 연동을 승인한 자료만 원천 payload의 briefingSignals에 저장한다.
키는 거래처의 정상 URL이며 값은 아래 명시적 스키마를 사용한다. 이 스키마를 구현했다는 것만으로
실제 외부 연결이 완료된 것은 아니다.

~~~
{
  sourceUrl: "https://허용된-출처",
  collectedAt: "ISO timestamp",
  reviews: {status: "ok", items: [{date: "ISO timestamp", text: "...", rating: 5, url: "https://..."}]},
  photos: {status: "ok", urls: ["https://..."]},
  events: {status: "ok", items: [{title: "...", start: "YYYY-MM-DD", end: "YYYY-MM-DD", url: "https://..."}]}
}
~~~

출처/수집일이 없거나 7일 이상 지난 자료는 미연동으로 처리한다. 사진은 첫 확인 시 비교 기준만
저장하며, 수집 실패 시 이전 정상 비교 기준을 지우지 않는다. 이벤트는 시작/종료일이 확인되는
현재 진행 중 항목만 포함한다. 시간 경과만으로 원천 정보가 새로 수집된 것처럼 표시하지 않는다.

## 검증·배포

    node --test tests/briefing.test.cjs
    node scripts/verify-live.cjs
    node node_modules/firebase-tools/lib/bin/firebase.js deploy --only hosting --project camfit-md-dashboard-phj --non-interactive

별도 Firebase 프로젝트 생성, 공개 접근 규칙 변경, 서버 유료 플랜 변경은 하지 않는다.
배포 전 현재 서비스가 작업 기준 커밋과 일치하는지 확인한다. 공개 호스팅에서 scripts/tests/docs/
node_modules 및 비밀·데이터 파일이 제외돼 있는지 검사한다.
