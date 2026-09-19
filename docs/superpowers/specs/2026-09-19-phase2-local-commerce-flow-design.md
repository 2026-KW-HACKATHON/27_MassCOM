# Phase 2 지역 상권 흐름 설계

## 목표

사용자가 지갑 없이 월계1동 음식점을 탐색하고, 점주 확인·일회용 QR·방문·고정 보상권·도감·다음 음식점 추천까지 이어지는 Phase 2 흐름을 실제 앱과 API로 제공한다.

## 범위

- 고객 Android: 음식점 목록·상세, 수령 토큰 preview/redeem, 방문 도감, 앱 수집품, 추천
- 점주·직원: 자기 점포 context 확인, 1인 claim slot 발급·동일 슬롯 재발급
- API·PostgreSQL: 기존 카탈로그·권한·claim slot·visit/reward 기반 재사용, 필요한 조회 API만 추가
- 문서·증거: v3 테스트 ID·평가표·HANDOFF와 실제 실행 결과 동기화

Phase 3 NFT 계약·Worker·테스트넷 발행, 유료 클라우드, 공개 배포는 포함하지 않는다.

## 사용자 흐름

1. 앱 첫 화면에서 지갑·로그인 없이 공개 음식점 목록을 본다.
2. 음식점 상세에서 주소, 최소 이용 금액, 캠페인 기간, 정원 상태, 첫/3/5회 보상을 확인한다.
3. 실제 이용 후 점주·직원이 자기 점포 권한으로 1인용 claim slot을 발급한다.
4. 사용자는 QR의 token 또는 수동 대체 입력을 preview하고 명시적으로 수령한다.
5. 서버는 slot 소비·방문·한국 날짜 진행도·보상권을 한 트랜잭션으로 확정한다.
6. 도감은 방문, 앱 수집품, 실제 NFT 상태를 분리한다.
7. 추천은 미방문 여부와 진행 가능한 캠페인 상태를 기반으로 이유를 함께 표시한다.
8. 외부 지갑 연결은 별도 선택 경로이며 Phase 2 핵심 사용을 막지 않는다.

## 모바일 구조

- `/`: 공개 음식점 목록
- `/merchants/[merchantId]`: 음식점·캠페인·보상 상세
- `/claim`: token 수동 입력, preview, 명시적 redeem
- `/collection`: 방문·보상권·NFT 상태가 분리된 도감
- `/recommendations`: 설명 가능한 다음 음식점 추천
- `/merchant`: 개발/시연용 점주 context와 1인 claim slot 발급
- `/wallet`: 기존 Phase 1 외부 지갑 화면

라우트 파일에는 화면 연결만 두고 API client·parser·화면 컴포넌트는 `src/` 하위 책임별 파일로 분리한다.

## 데이터·보안 경계

- 공개 목록은 인증·지갑 없이 `GET /merchants`를 사용한다.
- 점주 API는 매 요청 `x-account-id` 개발 resolver와 PostgreSQL 멤버십 권한을 검사한다. 운영 인증으로 표현하지 않는다.
- 고객 preview/redeem도 현재 개발 account resolver를 사용하며 Google 로그인 완료로 주장하지 않는다.
- QR token은 URL·로그·DB 원문에 저장하지 않고 POST body에서만 전달한다.
- 화면은 실제 협약 점포가 아닌 `demo: true`를 명확히 표시한다.
- NFT가 없는 앱 수집품과 실제 발행 NFT를 같은 상태로 표시하지 않는다.

## 오류·상태

모든 조회 화면은 loading, error, empty, content 상태를 구분한다. 재시도는 기존 데이터를 지우지 않는다. mutation은 중복 제출을 막고 실패 시 token·입력값을 유지한다. 만료·이미 사용·권한 없음·캠페인 중단을 서로 다른 한국어 안내로 표시한다.

## PR 경계

1. 고객 음식점 탐색·상세와 선택적 지갑 라우트
2. 점주 claim slot·고객 preview/redeem·방문 도감
3. 추천·실제 Android 통합·평가/인수인계 최종화

각 PR은 기능 코드, 관련 테스트, 문서와 증거를 함께 포함한다. 상태 전용 PR은 만들지 않는다.

## 성공 기준

- 지갑 없이 목록·상세·claim·도감을 사용할 수 있다.
- 점주 권한과 claim token 단일 소비가 기존 PostgreSQL 시험을 유지한다.
- 방문·앱 수집품·NFT 상태가 화면과 API에서 분리된다.
- 추천 응답과 화면에 이유가 있다.
- 실제 Android에서 외부 HTTPS를 제외한 로컬 전체 흐름을 재현한다.

