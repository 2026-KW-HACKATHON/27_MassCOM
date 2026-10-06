# MassCOM 실제 가게 연결 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. 각 task는 checkbox로 추적한다. 이 요청은 독립 범위의 병렬 구현과 리더 통합을 허용한다.

**Goal:** 실제 지도에서 가게를 찾고 보행 경로·직원 확인·수집·장착·재방문으로 연결되는 전체 경험과 점주 운영을 완성한다.
**Architecture:** 기존 거래·권리·구형 API는 보존하고 v1 discovery와 독립 실제 가게 프로필을 추가한다. TMAP native Android/웹 SDK와 서버 보행 API를 쓰고 24h 미만 외부 데이터와 점주 독립 정보를 분리한다. 공통 DTO를 먼저 고정하고 역할별 구현을 합친다.
**Tech Stack:** 기존 Expo57/RN0.86/React19/TS/Node/Postgres, TMAP SDK3.7, foreground expo-location, 기존 Expo native-module 패턴. 의존성/lock/appconfig는 Root만 수정.
**Spec:** [전체 설계](../specs/2026-10-06-real-world-experience-design.md), [사용자 원문](../specs/2026-10-06-real-world-request.md), Issue #381.

## Global Constraints

- 전체16절 및 시나리오를 완료 대상으로 유지하며 첫 단계 종료 금지.
- 기존 방문/쿠폰/수집/구매/직원/계정/지갑 권리·검사와 운영/시연 데이터 분리 보존.
- 좌표 순서 Point lat/lon, GeoJSON 및 TMAP REST x/y는 lon/lat. 임의 교환·보정·가짜 위치 금지.
- provider 결과/ID/경로 TTL<24h, 확인 클릭으로 독립 점주 정보 승격 금지.
- foreground 위치만 선택적으로, GPS/경로/검색어/키를 로그·통계·친구공유에 남기지 않음.
- Android native 및 시연 웹 실제대상, iOS는 NOT_RUN. 키·동의·계약·공개출시는 외부요건.
- 루틴 개발/테스트/commit/push/PR/필수CI뒤 merge는 이미 승인됨. 유료자동가입/제휴/공개출시를 대신 승인하지 않음.
- source/view, nativebuild, 설치/감각, live provider, 공개배포를 각각 판정.

## Review Focus

1. 전날 심야영업과 오늘 임시휴무가 겹치면 오늘 예외를 우선하며 last-order/휴게를 구분한다(Task1).
2. 같은 이름·동일좌표 여러점포와 없는좌표를 가짜핀 또는 첫검색결과로 합치지 않는다(Task2,3).
3. 필터변경/계정전환 뒤 늦은 응답·cursor·개인화캐시가 새 상태를 덮지 않는다(Task3,5).
4. 직원 발급·재발급 각각의 응답유실/재실행/identity cleanup 이후 실패를 성공으로 표시하지 않는다(Task5).
5. /api/web/v1/merchant는 기존prefixguard 밖이므로 Root가 동등 세션·Origin·CSRF 및 현재role/version검사를 붙인다(Task1,4,7).

## 공통 계약 고정 (Root)

파일 `apps/api/src/real-world-contract.ts`의 타입을 모든 lane이 사용한다. 계약 변경은 Root와 소비자에게 알리고 함께 수정한다. 핵심 타입은 Point, Bounds, OwnedLocation, BusinessSchedule, BusinessOverride, BusinessState, MerchantPhoto, MenuItem, RealWorldProfile, MerchantSummary/Detail, DiscoveryQuery/Page, ExternalPlace, WalkingRoute, DiscoveryEvent, MerchantReport, RealWorldError다.

Domain class `PostgresRealWorldService`는 pool+clock을 받고 다음 method를 제공한다: search(query), merchant(id), profile(accountId,id), updateProfile(accountId,id,input), createPhoto(accountId,id,input), deletePhoto(accountId,id,photoId), report(accountId,id,input), reports(accountId,id), resolveReport(accountId,id,reportId,input), recordEvent(input), engagement(accountId,id), gameContent(merchantIds). 지도 provider class `TmapProvider`는 places(query), geocode(address), walk(origin,destination), active-config/status를 제공한다. course aggregation은 Root가 domain.merchant 최신조회와 provider.walk 실제구간을 연결한다.

