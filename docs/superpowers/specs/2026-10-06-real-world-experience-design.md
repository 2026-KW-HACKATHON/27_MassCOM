# MassCOM 실사용 연결 전면 개편 설계

상태: 구현 기준. 사용자 원문은 [전체 요청](2026-10-06-real-world-request.md). 기준 main `b69ebc621a3dc6f237829d46cc2b4de3105b8ca8`, 브랜치 `feat/real-world-experience`, Android Expo57/RN0.86 및 시연 웹. 단계는 실행 분담이며 요청 16절을 줄이지 않는다. 일반 설계·데이터·의존성·자산·검증 선택은 사용자에게 위임받았다. 계약·별도 계정 접근·유료 사용·실제 제휴·공개 출시만 외부 결정이다.

## 현재 문제와 재사용

기존 지도는 가게 ID 해시를 그림의 8칸에 놓고 외부 길찾기는 주소 검색이다. 공개 DTO에 좌표가 없으며 전체 GET /merchants를 목록/지도/상세가 각각 읽는다. 카탈로그는 ACTIVE 공개 캠페인과 INNER JOIN하여 캠페인이 끝나면 실제 가게도 사라진다. 선택/필터는 화면 상태이고 상세의 merchantId를 claim 경로가 읽지 않는다. 기존 영업시간은 문장이다.

최근 짧은 홈, 네 V2 게임 규칙, 소유 수집품·연습 자산, 공통 장비, 친구/우편, 공유, 점주 연장/직원/CSV/알림 및 방문·쿠폰의 트랜잭션·역할 검사는 재사용한다. 게임 RAF는 배경/결과에서도 돌고 StudioCoin은 상세와 재질이 다르다. 실제 소리 청음 PASS, 진동 체감 FAIL을 그대로 출발점으로 쓴다.

## 정보 구조와 디자인

하단은 `탐색 · 도감 · 홈 · 놀이 · 상점`. 이번 사용자 요청의 중복 역할 통합·전체 재구성에 따라 이전 두 상점 탭을 통합한다. 홈 중앙과 짧은 네 목적별 진입은 유지한다. 기존 shop-again 링크는 상점으로, /map은 실제 탐색 지도 모드로 호환한다. 탐색은 지도/목록이 같은 query/filter/selection/camera 상태를 소유한다.

탐색은 기준 위치와 가게 선택, 상세는 방문 결정과 도착 준비, claim은 직원 확인, 도감은 권리와 획득 방법, 전시는 감상/꾸미기, 놀이는 멈춰서 하는 게임이다. 실제 지도/인증/쿠폰에는 담백한 정보 패널을, 수집/코인/동행에는 기존 수채화·재질·동작을 쓴다. 사진 자리를 예약하고 48dp, 200% 글씨, TalkBack, 저동작, 키보드/지도/패널 충돌을 검사한다. 실제 가게 사진과 AI 수집품 그림은 명시적으로 구별한다.

## 제공자와 네이티브