## Task 1: 실제 가게 데이터와 versioned discovery

**Owner:** Domain executor. **Files:** 신규 `apps/api/src/real-world-rules.ts`, `real-world-hours.ts`, `postgres/real-world.ts`, 대응 test/integration; migrations `0056_real_world_profiles.sql`, `0057_merchant_photos_reports.sql`, `0058_discovery_events.sql`; 필요한 기존 readiness/profile/overview 관련 파일만. Root의 server/contract 수정 금지.

**Interfaces:** 계약타입을 소비하고 위 PostgresRealWorldService method와 `validateOwnedLocation`, `validateSchedule`, `businessStateAt`, `validateRealWorldProfile`을 생산한다. 기존 GET /merchants는 변경하지 않는다. account잠금→merchant행잠금→최신role→version 순서를 재사용한다.

- [ ] 사용자 사례 기반 RED 규칙시험: invalid/뒤집힌 좌표, 출처세탁, 심야/휴게/휴무/임시override 만료, 실제날짜, legacyUNKNOWN. 예시:
```ts
assert.throws(() => validateOwnedLocation({building:{latitude:127,longitude:37},source:'OWNER_DECLARED'}));
assert.equal(businessStateAt(overnightWithMondayClosure, new Date('2026-10-05T00:30:00+09:00')).state,'CLOSED');
```
- [ ] additive migrations/서비스를 구현하고 bounded+cursor search, nullable campaign, actualphotos/report moderation/anonymousevents를 테스트한다. 불필요한 새 원장/자동게시/가상좌표 추가 금지.
- [ ] PG RED→GREEN: 동명지점, 동일건물, missingcoords, endedcampaigndetail, staffrevoke,409, legacyPUTpreserve, photodeletion/권한/EXIF, eventdedupe/tenant/accountdeletion.
- [ ] `npx tsx --test src/real-world*.test.ts` 및 해당 PG integration을 isolated `_test` DB에서 순차 실행. fromscratch/rerun검사.
- [ ] 증거를 ledger에 보고하고 Root통합 뒤 Lore commit에 포함.

## Task 2: 실제 TMAP SDK와 서버 외부 요청

**Owner:** Geo executor. **Files:** `apps/mobile/modules/tmap-map/**`, `apps/mobile/src/maps/**`, `apps/api/src/tmap-provider.ts`와 test, `scripts/prepare-tmap-sdk.mjs`. AAR/keys/signedURL Git금지. appconfig/package 변경 Root요청.

**Interfaces:** Point/Bounds/ExternalPlace/WalkingRoute 공통타입. nativeMap props/events 설계계약, TmapProvider places/geocode/walk. native active와 lifecycle, markerId/clusterleaf/bounds callback. Typed JS wrapper는 native missing/key missing/error를 정직하게 표시.

- [ ] lon/lat변환·실제 pedestrian응답parser/기간/quota/error/stale의 RED 시험:
```ts
assert.deepEqual(toTmapPoint({latitude:37.6,longitude:127.1}),{x:127.1,y:37.6});
assert.equal(parseWalkingResponse(pedestrianFixture).mode,'WALK');
assert.throws(()=>parseWalkingResponse(automobileFixture));
```
- [ ] pinned공식 SDKhash검증과 최소ExpoView를 구현. SDK원본 method/class는 실제 AAR/공식문서로 확인. broadpermission/샘플버전/광범위위치권한 복사금지.
- [ ] server REST timeout/abort/quota/cache<24h/no-secretlog 및 no-config를 구현. 동일service 여러project나 paid자동전환 없음.
- [ ] native consumer/wrapper test/type/lint 후 Root의 SDK실제Gradlebuild 및 실기증거로 검증. 웹SDKmock와 realtile실행은 별도.
- [ ] 레포 의존성 요청과 artifact 경로/해시/검증한계 보고.

## Task 3: 탐색·상세·보행 코스 UI

**Owner:** DiscoveryUI executor. **Files:** `apps/mobile/src/merchant/discovery-api.ts`, `discovery-state.ts`/test, `screens/real-map/**`, `screens/merchant-list/**`, `screens/merchant-detail/**`, course helpers. Rootroute/tabs 및 VisitSocial소유 claim수정 금지.

**Interfaces:** v1DTO/API계약을 소비한다. `RealMapScreen({apiUrl,credential,onSessionInvalid})`, 공유 탐색상태/query/selection과 detail을 생산한다. 관심/미방문 필터는 existingcollectionprogress 재사용. keys없는fallback목록/주소는지도성공으로표현하지 않는다.

- [ ] late-A/better-B 응답·filtercursor·selectedshop/외부복귀·coldmanualorigin·GPSprivacy RED:
```ts
const state=createDiscoveryState();const a=state.begin(queryA);const b=state.begin(queryB);
state.resolve(b,pageB);state.resolve(a,pageA);assert.equal(state.snapshot().query,queryB);
```
- [ ] 실제mapwrapper와selectedpanel/nativebounds/listpagination/같은건물leaf목록 연결. detail은 ID전용v1조회·사진/입구/시간/conditions/상태를 나눔.
- [ ] 코스 추천/순서·가게변경/머무름/actualwalk/실패대안, manual/GPSorigin, attribution/key없음/권한거부/저정확도 상태 구현. 저장은 ID/순서/dwell만.
- [ ] visitlink merchantId·친구/도감획득경로·관심수집품을 전달하고 방문 성공은 기존transaction서비스만 결정.
- [ ] 모바일 대상test/type/lint 및 mounted web/phone 360/390/200%/keyboard/panel동작 결과 Root와검증.

## Task 4: 점주·운영 웹 현실 정보

**Owner:** MerchantWeb executor. **Files:** `apps/production-web/merchant.html`, `admin.html`, 신규 `assets/real-world-merchant.mjs`, 관련profile/UI asset과 tests/site. 공유merchant.mjs/admin.mjs배선이필요하면 Root협의.

**Interfaces:** v1merchant profile/사진/보고서와 readiness, accountsession/CSRF기존 helper를 소비한다. 고객미리보기와 repair-field링크, temporaryclosure/todaychange, 위치/입구/시간/메뉴/실사진관리, engagement표시를 생산한다.

- [ ] scheduleform→동일계약, invalidoverlap/lastorder,409/403/키없음/독립출처 vsprovidercandidate/realphoto라벨 RED.
- [ ] 기존UI토큰/role체계로 편집·사진선택·검토·고객미리보기·준비checklist·게시연결 구현. 실제동의나pin확인을가상완료로만들지않음.
- [ ] 기존연장/staff/CSV/쿠폰/알림 흐름 유지·일상변경 최소조작·키보드/큰글씨·dark/좁은폭.
- [ ] 예시데이터는 API-backed격리fixture이며실제매출/참여실적처럼 표시하지 않음.
- [ ] site대상시험 및 realHTTP+CUA owner/staff/admin manual을 Root가검증.

## Task 5: 현장 복구·쿠폰·목표와 친구 연결

**Owner:** VisitSocial executor. **Files:** `screens/claim-redeem/**`, 필요한 commerce-api/claim-recovery helper와 test, `gamification/coupon-use-sheet.tsx`, `screens/studio/friend.tsx`, friend/invite UI, 필요한 StudioGoal/types 및 server play/social 변경은 Root합의.

**Interfaces:** 가게ID/Detail을 안내 context로만 사용. 이미 있는 issue identityToken→same merchantReference→replay/currenttokenVersion/reissue를 재사용하고 새0059를 기본추가하지 않음. 수정된서버 method/route계약은 Root에게보고.