TMAP을 단일 지도/장소/지오코딩/보행 제공자로 우선 선택한다. [약관](https://tmapapi.tmapmobility.com/terms.html), [보행 경로](https://tmap-skopenapi.readme.io/reference/%EB%B3%B4%ED%96%89%EC%9E%90-%EA%B2%BD%EB%A1%9C%EC%95%88%EB%82%B4), [Android API](https://tmapapi.tmapmobility.com/androidVSM/docs/androidDoc.html), [웹 SDK](https://tmapapi.tmapmobility.com/webv3VSM/guide/webGuide.html). 네이버 driving을 walking으로 쓰지 않으며 카카오 게임/리워드 제한은 임의 해석해 우회하지 않는다.

Android는 기존 modules/studio-video처럼 작은 Expo native View로 TMapView를 감싼다. 실제 v3.7 공식 AAR 두 개를 확인했다. SDK ZIP SHA256 `513a1c170487306d62bb7dbb48604ecb73e61be3156ede1a892188ea49d9e008`, tmap AAR `fa1aee4c1cd9f484b67fdd510f42d6ef42bcdd8997b55aa7e2e54b9ac34979a9`, VSM AAR `62df36369e356cb28408cebfb653beddc304c7df44eca45181b6a0ad06f72b3d`. API24/OpenGL ES2/arm64 지원. 샘플의 잘못된 3.6 파일명·QUERY_ALL_PACKAGES·hardwareAccelerated=false는 복사하지 않는다. 공식 내려받기와 해시 검사 스크립트를 제공하고 AAR/서명 URL/키는 Git에 넣지 않는다. SDK 포함 앱의 공개 배포는 약관/계정/키 제한 확인 후 별도다.

Map props: camera `{latitude,longitude,zoom}`, markers `{id,latitude,longitude,title,state}`, selectedId, route GeoJSON, panel padding, active. Events: ready, sanitized error, idle bounds/zoom, merchantId, cluster leaf IDs. 생명주기 onResume/onPause/onDestroy를 focus/AppState에 연결한다. Android SDK는 lat/lon, REST x/y와 GeoJSON은 lon/lat이므로 경계에서 변환한다. 웹은 공식 SDK를 직접 사용한다. 모바일을 WebView로 대체하지 않는다. 실제 대상이 아닌 iOS는 NOT_RUN으로 분리한다.

## 영속 위치와 외부 데이터

`Point={latitude:number,longitude:number}`. finite, 위도[-90,90], 경도[-180,180], 양쪽 존재를 검사하며 값을 자동 교환하지 않는다. 한국 범위 밖은 검토 대상이다. MassCOM merchantId와 provider placeId를 합치지 않는다.

영속 `OwnedLocation`: building Point, entrance Point|null, floor/unit/entranceNote, source OWNER_DECLARED|OWNER_MEASURED|ADMIN_DOCUMENTED, verifiedAt. 출처와 실제 지점/입구 확인 증거를 점주가 제공한다. TMAP 결과 확인 클릭·핀 미세 이동만으로 독립 출처로 승격하지 않는다.

TMAP POI/geocode/route 후보는 provider/fetchedAt/expiresAt/attribution을 갖고 24시간 미만으로 만료된다. placeId와 provider 좌표도 같은 규칙을 적용한다. API-derived 결과와 independently supplied 위치를 분리하며 보관 허용을 임의 추정하지 않는다. 좌표가 없으면 주소 목록의 `위치 확인 필요`, 지도/코스 제외이며 가짜 좌표를 채우지 않는다. 모호한 geocode는 후보 검토로, 기존 데이터 backfill은 dry-run→승인된 운영 작업으로 분리한다.

사용자가 내 위치를 누를 때 설명→foreground 권한→일회 조회. denied/services-off/approximate/stale/low-accuracy/available을 구분한다. 수동 지역/원점은 항상 가능하다. GPS 좌표·궤적은 영속 저장/친구공개/로그/통계에 넣지 않는다. 위치 UI를 떠나면 감시/렌더를 종료한다. 재시작 시 이전 GPS를 현재 위치로 쓰지 않는다.

## 신규 공개 계약과 서버 경계

구형 GET /merchants와 필수 campaign 응답 의미는 유지한다. 신규 버전드 discovery는 게시된 가게를 공개하며 campaign nullable이다. 개인 쿠폰 권리는 기존 인증 API에서 조회한다.

공유 타입은 `apps/api/src/real-world-contract.ts`가 정본이고 앱/웹이 같은 필드/상태를 사용한다. 응답은 schemaVersion:1/asOf. MerchantSummary는 id/name/address/category/demo/profileVersion/position/location source expiry/photo/business/campaign/straight-line distance를 포함한다. Detail은 legacyBusinessHours, schedule, todayOverride, 메뉴/가격/사진 연결, 실제 사진, 연락/출입구/방문조건/수정시각을 추가한다.

영업 상태 OPEN/CLOSED/BREAK/UNKNOWN 및 basis SCHEDULE/OWNER_OVERRIDE/UNKNOWN, acceptingOrders/lastOrder/nextChange를 계산한다. 캠페인 SCHEDULED/ACTIVE/PAUSED/ENDED, enrollment OPEN/FULL/CLOSED, reward AVAILABLE/EXHAUSTED/NOT_RUNNING/UNKNOWN은 별도다. 가게 영업·캠페인·신규 발급·기존 쿠폰을 혼동하지 않는다. 최종 방문/발급은 기존 거래 서비스가 결정한다.

| 경로 | 계약 |
| --- | --- |
| POST /v1/discovery/search | bounds west/south/east/north, zoom, query/category/campaignOnly/openOnly/visited/interest, origin, cursor, limit → merchants/clusters/nextCursor/unlocatedCount. 최대 페이지100, 계속 페이지와 줌 수준을 사용하고 전체 가게를 고정 소수로 숨기지 않음 |
| GET /v1/discovery/merchants/:id | published detail, 종료 캠페인도 표현, 미게시/다른 임시 체험 점포404 |
| POST /v1/discovery/places/search | query/bounds/cursor → transient 일반 장소, EXTERNAL_PLACE 표시·보상참여자동등록 없음 |
| POST /v1/discovery/walking-routes | origin, 순서 있는 merchantIds<=5, departureAt, dwellMinutes → 실제 WALK geometry/구간별 이동거리·초/머무름·도착영업경고/TTL |
| POST /v1/discovery/events | eventId/merchantId/MAP_SELECT·DETAIL_VIEW·DIRECTIONS_OPEN·GOAL_SAVE/source만. 위치·검색문자·경로 거절, 비식별 집계 |
| POST /v1/discovery/merchants/:id/reports | 로그인된 정정접수 kind/location·hours·photo·other + note, 공식 정보 자동수정 없음 |
| GET/PUT /api/web/v1/merchant/merchants/:id/real-world-profile | 기존 세션/CSRF/역할, expectedVersion+profile, 행 잠금·409·이전 PUT의 신규필드 덮기 방지 |
| POST /api/web/v1/merchant/merchants/:id/location-candidates | transient geocode 후보, 게시/권한/영속좌표변경 없음 |
| POST/DELETE /api/web/v1/merchant/merchants/:id/photos[/:photoId] | 권한·소유·MIME·실제 decode·용량·권리확인, EXIF 제거, 원격 URL 임의 fetch 없음 |
| POST /api/web/v1/merchant/merchants/:id/reports/:reportId/resolve | 검토 이력만. 정보 수정은 검증된 profile PUT으로 |

관리자도 기존 admin 세션에 같은 서비스 검사를 연결한다. 위치가 담긴 query는 POST body로 보내고 access log에 URL로 넣지 않는다. stale 응답은 request generation/abort로 차단한다. cursor는 query/bounds/filter fingerprint에 결합한다. 넓은 범위 공간 클러스터/높은 줌 마커, 동일 건물 leaf 목록을 제공한다.

REST는 서버 TMAP provider로 요청하고 timeout/429/키없음/잘못된응답을 분리한다. 좌표·키·전체 provider 오류 로그를 남기지 않는다. 클라이언트 SDK appKey는 숨길 수 없는 식별자이고 REST와 동일 key 권한일 가능성을 명시한다. 제공자가 지원하지 않는 패키지·서명·도메인 제한을 있다고 주장하지 않는다. 무료 한도 제어와 유료자동가입 방지, attribution, 24h미만 cache가 필요하다.

## 시간표와 실제 사진

ScheduleV1 timezone Asia/Seoul, weekly ISO weekday1..7 각각 periods[]. Period startMinute0..1439, endMinute<=2880, start<end, 길이<=1440, lastOrderMinute|null. 복수 구간으로 휴게를 표현하고 overnight는 end>1440. 겹침/마지막주문범위/실제달력날짜/중복예외를 검사한다. exceptions date+periods+note는 그 달력날 전체를 대체하며 이전날 심야 spill도 덮는다. 임시 상태 OPEN/CLOSED에 startsAt/expiresAt/note가 있고 만료 후 schedule 복귀. 자유문장을 자동 확정하지 않으며 기존 businessHours를 보존한다.

사진은 STORE/MENU/ENTRANCE/PACKAGING/SIGN, source OWNER_PHOTO, id/url/width/height/caption/updatedAt. 메뉴는 안정된id/name/priceWon|null/priceNote/photoId. 기존 {name,priceWon} 호환을 보존한다. AI artUrl을 실제 사진 필드로 복사하지 않는다. 권리 확인은 실제 점주 동의를 대체하지 않는다. 삭제/권리철회는 새 game/detail/share에 반영하며 이미 받은 수집품 권리를 삭제하지 않는다.

## 경로와 짧은 탐험 코스

기준은 MAP_CENTER/MANUAL/CURRENT_LOCATION, 표시 거리 STRAIGHT_LINE이며 walking 거리/시간과 분리한다. 경로 mode WALK/provider TMAP, MultiLineString [lon,lat], fetchedAt/expiresAt/travelSeconds/meters/dwellSeconds/stops[]. 실제 pedestrian API 구간을 순서대로 받아 머무름을 더해 도착 시각을 계산한다. 자동차 multi-waypoint30은 쓰지 않는다.

관심 수집품·미방문·재방문 목표·최신 영업/캠페인으로 코스 후보를 제안하고 사용자가 순서/가게/머무름 시간을 바꾼다. 길찾기 실패 시 다른 후보/주소/외부 지도 연결을 제공하며 직선을 실제경로로 그리지 않는다. 저장은 가게ID/순서/머무름만, GPS origin/geometry는 저장하지 않는다. 재진입 시 최신 버전/영업/캠페인을 다시 확인한다. 검증하지 못한 대기시간·접근성을 보장하지 않는다.

## 방문·쿠폰 복구

claim merchantId를 안내에 전달한다. 서버 inspect 가게와 선택 가게가 다르면 명시적 불일치 화면이고 선택ID/GPS로 발급하지 않는다. 입력/확인/처리중/확인필요/실패/완료를 구분한다. 앱 재실행에서 pending 시도와 서버 collection/claim 상태를 확인하고 같은 요청을 재시도한다.

직원의 발급 응답 유실도 다룬다. 기존 claim token은 해시만 저장되므로 원문 token을 복구한다고 약속하지 않는다. 필요시 동일 requestId의 발급 receipt를 조회하고 기존 활성 슬롯의 안전한 reissue로 회복하며 계정·직원 권한·가게·대상 고객을 다시 검사한다. 기존 redeem/일별방문/쿠폰 원자성·사용완료 replay·취소이력은 보존한다. 기존 권리와 GPS 안내를 분리한다.

## 수집·네 게임·친구

현재 V2 점수·입력로그·쌓기 폭·짝찾기·배달 충돌·주문 조합 규칙과 보상 ledger를 유지한다. 게임 콘텐츠는 검증된 가게/메뉴/사진·보유 수집품으로 확장하며 rulesVersion과 contentVersion을 혼동하지 않는다.

쌓기는 실제 포장/상품 대상과 완성탑, 기억은 구별 가능한 메뉴/간판/수집품과 짝 결과, 배달은 포장과 가게 목적지/화물 결과, 주문은 메뉴명·물건·주문표/완성 포장에 연결한다. 없는 콘텐츠는 명시적 연습자산을 쓰며 실제 가게 메뉴를 지어내지 않는다. 이동 중 게임을 제공하지 않고 게임성취를 실제방문/구매로 기록하지 않는다.

기존 StudioGoal과 방문/수집 진행을 재사용하여 원하는 수집품/다른가게/재방문을 연결한다. 친구 추천/식사 초대는 가게 위치와 예정시간 상태를 열어 확인하고 `친구 간 약속 · 매장 예약 아님`을 표시한다. wishlist와 획득 경로는 안정된 merchant/entitlement 관계를 유지하며 만료 캠페인에 정직한 대안을 제공한다.

## 재질·피드백·성능

상세/획득/장착/전시/PNG/영상에서 기존 GradeMaterialLayer/reflectionAt를 공유하고 고정각도/정적캡처를 결정적으로 제공한다. 센서/재질clock은 보이는 전경에서만 실행한다. atlas Issue380은 해당crop경계만 고쳐 전체 25 mapping을 유지한다.

게임 RAF는 playing+focus+foreground에서만 예약한다. 렌더 중단과 무료시간 연장을 구분하고 기존 server run 시간/만료는 유지한다. 복귀 때 경과시간으로 timeout/재개 상태를 계산한다. 지도pan 반복진동 없음, 필터 작은반응, 방문/획득/성공/실수/기록경신은 설정을 존중하는 시청각·촉각 반응, 문구/아이콘은 항상 있다. 실기 진동은 체감 응답 없이는 PASS가 아니다. 소리·진동·모션OFF, 배경의 location/map/sensor/RAF 중단과 실제 CPU/메모리/프레임을 검사한다.

## 점주·운영·지표

기존 점주/관리자 웹의 등록→위치·출입구→시간표·메뉴·사진→방문조건·수집품→고객 미리보기→게시 checklist를 연결한다. 누락은 편집 항목으로 이동한다. 동의/관리권한/검증된위치 없이 실제 준비완료로 표시하지 않는다. 임시휴무와 오늘변경은 적은 조작, expectedVersion 충돌/직원권한철회를 서버에서 검사한다. 기존 연장/직원/CSV/알림을 보존한다.

MAP_SELECT/DETAIL_VIEW/DIRECTIONS_OPEN/GOAL_SAVE는 비식별 일별aggregate이고 actualvisit/coupon은 기존 거래로 센다. 기존 DETAIL_VIEW와 이중 전송하지 않는다. eventId dedupe는 짧게 보관하고 개인정밀위치·검색어·경로는 거절한다. 기존 overview/admin-funnel에 연결하여 클릭을 방문/매출로 해석하지 않는다. 실제 참여0개의 일반장소/참여없음 상태를 제공한다.

## 마이그레이션·호환·복구

Root가 번호를 잠근다: 0056 real-world profile/location/schedule/publication evidence, 0057 photos/reports, 0058 discovery daily events, 0059 필요시 claim issue recovery receipt. 0059가 불필요하면 만들지 않는다. nullable/additive로 시작하고 old hours/menu/권리/구형API를 유지한다. 기존 가게에 합성좌표/시간을 채우지 않는다. 새 개인정보는 account deletion/retention 경로와 함께 검사한다. rollback은 v1/API/UI 비활성화, 기존기능 복귀이며 운영정보 table DROP을 하지 않는다.

## 실행 소유권과 검증

Root는 real-world-contract.ts, server.ts/startup배선, package/lock/appconfig, 앱상위탭/route, migration번호, docs/통합/CI/실기를 소유한다.

- Domain: real-world-rules/hours/location, postgres real-world service,0056-58, merchant-readiness helper와 버전/권한/사진/정정/집계.
- Geo/SDK: tmap-provider.ts와 테스트, modules/tmap-map, maps wrapper, 공식 SDK 준비스크립트. 의존성/appconfig 변경은 Root요청.
- DiscoveryUI: discovery client/state, real map screen, merchant-list/detail/courses/search, 고객 방문 목적지 계약 전달.
- MerchantWeb: 점주/운영 real-world 편집/사진/시간표/미리보기/readiness/metrics 및 사이트시험. 서버배선 Root.
- VisitSocial: claim/coupon/직원 발급 복구, 원하는수집품/친구목표/초대 맥락. 기존거래 변경은 필요한 부분만 회귀시험 후.
- GameVisual: 네게임 realcontent/lifecycle, StudioCoin/공유재질 및 시험. atlas clip 담당과 파일 충돌 금지.

검증 순서: 순수규칙 RED→GREEN, PG from-scratch/rerun/역할철회/버전충돌/종료캠페인/기존권리, 모바일/API/웹 전체검사, Android 실제 SDK build+install, 공급자 live와합성 분리, before/after screenshot+동작영상+200%/TalkBack/성능/감각, 독립보안·아키텍처검토, 최신headCI→병합. 키/제휴/현장동의/공개출시/사용자촉각 외 독립작업은 모두 완료해야 코드작업 종료 가능하며 전체실사용 완료로 부르지 않는다.

## 16절 수용 원장

| 절 | 통과 조건 |
| --- | --- |
| 1 | 선택→실제경로→직원확인→수집→장착·전시→재방문 전체연결 |
| 2 | 최신 SHA·API·설치본 구분, 짧은홈/기존개선재사용 |
| 3 | 앱 안 실제지도 pan/zoom/bounds/cluster/같은건물/list선택/복귀 |
| 4 | 지점·입구·검증좌표·provenance·만료·운영/시연분리 |
| 5 | 심야/휴게/임시휴무/lastorder/실제사진/독립영업·캠페인·쿠폰 |
| 6 | manual/GPS/거리종류/실제WALK/수정가능코스/머무름/실패대안 |
| 7 | wrongcode/othercustomer/expiry/offline/lostresponse/duplicate/revoke/relaunch |
| 8 | 네게임 모두대상·행동·결과 실제연결, practice/visit원장분리, 목표·친구 |
| 9 | 중복탭통합/compactHome/찾은가게유지/인증후목적지/옛링크호환 |
| 10 | 패널·지도충돌/마커/원화·재질·장비·공유일치/큰글씨·TalkBack |
| 11 | 설정·실제청음/진동·소명, background중단·프레임/CPU/메모리측정 |
| 12 | 점주등록·위치·입력·미리보기·게시/일상업무/직원·충돌·운영정정 |
| 13 | foreground location/privacy/최소정보/key제한/무료quota/TTL/장애대안 |
| 14 | distinct행동집계/실제방문·쿠폰/tenant/미참여·성과정직 |
| 15 | 모든요청시나리오 자동·화면·실기·live를SHA환경별기록 |
| 16 | 모든독립코드와통합검증, 남은외부요건구체화·첫단계종료금지 |

## 독립 설계 검토

Critical/Important 착수 blocker 없음, APPROVE. 신규 /api/web/v1/merchant는 기존 guard가 자동 적용되지 않아 같은 session/Origin/CSRF 검사를 Root가 연결한다. commerce-api.ts의 기존 same identity/merchantReference→replay→tokenVersion→reissue를 먼저 재사용하고, initial/reissue 응답유실·relaunch·retention cleanup terminal을 검증한다. 0059는 이 기존복구경로로 충분하면 생성하지 않는다.