- [ ] initialissue+reissue 응답유실 각각/동일시도relaunch/expiredidentitycleanup/role revoke/wrongcustomer/wrongstore/couponalreadyused RED. 예시:
```ts
const recovery=await replayLostIssue({identityToken,merchantReference});
assert.equal(recovery.slotId,originalSlotId);assert.equal(recovery.state,'ISSUED');
```
- [ ] pendingintent를 계정별 안전storage에 유지, sessionchange fencing과terminalexpiry/불가상태표시. success는servercollection/coupon결과만.
- [ ] arrival설명과selectedstoremismatch, 조건·쿠폰가게/기간/방법/공식최신상태/취소이력 구현.
- [ ] 원하는수집품과existingStudioGoal 연결, 친구추천/초대에서위치·일정상태·예약아님을 표시. 원장/게임재화 규칙변경 없음.
- [ ] targetedtests/type/lint와faultinjection 앱재실행을 Root에게인계.

## Task 6: 네 게임·재질·감각/성능

**Owner:** GameVisual executor. **Files:** `screens/play/**`, `studio/studio-scene.tsx`, share/material 관련정확한파일 및 test. illustration artwork/catalog3개는이미별도cropfix담당완료, 수정금지.

**Interfaces:** `gameContent(merchantIds)`의 실제메뉴/사진/포장/간판과ownedcollectibles를 소비하고 4게임 presentation을 확장. rulesVersion/authoritative scoring/rewardledger 불변. 기존GradeMaterialLayer를StudioCoin/PNG/MP4에연결.

- [ ] 빈보유practice/실사진없음/삭제photo/네게임조작대상및결과context/RAF stop-background-done/focus-return-serverexpiry RED.
- [ ] 네게임 모두 실물관계와동작·결과 연결. fake메뉴·merchantmadegame 없음. 렌더정지로무료time연장하지않음.
- [ ] 원화/grade/재질/장비순서와static deterministiccapture·video일관성, viewport/foreground/reducemotion 수명제어.
- [ ] 설정OFF/무음·lowmotion 보조문구, peraction 피드백을commonfunctions로존중. 기기진동미체감원인확정없이강도만올리는우회금지.
- [ ] targetedtests/fullmobile검증과nativefourgame/coin/PNG·MP4/CPUframe측정을Root에게인계.

## Task 7: Root 통합·정책·전체 검증·병합

**Files:** `apps/api/src/server.ts`, 공통contract, package/lock/appconfig, 탭/route/deep-link/rootprovider, `docs/DECISIONS.md`, `DESIGN.md`, privacy/terms문서 및 reports/state.

- [ ] /v1과/api/web/v1 route배선을기존auth/Origin/CSRF/role로보호. photo만전용byteslimit/실제decode/S3existingstorage, 다른JSONbodylimit확대없음.
- [ ] TMAP config/SDK/expo-location dependencies를현재SDKversion으로설치하고 Google/productioncredential/billing변경없음. Androidnativecompile/install preservingappdata.
- [ ] 새5tab과legacy호환/shortHome/auth후pending목적지, privacyversion/foregroundjust-in-timeconsent/logredaction/retentionaccountdelete를동기화.
- [ ] 전체API/PG/mobile/site/type/lint/static/두variantnativeexport/SDKcompiledbuild 검사. PGsuite는순차.
- [ ] genuineprovider실좌표/places/WALK와synthetic/parser를구분. no-keyblocked항목을명시하고독립code/UX검증계속.
- [ ] 자동·브라우저·실기·성능·감각 before/after/video를축소하지않고16절 ledger와대조. actualshoppublication/visit/reward는실제동의후만.
- [ ] 독립task와wholebranch code/security/architecture검토수정, source-onlygate·한국어PR·Lorecommits·push·attachPR·exactheadCI→merge. 공개APK/Play/production동작은별도승인/증거.

## 자기 검토와 종료 조건

모든16절은Task1–7 중담당이있다. 공유DTO/field/signature변경은Root만동기화한다. plan의예제fixture는값을정의해test에둔다; 테스트로써유효한대상을실제로준비하고고정원문법령/provider문서에없는지원은추측하지않음. 계획은구현코드가아니고methods미완성을완료로보고하지않는다. 독립작업완료전에외부키없다는이유로끝내지않으며, 외부막힘은해당live/현장/출시/체감행에만남긴다.
