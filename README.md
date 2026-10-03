<p align="center">
  <img src="docs/assets/readme/hero.png" width="100%" alt="월계동 식당 거리와 파란 월계 마스코트가 함께 있는 MassCOM 콘셉트 일러스트">
</p>

<h1 align="center">월계 마스코트 · MassCOM</h1>

<p align="center">동네 가게를 발견하고, 방문을 기록하고, 마스코트를 모으는 Android 서비스.<br>외부 지갑 NFT는 선택 기능이며 앱 수집품과 실제 발행 상태를 구분합니다.</p>

<p align="center">
  <img alt="React Native" src="https://img.shields.io/badge/React_Native-Android-2358C7?logo=react&amp;logoColor=white">
  <img alt="Expo SDK 57" src="https://img.shields.io/badge/Expo-SDK_57-152A4A?logo=expo&amp;logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-API%20%26%20App-3178C6?logo=typescript&amp;logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-Data-336791?logo=postgresql&amp;logoColor=white">
  <img alt="Base Sepolia" src="https://img.shields.io/badge/Base_Sepolia-Testnet-0052FF">
</p>

<p align="center">
  <a href="https://www.masscom.kr/preview/">시연 웹 보기</a> ·
  <a href="https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.17">시연 APK 받기</a> ·
  <a href="https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.8">운영 테스트 APK 받기</a> ·
  <a href="https://www.masscom.kr/app/">운영 웹 보기</a> ·
  <a href="docs/TEST_STATUS.md">검증 현황</a> ·
  <a href="#설치검증">직접 실행</a>
</p>

> 배너는 콘셉트 일러스트입니다. 시연 점포·방문은 가상 데이터이며 협약 점포, Google Play 승인, 매출 증가를 뜻하지 않습니다. 시연 Preview 3 APK에서는 기존의 두 계정 **직접 코드 입력 수령**과 별도로, [같은 계정의 점주·고객 역할 전환 후 실제 카메라 QR 촬영→수령](docs/evidence/showcase-preview3-camera-claim-2026-09-28.json)을 확인했습니다. 다른 두 계정·두 휴대전화의 QR 수령, 시연 앱 외부 지갑·NFT 발행은 별도 `NOT_RUN`입니다.

## 심사위원용 3분 요약

MassCOM은 동네 가게를 발견하고 방문을 기록해 마스코트를 모으는 Android 서비스입니다. 지역 이용자와 점주·직원이 대상입니다. 핵심 루프는 "가게 탐색 → 방문 인증(QR) → 도감·배지 적립 → 다음 가게 추천"입니다.

모바일 회전 수집품은 뒷면 그림이 없어도 등급색·안쪽 테두리·가게와 수집품 이름·마스코트 도장의 기본 뒷면과 각도별 두께를 표시합니다(#340).

모바일 수집품에는 등급 재질 조명도 적용합니다(#349): 골드는 따뜻한 금속 반사·별빛, 프리즘은 움직이는 무지개 홀로그램을 상세 앞·뒷면·목록·봉투에 표시하며 공유 이미지에는 정적 재질을 담습니다. 기울기·끌기·자동 반사를 결합하고 동작 줄이기에서는 한 프레임으로 고정합니다. [자동 검증은 PASS, 기기/시각 QA는 NOT_RUN — 사용자 판정 필요](docs/TEST_STATUS.md)입니다.

| 지금 실제로 되는 것 | 근거 |
| --- | --- |
| 시연 앱: 가상 점포 3곳 탐색·QR 방문·도감, 하늘 동네·탐험 여권(배지·상자·쿠폰), 동네 지도·길찾기, 친구 탭 | [Preview 17 에뮬레이터 가상 점포 B 상세](docs/evidence/showcase-preview17-release-2026-10-03.json), [이전 Preview 16 첫 화면](docs/evidence/showcase-preview16-release-2026-10-03.json), [이전 Preview 15 설치·실기](docs/evidence/showcase-preview15-release-2026-10-02.json), [탐험 여권 실기](docs/evidence/explorer-passport-emulator-2026-09-29/README.md), [지도 실폰](docs/evidence/town-map-2026-09-29/README.md), [친구 배포](docs/evidence/friends-deployment-2026-09-29.json) (두 계정 사이 친구 코드·QR 추가는 `NOT_RUN`) |
| 시연 점주 앱: 방문 확인·오늘/현황·가게 꾸미기 3탭, 전체 화면 방문 QR·만료 카운트다운, 쿠폰 시트·방문/쿠폰 되돌리기·손님 의견 | [Issue #341 시험 기록](docs/TEST_STATUS.md) (자동 시험 통과, 실제 설치·카메라·시트 터치·큰 글꼴은 `NOT_RUN`) |
| 점주 웹: 가게 현황(방문·쿠폰 요약 카드와 오픈 준비 체크리스트, 운영 배포 전), 사진 수집품 제작기, 방문·쿠폰 되돌리기 화면 | [TEST_STATUS](docs/TEST_STATUS.md) (실제 방문을 되돌리는 실행과 가게 현황의 운영 배포·실제 점주 화면은 `NOT_RUN`) |
| 서버: 실제 점포 운영 시작·약관 동의·NFT 메타데이터 API가 운영·시연에 배포됨 | [배포 증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json) |
| NFT: Local Anvil·Base Sepolia 테스트넷 발행·장애 복구 검증 | [Worker 검증](docs/TEST_STATUS.md) |
| 최신 운영 test.8·시연 Preview 17 APK 서명·공개 다운로드 확인(Preview 17 에뮬레이터 PASS, Samsung `NOT_RUN`) | [운영 test.8](docs/evidence/operating-android-test8-2026-10-03.json) · [시연 Preview 17](docs/evidence/showcase-preview17-release-2026-10-03.json). [이전 test.6·Preview 15 Samsung 실기](docs/evidence/deployment-b8d981d-2026-10-03.json)는 이전 설치본 증거 |
| 도감 카드 실기 확인(라이트·다크·글자 200%, 잘림·명암비 이상 없음) | [실기 캡처](docs/evidence/device-captures-2026-10-01/README.md) |

| 꺼져 있거나 아직 안 된 것 | 근거 |
| --- | --- |
| 실제 제휴 점포 0곳(운영 점포 0건, 시연은 가상 3곳뿐) | [운영 관리자 현황](docs/evidence/operating-admin-status-deployment-2026-09-29.json) |
| 현장 실증(필드 검증) 전체 `NOT_RUN` | [FIELD_VALIDATION](docs/FIELD_VALIDATION.md) |
| AI 가게 그림 실제 호출 꺼짐(OpenAI 키 미투입, [B-026](docs/BLOCKERS.md)) | [켜기 준비 리허설](docs/evidence/ai-art-enable-rehearsal-2026-09-30.json) |
| NFT는 Base Sepolia 테스트넷까지만, 메인넷 발행 없음 | [BLOCKERS](docs/BLOCKERS.md) |
| 새 약관 동의 화면 제출 `BLOCKED`(미동의 허용 계정이 기기 Google 계정 선택기에 없음, 비밀번호 필요한 계정 추가는 금지) | [실기 캡처](docs/evidence/device-captures-2026-10-01/README.md) |
| #257 사진 수집품 native 상세 화면 `NOT_RUN`(보유 계정 없음) | [실기 캡처](docs/evidence/device-captures-2026-10-01/README.md) |
| DB 백업의 실제 복원 | [HANDOFF](docs/HANDOFF.md) |

**설치·시연:** [masscom.kr/open](https://www.masscom.kr/open)에서 운영(고객 전용, 실제 API·DB)과 시연(가상 점포 체험용, 별도 API·DB) 중 고릅니다. 시연 웹은 설치 없이 [masscom.kr/preview](https://www.masscom.kr/preview/)에서 바로 봅니다.

현재 자동 시험 합계(2026-10-01 KST, main `61bde48` 기준): API 단위 291/291 · Worker 단위 55/55 · 모바일 853/853 · Foundry 8/8. 필수 36개 시험 ID는 31 `PASS` / 2 `BLOCKED` / 3 `NOT_RUN`([전체 근거](docs/TEST_STATUS.md)).

아래 "실제 기능 상태" 표가 기능별 자세한 근거이며, 이 요약과 어긋나면 아래 표·링크한 문서를 최신으로 봅니다.

## 왜 만드는가

| 대상 | 다루는 문제 | MassCOM의 접근 | 현재 근거 |
| --- | --- | --- | --- |
| 지역 이용자 | 가게를 찾은 뒤 방문 경험이 이어지지 않음 | 탐색 → 방문 기록 → 마스코트 도감 → 다음 가게 추천 | [가상 점포 3곳·두 계정 폰 실기](docs/evidence/showcase-two-account-phone-2026-09-27.json) |
| 점주·직원 | 방문 확인과 중복 수령을 구분해야 함 | 서버 권한 확인 뒤 일회용 코드 발급, 사용 후 추가 효과 차단 | [Android 발급·수령·재입력](docs/evidence/showcase-two-account-phone-2026-09-27.json) |
| 지갑이 없는 사람 | 탐색과 방문에 암호화폐 지갑이 진입 장벽이 됨 | 앱 수집품은 지갑 없이 사용하고 NFT 발행만 외부 지갑으로 분리 | [도감의 앱 수집품 1·실제 NFT 0](docs/evidence/showcase-android-apk-2026-09-27.json) |

## 지금 열어보기

| 구분 | 바로 열기·받기 | 현재 상태 |
| --- | --- | --- |
| 운영 웹 | [www.masscom.kr/app/](https://www.masscom.kr/app/) | 실제 운영 데이터, Google 로그인·읽기 전용 본인 도감. Samsung Chrome의 www 로그인·재열기·로그아웃 확인 |
| 운영 관리자 웹 | [www.masscom.kr/admin/](https://www.masscom.kr/admin/) | 별도 서버 관리자 권한으로 실제 점포만 관리. [주 계정·빈 운영 현황](docs/evidence/operating-admin-status-deployment-2026-09-29.json)과 [비공개 캠페인 초안 빈 상태](docs/evidence/operating-campaign-draft-deployment-2026-09-29.json)는 인증 브라우저 확인. 실제 점포 등록·캠페인 입력은 `NOT_RUN` |
| **시연 웹** | [설치 없이 바로 보기](https://www.masscom.kr/preview/) · [GitHub 웹 전용 미리보기 태그](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-web-v0.1.0-preview.1) | 가상 점포 A·B·C와 예시 수집품을 표시하는 정적 시연, 실제 방문·NFT 실적 아님 |
| 운영 Android 테스트 앱 | [test.8 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.8) | source `0fcdfe8`, [업로드 인증서·익명 다운로드 뒤 APK 재해시·지갑 표면·녹음 권한 없음](docs/evidence/operating-android-test8-2026-10-03.json) 확인. Samsung 실기기 설치·로그인과 운영 APK 에뮬레이터 실행은 `NOT_RUN`. [test.7 서명·공개 다운로드](docs/evidence/operating-android-test7-2026-10-03.json)과 [test.6 Samsung 설치·화면 확인](docs/evidence/operating-android-test6-2026-10-02.json)은 이전 설치본 증거 |
| **시연 Android 앱** | [공개 Preview 17 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.17) · [설치·검증 상태](docs/ANDROID_DOWNLOADS.md) | source `0fcdfe8`, [APK·AAB의 시연 API 전용 주소·서명·익명 다운로드 뒤 APK 재해시·지갑 표면·녹음 권한 없음](docs/evidence/showcase-preview17-release-2026-10-03.json) 확인. Android 에뮬레이터(API 34, 720×1280)에서 Preview 16 위 설치·로그아웃 상태의 가상 점포 3곳과 가상 점포 B 수집품 미리보기 PASS. Samsung 실기기·로그인 흐름은 `NOT_RUN`. [Preview 15의 Samsung 방문·보상 흐름](docs/evidence/showcase-preview15-release-2026-10-02.json)과 [b8d981d 서버에서 받은 수집품 봉투](docs/evidence/deployment-b8d981d-2026-10-03.json)는 이전 설치본 증거 |

대회 [조직 저장소](https://github.com/2026-KW-HACKATHON/27_MassCOM)는 공개·활성 상태이며, 개인 비공개 저장소에서 진행한 작업을 원래 커밋 이력을 보존해 [조직 PR로 통합](docs/PUBLIC_SYNC.md)했습니다. 개인 저장소는 당시 개발 이력으로 남겨 둡니다.

**현재 판정:** 필수 36개 시험 ID는 31 `PASS` / 2 `BLOCKED` / 3 `NOT_RUN`입니다. Base Sepolia 발행과 운영 지갑 검증은 [별도 증거](docs/TEST_STATUS.md)가 있고, 시연 APK에는 전용 지갑·발행 기능을 자동으로 포함하지 않았습니다. [시연 APK 세부 상태](docs/ANDROID_DOWNLOADS.md)와 [현재 차단 항목](docs/BLOCKERS.md)이 아래 그림보다 우선합니다.

[Issue #202](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/202)의 Android 소스는 로그아웃 상태의 공개 점포 탐색과 개인 화면의 로그인 안내를 구현했습니다. 위 운영 test.3은 **변경 전 설치본**이고(당시 최신이던 test.4와 현재 최신 test.5는 그 소스를 포함하지만 로그아웃 상태 탐색·계정 전환은 test.4·test.5에서 확인하지 않았다), 시연 Preview 6·7에는 새 소스가 포함됐지만 실제 기기 로그인 복귀·계정 전환은 `NOT_RUN`입니다.

[조직 PR #208](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/208)의 새 소스는 고객의 2분 식별 QR → 체험용 점주의 카메라 확인·실제 이용 확인 → 계정에 묶인 기존 1회 수령 QR을 연결합니다. QR 두 종류는 용도·만료가 다르며 식별 QR 촬영만으로 방문·보상은 생성되지 않습니다. 원래 개인 PR #2를 조직 PR #208에 통합해 Preview 4 APK와 같은 커밋의 [시연 API](docs/evidence/showcase-customer-qr-deployment-2026-09-28.json)를 배포했지만 새 APK의 휴대전화 설치·전체 QR 흐름은 `NOT_RUN`입니다. Preview 3 PASS는 **기존 15분 수령 QR**의 이전 실기입니다.

[Issue #205](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/205)의 Android 소스는 도감에서 현재 캠페인의 인정된 방문만 보상 진행으로 세고, 다음 수집품까지 남은 방문과 점포 상세 이동을 표시합니다. Preview 6·7 APK에도 이 코드가 포함되지만 실제 기기·TalkBack 확인은 `NOT_RUN`입니다.

[조직 PR #209](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/209)의 운영 관리자 첫 구간은 기존 Google 웹 세션에 독립적인 서버 관리자 권한을 붙이고, 별도 [운영 관리자 웹](https://www.masscom.kr/admin/)에서 **실제 점포만** 비공개 생성·수정·숨김 처리합니다. 유효한 미수령 QR이 있으면 숨김을 거절하고, 숨긴 뒤 새 QR 발급·재발급을 막습니다. [운영 배포·권한 1명 검증](docs/evidence/operating-admin-deployment-2026-09-28.json)은 완료했지만 로그인한 브라우저의 실제 점포 업무는 `NOT_RUN`이고 운영 점포는 0곳입니다. 캠페인·그림 관리는 후속 범위입니다.

[운영 직원 등록](docs/OPERATING_STAFF_REGISTRATION.md)은 직원 자신의 Google 웹 계정과 실제 점포에 묶인 15분 코드를 운영자가 같은 점포에서 승인·회수하도록 연결합니다. 관리자에게 이메일이나 Google 식별자를 직접 입력시키지 않습니다. [STAFF 운영 배포](docs/evidence/operating-staff-deployment-2026-09-28.json)는 완료했고 `/merchant/` 외부 HTTPS·익명 접근 차단을 확인했습니다. 실제 직원 승인·고객 QR 촬영은 `NOT_RUN`입니다.

운영 점포별 QR 활성·만료·수령, 유효 방문·보상, NFT 작업·오류 코드의 **개인정보 없는 읽기 전용 집계**는 [조직 PR #210에 통합된 운영 배포](docs/evidence/operating-admin-status-deployment-2026-09-29.json)까지 완료했습니다. 지정한 관리자 계정에서 실제 ‘집계할 실제 점포가 없습니다’ 화면을 확인했으며, 운영 점포는 0곳입니다. [조직 PR #210에 통합된 비공개 캠페인 초안](docs/evidence/operating-campaign-draft-deployment-2026-09-29.json)도 배포됐지만 실제 입력은 `NOT_RUN`이고 참여·보상·NFT를 시작하거나 공개하지 않습니다.

운영 점주 웹의 고객 식별 QR 확인·실제 이용 확인·방문 수령 QR 표시는 [조직 PR #210에 통합된 운영 배포](docs/evidence/operating-merchant-qr-deployment-2026-09-28.json)까지 완료했습니다. QR을 읽었다는 것만으로 방문·보상이 생성되지는 않습니다. 첫 발급 응답 손실 뒤 기존 슬롯을 확인하고 이전 코드를 폐기해 새 QR을 만드는 [조직 PR #210에 통합된 재발급 화면](docs/evidence/operating-merchant-reissue-deployment-2026-09-28.json)도 배포했습니다. 실제 직원 로그인·두 휴대전화 촬영·수령·재발급은 `NOT_RUN`입니다.

메뉴·가격과 점포 제공 영업시간은 관리자 입력 후 공개 캠페인이 활성화된 점포의 운영 웹 목록과 Android 점포 상세에 표시합니다. [운영 API·웹 배포](docs/evidence/operating-merchant-menu-deployment-2026-09-28.json)는 완료했으며 입력 전에는 빈 상태를 표시하고 운영 점포 자료를 임의로 채우지 않습니다. 실제 점포 입력·공개 캠페인·최신 Android 설치본의 표시와 현장 확인은 `NOT_RUN`입니다.

`www.masscom.kr`은 포털·운영 웹(`/app/`)·읽기 전용 시연 웹(`/preview/`)의 대표 주소입니다. `api.masscom.kr`과 `demo-api.masscom.kr`은 서로 다른 운영/가상 데이터베이스에 연결됩니다. 조직 저장소와 Preview 14 시연 APK는 공개됐지만, 테스트 설치본을 Google Play 승인·일반 운영 출시로 보지 않습니다.

[탐험 여권](docs/NEIGHBORHOOD_BADGES.md)은 인정된 방문으로 서버가 계산하는 메달 3종(동네 탐험가·단골손님·꾸준한 걸음)×브론즈·실버·골드를 보여주고, 배지 3·6·9개마다 보상 상자를 엽니다([Issue #216](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/216)). 상자의 쿠폰은 **점주 동의 기록이 있는 혜택이 등록된 경우에만** 서버가 계정당 1회 발급하고, 점원이 고객 식별 QR로 해당 점포 쿠폰만 사용 처리합니다(D-043). 시연 DB에만 가상 점포 체험 혜택을 넣었고 운영 혜택은 0건입니다. 방문 인증 직후 도장·색종이 축하, 획득 메달의 개인정보 없는 이미지 공유 카드도 포함합니다. [Android 에뮬레이터와 Samsung 휴대전화 로컬 실측](docs/evidence/explorer-passport-emulator-2026-09-29/README.md)에서 방문→축하→상자→쿠폰→점원 사용 처리와 이미지 공유창까지 확인했고, TalkBack 낭독·실제 점포 쿠폰 사용·서버 배포는 별도입니다.


모든 웹 화면(포털·설치·개인정보·계정 삭제 안내·읽기 전용 시연 웹·운영 웹 도감·점주·관리자)은 앱과 같은 색 토큰·마스코트 머리글·카드·버튼·다크 모드를 씁니다([Issue #218](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/218), [웹 디자인 체계](docs/superpowers/specs/2026-09-29-web-design-system.md), [전후 화면](docs/evidence/web-design-system-2026-09-29/README.md)). 웹 색이 앱 `palette.ts`와 어긋나면 `tests/site/verify_design_tokens_test.mjs`가 실패합니다.

[Issue #224](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/224)는 흰 바탕의 밋밋한 Android 앱을 **하늘 동네와 여권 도장**으로 바꿉니다([설계](docs/superpowers/specs/2026-09-29-sky-town-redesign-design.md), [결정 D-045](docs/DECISIONS.md)). 하늘 그라데이션·동네 그림 위에 떠 있는 카드, 가운데 도장 버튼이 솟은 세 칸 탭 바(`탐색 · 방문 인증 · 도감`, 내 정보는 머리글 아바타), 도감의 도장이 찍히는 여권 페이지, 숨쉬는 마스코트와 눌림·진입 연출이 들어갑니다. 동작 줄이기 설정은 실행 중에도 따르고, 새 색 조합은 라이트·다크 모두 명암비 시험을 거칩니다. 이 개편은 **소스와 에뮬레이터 로컬 확인까지**이며 공개된 Preview 7 APK와 운영 test.3에는 들어 있지 않고, main `fea9f29`로 만든 [시연 Preview 8 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.8)부터 들어 있습니다(Preview 8 설치는 `NOT_RUN`). 실제 휴대전화·TalkBack·소유자의 "꾸민 느낌" 판정은 `NOT_RUN`입니다([에뮬레이터 증거](docs/evidence/sky-town-redesign-2026-09-29/README.md)). 사장님 AI 시안(D-048)은 결정만 기록했다가 아래 Issue #236에서 구현했고, 지도(D-046)와 친구(D-047)는 바로 아래 Issue #228·#230에서 구현했습니다.

[Issue #228](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/228)은 **동네 지도**를 더합니다([설계](docs/superpowers/specs/2026-09-29-town-map-design.md), [결정 D-046](docs/DECISIONS.md)). 하단 탭이 `탐색 · 지도 · 방문 인증 · 도감` 네 칸이 되고, 지도 탭은 동네 그림 위에 가게 핀을 올립니다. 도장 받은 가게는 이중 테두리와 체크, 아직 안 간 가게는 점선이라 색만으로 구분하지 않습니다. 핀을 누르면 이름·도로명 주소·도장 상태·다음 목표와 `자세히 보기`·`길찾기` 카드가 올라오고, `길찾기`는 네이버 지도·카카오맵 앱(없으면 웹)을 **도로명 주소 검색**으로 엽니다. 그림 지도는 실제 위치·거리와 다르며 화면에도 그렇게 밝힙니다. 지도 API 키·과금 자원·위치 권한·새 의존성·API/DB 변경은 없고, 가상 점포는 실제 주소가 없으므로 길찾기 대신 이유를 보입니다. 탐색 머리글의 "지도로 보기" 칩으로도 들어갑니다. 이 기능도 **소스와 로컬 확인까지**이며 공개된 Preview 7 APK와 운영 test.3에는 들어 있지 않고 [시연 Preview 8 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.8)부터 들어 있습니다(Preview 8 APK 자체의 설치·지도 화면은 `NOT_RUN`). 실제 휴대전화(SM-S928N)에서 지도·핀 카드·길찾기 선택과 네이버·카카오 앱 열림, 함께 고친 도장판·보상 상자 이름 잘림 두 결함의 수정을 확인했고 외부 지도 앱 화면은 위치가 담겨 저장하지 않았습니다. 다크·글자 200%·TalkBack·웹 대체 경로·시연 빌드의 지도와 소유자의 판정은 `NOT_RUN`입니다([실폰 증거](docs/evidence/town-map-2026-09-29/README.md)).

[Issue #230](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/230)은 **친구**를 더합니다([설계](docs/superpowers/specs/2026-09-29-friends-design.md), [결정 D-047](docs/DECISIONS.md)). 서버는 별명·친구 코드(0·O·1·I를 뺀 8자리)·친구 관계·끊은 기록·코드 입력 실패 기록을 담는 migration 0028과 `GET·POST /me/friends`·`DELETE /me/friends/:id`·`POST /me/friend-code/rotate`·`PUT /me/profile`을 더합니다. 친구에게 보이는 값은 허용 목록으로만(별명·메달 3종 등급·배지 n/9·가본 가게 이름·순위) 만들고 방문 날짜·시각·횟수·쿠폰·지갑·계정 ID는 담지 않으며, 메달·도장·순위는 한국 날짜 기준 어제까지의 방문만 셉니다. 친구를 끊으면 그 계정으로는 다시 추가하지 못하고(계정 기준 차단), 코드 입력은 계정당 10분에 10회 실패까지 허용합니다. 앱은 하단 탭이 `탐색 · 지도 · 방문 인증 · 도감 · 친구` 다섯 칸이 되고, 친구 탭에서 내 카드(별명·큰 코드·QR·시스템 공유·코드 바꾸기)와 코드 입력 또는 QR 촬영 추가, 친구 순위를 보며 순위 행을 눌러 읽기 전용 친구 여권(메달·배지·도장 이름)을 엽니다. 가게 카드와 상세의 `친구에게 추천`은 가게 이름과 링크만 시스템 공유창으로 보냅니다. `https://masscom.kr/open#friend=CODE`·`#merchant=ID` 링크는 코드가 `#` 뒤라 서버에 가지 않고, 각 빌드는 자기 링크만 받지만 운영과 개발은 같은 `https://masscom.kr/open`을 쓰므로 둘 사이에는 격리가 없어 서로의 https QR이 상대 앱의 API까지 갑니다. 격리되는 것은 시연 앱뿐이며, 시연 앱은 `demo.masscom.kr`이 아직 없어 https 링크 대신 `masscom-demo://` QR과 앱 받기 안내만 씁니다. Android 앱 링크는 운영·시연에만 등록돼 있고 개발과 `www.masscom.kr`은 스캐너·붙여넣기로만 열립니다. 이 기능은 main `87e98f4`(PR #233)로 운영·시연 서버에 배포됐습니다. 운영·시연 API에 migration 0028(친구 테이블 5개)이 적용됐고 운영 웹의 개인정보·계정 삭제 안내에 친구 문구가 공개됐으며([배포 증거](docs/evidence/friends-deployment-2026-09-29.json)), 친구 탭이 든 [시연 Preview 9 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.9)는 공개 사전 릴리스이며 [Samsung 설치·첫 실행·친구 탭 불러오기](docs/evidence/showcase-preview9-release-2026-09-29.json)까지 확인했습니다. 운영 test.3 앱에는 친구 탭이 없었습니다(당시). 당시 최신이던 운영 test.4(`1e6bb37`)는 소스에 친구 탭이 `(tabs)/_layout`에 조건 없이 들어 있고 운영 API에 migration 0028이 있지만 운영 친구 흐름은 `NOT_RUN`이었고, 당시 최신 test.5(`7bcfef9`)에서도 확인하지 않았습니다(`NOT_RUN`). 운영 배포 스크립트가 migration 전에 자체 pg_dump 백업(`database-before-87e98f464218.dump.oIJ7Ui`, 95287바이트)을 만들었고 실제 복원은 `NOT_RUN`입니다. 두 시연 계정의 친구 추가·시스템 공유창·실제 App Link·시연 링크 열기는 `NOT_RUN`입니다([시험 상태](docs/TEST_STATUS.md)).

[Issue #236](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/236)은 **사장님 AI 가게 그림**을 더합니다([설계](docs/superpowers/specs/2026-09-29-ai-store-art-design.md), [결정 D-048·D-050](docs/DECISIONS.md)). 점주 권한이 있는 사람이 가게 이름·메뉴 이름(자유 문장 없음)으로 스타일이 다른 AI 시안 4장을 받고, 하나를 골라 고급 그림으로 다시 그려 고객 앱의 목록·지도·상세·도감에 가게 그림으로 씁니다. 서버는 migration 0029, 점주용 그림 API, 공개 그림 주소, OpenAI 이미지 클라이언트, 가게당 하루 한도와 환경별 월 예산(기본 USD 5, 넘으면 호출 전에 거절)을 더하고 OpenAI에는 가게 이름·메뉴 이름과 가게 id 해시만 보냅니다([개인정보처리방침](docs/privacy.html)에 OpenAI(미국)와 국외 이전을 적었습니다). 권한은 활성 OWNER에게만 주고 STAFF는 `AI_ART_STAFF_MAY_MANAGE=true`인 시연 환경에서만 허용하므로 **운영 키는 소유자 채널이 생길 때까지 비워 둡니다.** 키가 없으면 기능은 "준비 중"으로 꺼져 있고 다른 기능에는 영향이 없습니다. 이 기능은 main `f1bba2d`(PR #239)로 병합돼 운영·시연 서버에 배포됐습니다. 두 API에 migration 0029(가게 그림 테이블 4개)가 적용됐고 운영 웹의 개인정보처리방침에 OpenAI 항목이 공개됐으며([배포 증거](docs/evidence/ai-store-art-deployment-2026-09-30.json)), 두 서버의 기동 로그는 `AI store art: disabled (OPENAI_API_KEY is empty)`라 실제 생성은 아직 꺼져 있습니다. 점주 화면의 `가게 그림 만들기`가 든 [시연 Preview 10 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.10)는 공개 사전 릴리스이며 [Samsung 설치·첫 실행·`가게 그림 만들기` 화면의 "준비 중" 안내](docs/evidence/showcase-preview10-release-2026-09-30.json)까지 확인했습니다. 앞서 로컬 API·가짜 이미지 서버·실제 휴대전화(SM-S928N) 개발 빌드로 시안→선택→최종→적용→고객 화면 표시를 확인했고([시험 상태](docs/TEST_STATUS.md)), 실제 OpenAI 호출·비용과 지연 측정은 `NOT_RUN`입니다. 소유자가 2026-09-30 "OpenAI 키는 팀 결제가 확정되지 않아 나중에 넣는다. 넣었다는 가정하에 완성해 달라"고 해서([B-026](docs/BLOCKERS.md): 팀 결제 확정 대기) [Issue #256](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/256)에서 **켜기 준비**를 끝냈습니다([결정 D-058](docs/DECISIONS.md)): 월 예산 USD 5 확정, 서버에서 키 줄 하나로 켜고 끄고 살펴보는 [`enable-ai-art.sh`](infra/showcase-host/enable-ai-art.sh)(`enable`·`disable`·`status`. 키 값을 출력하지 않고 `runtime.env`를 고치지 않으며 `showcase-api`만 다시 만들어 `AI store art: enabled` 로그를 확인)와 가짜 `docker` 시험, 배포와 같은 Dockerfile 이미지에 가짜 키·가짜 OpenAI를 붙인 컨테이너 리허설(19개 시나리오 224개 확인 PASS: 켜진 기동 로그·시안 4장·고급 그림·적용·공개 그림·월 예산 소진·하루 한도·OpenAI 429/500/503의 한 번 재시도·400의 무재시도, [증거](docs/evidence/ai-art-enable-rehearsal-2026-09-30.json))입니다. 실제 키 입력과 실제 호출의 비용·지연은 팀 결제 확정 뒤이며 `NOT_RUN`입니다. 다음 단계는 결제 확정 뒤 소유자가 시연 서버 `/opt/masscom-showcase/runtime.env`에 `SHOWCASE_OPENAI_API_KEY`를 직접 넣고 [시연 호스트 안내](infra/showcase-host/README.md)의 순서대로 `enable`을 실행해 `AI store art: enabled`를 확인한 뒤 첫 실제 호출의 비용·지연을 재는 것입니다(운영 키는 계속 비웁니다).

[Issue #243](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/243)은 **직원이 잘못 처리한 방문·쿠폰을 되돌리고 직원 자기 적립을 보상에서 뺍니다**([설계](docs/superpowers/specs/2026-09-30-visit-coupon-reversal-design.md), [결정 D-051](docs/DECISIONS.md)). 점포 직원은 방문한 한국 영업일 안에 사유를 골라 방문을 취소하고(발행 전 보상 권리는 함께 취소, 이미 NFT를 보낸 방문은 거절), 쿠폰 사용은 10분 안에 되돌립니다. 관리자는 미사용 쿠폰을 사유와 감사 기록으로 무효로 합니다. 실제 점포에서 직원 계정으로 받은 방문(본인 적립, 또는 방문한 계정이 그 점포의 활성 직원)은 기록만 하고 진행·1/3/5회 보상·NFT·도감에 세지 않습니다. 점주 웹 `/merchant/`와 시연 앱 직원 화면에 "최근 방문·쿠폰 사용" 목록이 생기고 migration 0030을 더합니다. 소유자의 P0 승인 뒤 첫 구현이며 opus 보안 재리뷰는 APPROVE(🔴 0)를 냈고 그 후속을 반영했습니다. 이 기능은 [PR #245](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/245)로 main `1c59f9a`에 병합됐고 main `02cb7e7`로 운영·시연 서버에 배포돼 migration 0030이 적용됐습니다([배포 증거](docs/evidence/reversal-deletion-deployment-2026-09-30.json)). 실제 점원의 방문 취소·쿠폰 되돌리기의 기기 실행은 `NOT_RUN`입니다(시연 Preview 11에서는 점주 화면의 새 카드 두 개가 빈 상태로 보이는 것만 확인했고, 운영에는 아직 공개 점포가 없습니다). 병합 전 리뷰 기록은 [HANDOFF](docs/HANDOFF.md)를 따릅니다. 새 `VOIDED` 쿠폰·`CANCELED` 방문 행이 생긴 뒤에는 API를 `f1bba2d`로 되돌리지 않고 앞으로 고칩니다.

[Issue #253](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/253)은 **이용약관·첫 로그인 동의·보관 기간**을 실제로 지키게 합니다([설계](docs/superpowers/specs/2026-09-30-terms-consent-retention-design.md), [결정 D-059](docs/DECISIONS.md), 브랜치 `feat/253-terms-consent-retention`, 소유자가 2026-09-30 "추천방식으로 다 해줘"로 승인, main `d004d7f`까지 병합). [이용약관](https://www.masscom.kr/terms)(`docs/terms.html`)을 새로 만들었고, 로그인한 계정은 **운영 앱·시연 앱·웹 `/app/` 모두에서** 필수 세 개(만 14세 이상, 이용약관, 개인정보 수집·이용)에 동의해야 메인 화면을 쓰며 목적·항목·보유 기간·거부할 권리와 불이익 네 가지를 화면에서 읽을 수 있습니다. 서버(migration 0033 `account_consents`, `GET·POST /me/consent`, 웹 `GET·POST /api/web/consent`)는 약관·처리방침 버전(`terms-2026-09-30`·`privacy-2026-09-30`, 나중에 #257에서 2026-10-01로 올림)·시각·경로를 계정별로 기록하고 버전이 바뀌면 다시 묻지만, **이번에는 알리기만 하고 기존 쓰기 요청을 막지 않습니다**(옛 앱 호환, 차단은 후속 Issue). [개인정보처리방침](https://www.masscom.kr/privacy)은 "보관 기간 미확정"을 지우고 실제로 실행되는 기간과 OpenAI 문의처를 적습니다. 기간은 API 정리 명령(`npm run admin:retention -- run|report`, 컴파일본 `node dist/postgres/retention-command.js`: 만료·해지 세션과 만료 1일 지난 일회용 행, 끝난 삭제 접수·처리 기록·쿠폰 감사 1년, **접근권한 기록 3년**)과 운영·시연 호스트의 매일 작업(`infra/*/host-jobs`, 30일 지난 `*.dump*` 백업 삭제; **운영 배포가 설치·확인하고 시연은 소유자가 절차대로 함**), 컨테이너 로그 용량 순환(`json-file` 10 MB×3)과 PostgreSQL 오류 로그의 행 값·SQL 문 비기록(배포가 PostgreSQL을 필요할 때 한 번 다시 만들어 적용)으로 지킵니다. 자동 시험은 API 단위 250·PostgreSQL 통합 242(240 통과·2 건너뜀, migration 0032·0033 함께)·모바일 808·사이트 192를 통과했고, 이 기능은 PR #259로 병합돼 main `3f5b2fa`의 일부로 2026-09-30 운영·시연 서버에 배포됐습니다([배포 증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json)): 두 API에 migration 0033이 적용됐고, 운영·시연 호스트 모두 보관 기간 정리 작업이 설치돼 `systemd-analyze verify`가 무출력이며 첫 실제 실행이 성공했고(운영은 만료된 웹 세션 10개·지갑 챌린지 2개만 지우고 백업 삭제 0, 다음 운영 실행 2026-09-30 19:22:53 UTC), PostgreSQL은 같은 데이터 볼륨으로 다시 만들어 오류 로그의 행 값·SQL 문 비기록(`log_min_error_statement=panic`·`log_error_verbosity=terse`)과 컨테이너 로그 순환(10 MB×3)을 서버에서 확인했으며, `masscom.kr`·`www.masscom.kr`의 `/terms`·`/privacy`·`/account-deletion`은 저장소 `docs/` 파일과 같고 세션 없는 `GET /api/web/consent`는 401 `WEB_SESSION_INVALID`입니다. **`NOT_RUN`:** 운영 앱·웹 `/app/`의 새 동의 화면을 거치는 실제 Google 로그인과 실제 기기 표시, DB 백업 복원입니다. 시연 앱은 [Preview 12](docs/evidence/showcase-preview12-release-2026-09-30.json)에서 Samsung의 동의 화면 표시·제출을 확인했습니다([시험 상태](docs/TEST_STATUS.md), [인수인계](docs/HANDOFF.md)).

[Issue #246](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/246)은 **실제 점포를 SQL 없이 운영 관리자 웹에서 운영 시작합니다**([설계](docs/superpowers/specs/2026-09-30-store-go-live-design.md), [결정 D-054·D-055·D-023](docs/DECISIONS.md), [점포 온보딩 안내](docs/MERCHANT_ONBOARDING.md)). 메뉴·영업시간·주소와 가게 이름·사진 사용 동의서 참조 번호가 있어야 점포를 공개하고, 직원 등록 뒤 사업자등록증 원본과 점포 전화로 확인한 사람만 확인 기록 참조 번호와 함께 점주로 올립니다(점포당 2명, 관리자 본인 불가). 보상 혜택은 점주 동의 5항목·동의서 참조 번호·발급 상한이 있어야 등록하고, 캠페인은 관리자가 공개·중지합니다. 서비스에는 참조 번호만 남기고 사업자등록번호·이름·전화번호는 남기지 않습니다. 방문 보상에는 참여 등록이 필요 없고, 운영 NFT는 권리만 기록하며 고객 앱·웹에 "발행 준비 중"을 보입니다(시연 발행은 그대로). 이 기능은 PR #255로 병합돼 main `3f5b2fa`의 일부로 2026-09-30 운영·시연에 배포됐습니다([배포 증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json)): 운영 migration 0032·0033·0036이 `backward_compatible=yes`로 적용됐고(배포 전 운영 DB는 migration 0031·ACTIVE 점포 0곳) 운영 API는 `NFT_MINTING_MODE=PREPARING`으로 떠 있습니다. **`NOT_RUN`:** 인증된 관리자 브라우저에서 실제 점포 공개·점주 올리기·혜택 등록·캠페인 공개(배포 뒤 점포를 공개한 적은 없습니다)입니다([시험 상태](docs/TEST_STATUS.md)).

[Issue #254](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/254)는 **NFT 메타데이터를 발행 확정 때 고정합니다**([설계](docs/superpowers/specs/2026-09-30-nft-metadata-design.md), [결정 D-060](docs/DECISIONS.md)). 메타데이터는 `<가게 이름> 방문 도장`, 가게 이름·동네(행정동)·업종·방문 단계·캠페인과 사장님이 적용한 가게 그림(없으면 기본 도장)을 담고 주소·시각·주문·계정·지갑은 담지 않습니다. Worker가 발행 확정 트랜잭션에서 DB에 고정하므로 뒤에 가게 정보·그림이 바뀌어도 이미 발행한 토큰은 그대로이고, 공개 주소 `https://masscom.kr/nft-metadata/<series>/<tokenId>.json`(시연은 `https://demo-api.masscom.kr/…`)이 CORS·하루 캐시(거부 목록이 하루 안에 반영)로 내보냅니다. 시리즈를 만들 때 `createSeries`의 base URI는 `<출처>/nft-metadata/<nft_series.id>/`입니다. 동네·업종은 관리자 웹에서 넣고 점포 공개 조건과는 별개입니다. 발행 때 공개 중이 아닌 가게는 가게 정보 없이 방문 단계만 담고, 기본 도장은 판이 붙은 고정 주소(`/nft-metadata/default/mascot-stamp-v1.png`)이며, 가게 AI 그림에는 `그림: AI 생성` 속성이 붙습니다. 신고된 토큰·그림은 거부 목록으로 404가 됩니다. 앱의 발행 동의(판 `nft-mint-v2`)는 지갑 주소와 함께 가게 정보·방문 단계가 영구 공개되고 발행 시각이 체인에 남는다고 알립니다. 실증 토큰 파일은 그대로입니다. 이 기능은 PR #260으로 병합돼 main `3f5b2fa`의 일부로 2026-09-30 운영·시연에 배포됐고 두 API에 migration 0036이 적용됐습니다([배포 증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json)): 운영에서 없는 토큰 주소는 404(`application/json`·`no-store`·CORS `*` 한 줄), 기본 도장 `/nft-metadata/default/mascot-stamp-v1.png`는 200 `image/png` 26827바이트(고정 해시와 같음), 실증 토큰 `base-sepolia-proof/1.json`은 그대로 200입니다. 운영 발행은 여전히 준비 중(`PREPARING`, 배포 전 `nft_series` 0행)이라 새 토큰은 생기지 않으며 실제 발행·시리즈 생성·지갑·탐색기 표시는 `NOT_RUN`입니다.

[Issue #264](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/264)는 **AI 가게 그림의 권한 회수 경합과 계정 삭제 집계 경합**을 막습니다(코드만, 배포 없음). 시안 받기·고르기·적용·되돌리기 네 메서드가 자기 트랜잭션 안에서 계정의 현재 멤버십과 `MANAGE_ART` 자격(활성 OWNER, STAFF는 `AI_ART_STAFF_MAY_MANAGE`인 환경만)을 가게 행 `FOR SHARE`로 다시 확인합니다. 요청 시작 검사 뒤 본문을 읽는 사이에 회수·강등돼도 `MERCHANT_ACCESS_DENIED`로, 계정 삭제가 먼저 끝났으면 `ACCOUNT_DELETED`로 거절하고 상태를 바꾸지 않습니다(계정 삭제는 계정 잠금으로 직렬화). 이 확인 함수는 되돌리기·쿠폰 사용 취소·발급 쪽의 같은 확인과 공용이며 잠금 뒤 새 문장으로 멤버십을 읽어, 회수 커밋을 기다린 사이의 옛 스냅샷으로 통과할 수 있던 틈(그림 시험에서 재현, 그 두 경로에서는 재현하지 않음)도 함께 닫습니다. 계정 삭제는 취소 UPDATE를 먼저 하고 남은 비종결 작업 수로 `WAITING_FOR_MINT_FINALITY`·`COMPLETED`를 정해, 집계와 취소 사이에 워커 lease가 끼어도 `COMPLETED`로 굳지 않습니다. 운영 AI 키와 NFT 워커가 아직 없어 지금 도달하지 않으며 B-026·B-027 전에 필요한 수정입니다. 실제 워커·OpenAI 호출·운영 DB는 `NOT_RUN`입니다.

[Issue #263](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/263)은 **배포 롤백·백업 드릴·점포 공개 안내**를 2026-09-30 전체 점검 보고서(C02·C07·P02)에 맞춰 고칩니다: 시연 API health 실패는 더 이상 운영 API를 이전 버전으로 되돌리지 않고(배포만 `SHOWCASE_HEALTH_FAILED`로 실패하며 `DEPLOYED_COMMIT`은 새 커밋이다, 운영 확인 실패는 그대로 되돌린다), 롤백된 이전 API가 도는 동안 삭제 처리된 계정의 `platform_admin_audit.target_account_id`는 매일 정리 `run`의 `admin_audit_deleted_targets` 단계가 삭제 원장의 별칭으로 바꿔 스스로 복구되며, `scripts/db-restore-drill.sh`는 `umask 077`과 임시 파일→성공 시 이동으로 경로를 준 백업을 mode 600으로 쓰고 실패하면 이전 파일을 지키고, [점포 온보딩 안내](docs/MERCHANT_ONBOARDING.md)는 점포 공개(활성)와 고객 목록 노출(활성·공개·기간 안 캠페인과 1·3·5회 목표)을 나눠 씁니다. 운영 배포와 서버 실행은 하지 않았고(`NOT_RUN`) 시험 결과는 [시험 상태](docs/TEST_STATUS.md)에 있습니다.

[Issue #265](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/265)는 **늦게 도착한 응답이 화면을 되돌리는 세 곳과 동의 버튼 글자 잘림**을 고칩니다. 도감은 NFT 하나가 확정돼도 다른 NFT가 확인 중이면 계속 다시 묻고 오래된 응답만 버리며, 수령 코드는 입력이 바뀌면 이전 코드의 확인 응답을 버리고 확정은 현재 입력만 대상으로 하며, 삭제 접수번호는 다시 받기가 응답 없이 실패하면 이전 번호를 지웁니다. 동의 버튼 전체 문구의 실기 확인은 다음 시연 빌드 전까지 `NOT_RUN`입니다([검증 현황](docs/TEST_STATUS.md)).

[Issue #332](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/332)는 **모은 것을 자랑하고, 방문이 보상으로 이어지는 길을 보여 줍니다**(앱 화면만, 서버·보상 규칙은 그대로). 도감에 수집품이 하나 이상이면 **"인스타에 자랑하기"** 버튼이 보이고, 누르면 마스코트·"나의 월계 도감"·"N곳의 가게를 모았어요"·등급 틀(브론즈·실버·골드)에 담은 대표 수집품 최대 6장·메달 줄을 4:5 카드로 그려 1080×1350 이미지로 만든 뒤 기기 공유 시트(인스타그램 포함)로만 내보냅니다. 자동 게시는 없고, 카드에는 계정·별명·이메일·날짜·지갑·QR·친구 코드를 싣지 않으며(시험이 그런 값이 실린 응답으로 JSON 전체를 검사), 공유를 지원하지 않는 환경(웹 등)에서는 "공유를 지원하지 않는 환경이에요"라고 한국어로 알립니다. 방문 완료 카드는 이번 방문으로 실제 늘어난 마일리지(방문 전·후 상점 요약의 적립 합계 차이라 앱이 규칙을 짐작하지 않고, 읽지 못하면 줄을 감춥니다)·보유 마일리지·다음 등급까지 남은 방문 수("같은 가게는 하루 1번")를 보여 주고 "상점에서 뽑기" 버튼으로 상점 탭에 바로 이어 줍니다. 상점 화면에는 "마일리지로 캐릭터 뽑기" 제목과 한 줄 안내를 더했고, [시연 Runbook](docs/DEMO_RUNBOOK.md)에 뽑기(상점) 시연 순서와 하루 한 번 규칙을 적었습니다. 단위·소스 계약 시험은 통과했지만 실제 기기에서의 카드 모양·캡처 크기·인스타그램 공유 시트 노출은 `NOT_RUN`이며 사람 확인이 필요합니다([검증 현황](docs/TEST_STATUS.md)).
[Issue #342](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/342)는 방문 도장 뒤 이번 수집품·배지·상자·마일리지를 차례로 보여주고, 잔액이 충분하면 같은 상점 뽑기 기계로 이어 줍니다. 기계는 등급 선택·캡슐 개봉·캐릭터 결과를 보여주며 동작 줄이기와 건너뛰기를 지원합니다(앱 화면만 변경, 서버·보상 규칙 그대로; 실기 확인은 `NOT_RUN`).

[Issue #331](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/331)은 **탐색 목록의 메뉴 검색과 필터 칩**을 더합니다(운영·시연 앱이 같은 코드를 씁니다). 검색창은 "이름·메뉴·주소로 찾기"라서 가게 이름·소개·주소·캠페인 이름에 더해 **메뉴 이름**으로도 찾고, 가로 칩 두 줄이 목록을 좁힙니다. 위 줄은 **업종**(목록에 실제로 있는 업종과 "전체")이고, 아래 줄은 로그인하고 내 방문·쿠폰을 불러왔을 때만 나오는 **내 진행 상태**("보상까지 1번"·"안 가 본 곳"·"가 본 곳"·"쿠폰 쓸 수 있는 곳")입니다. 조건은 모두 함께 적용되고, 결과가 없으면 켜진 조건을 알려 주며 "필터 지우기"로 한꺼번에 풉니다. 서버는 `GET /merchants`에 가게 업종(`category`, 미지정은 null)을 더했을 뿐이고, 방문·쿠폰은 지도와 여권 칩이 이미 읽는 `/collection`·`/me/badges`를 다시 씁니다. 규칙은 단위 시험으로 확인했고 실기기 화면 확인은 `NOT_RUN`입니다.

## 한눈에 보기

<details>
<summary>개발 문서·검증 근거 전체 보기</summary>


- [모바일 개발용 UI 시안·로컬 실행](apps/mobile/README.md): 개발용 미리보기를 보존하고 시연 APK에는 첫 역할 선택·권한 확인·빈 공간 투어를 분리했다. 운영 앱의 기본 기능 탭은 유지하며 [시연 설치본 실기 범위](docs/evidence/showcase-android-apk-2026-09-27.json)를 따로 기록했다.
- 시연 Android 빌드·배포: 최신 [Preview 17 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.17)는 source `0fcdfe8`이며 [시연 전용 API·서명·익명 다운로드 재해시·에뮬레이터 가상 점포 B 상세](docs/evidence/showcase-preview17-release-2026-10-03.json)를 확인했다. Samsung 실기기·로그인은 `NOT_RUN`이다. 이전 기록: `kr.masscom.wolgye.demo`/`masscom-demo`, 전용 Google·Keychain 서명·[공개 API](https://demo-api.masscom.kr/health)를 사용한다. [당시 공개 Preview 16 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.16)는 [전용 API 주소·서명·에뮬레이터 역할 선택 화면](docs/evidence/showcase-preview16-release-2026-10-03.json)까지 확인했고 Samsung 실기기·로그인은 `NOT_RUN`이다. [이전 Preview 15](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.15)는 [Samsung 설치·로그인 뒤 흐름](docs/evidence/showcase-preview15-release-2026-10-02.json)을 확인했고 [Preview 14](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.14)는 [빌드 검사의 시연 API 주소 확인·Samsung 기존 앱 위 설치·로그아웃 상태 탐색 화면의 가상 점포 3곳](docs/evidence/showcase-preview14-release-2026-10-01.json)을 확인한 이전 설치본이고 [Preview 13](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.13)은 [소스·서명 인증서·빌드 시점 provenance·Samsung 기존 앱 위 설치·로그아웃 상태 탐색 화면의 가상 점포 3곳](docs/evidence/showcase-preview13-release-2026-10-01.json)을 확인한 이전 설치본이고(같은 소스로 먼저 만든 후보는 운영 API 주소가 들어가 게시하지 않았다: Issue #273) [Preview 12](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.12)는 [소스·서명 인증서·공개 자산 digest·Samsung 기존 앱 위 설치와 첫 실행·첫 로그인 동의 화면 표시·제출](docs/evidence/showcase-preview12-release-2026-09-30.json)를 확인한 이전 설치본이고 [Preview 11](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.11)은 [소스·서명 인증서·공개 자산 digest·Samsung 기존 앱 위 설치와 첫 실행·계정 삭제 요청 접수→취소](docs/evidence/showcase-preview11-release-2026-09-30.json)를 확인한 이전 설치본이며 실제 점원의 방문 취소·쿠폰 되돌리기·실제 AI 그림 생성·고객 화면의 AI 그림 표시·두 계정 친구 추가·시연 링크 열기·로그인 뒤 흐름은 `NOT_RUN`이다. [Preview 10](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.10)은 [소스·서명 인증서·공개 자산 digest·Samsung 기존 앱 위 설치와 첫 실행·점주 화면의 `가게 그림 만들기` 화면 열기](docs/evidence/showcase-preview10-release-2026-09-30.json)를 확인한 이전 설치본이다. [Preview 9](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.9)는 [소스·서명 인증서·공개 자산 digest·Samsung 기존 앱 위 설치와 첫 실행·친구 탭 불러오기](docs/evidence/showcase-preview9-release-2026-09-29.json)를 확인한 이전 설치본이다. [Preview 8](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.8)은 [소스·서명·공개 자산 digest](docs/evidence/showcase-preview8-release-2026-09-29.json)만 확인했고 휴대전화 설치는 `NOT_RUN`인 이전 설치본이다. [Preview 7](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.7)은 [Samsung 기존 앱 위 설치와 첫 실행](docs/evidence/showcase-preview7-release-2026-09-29.json)을 확인한 이전 설치본이다. [Preview 3](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.3)의 [Samsung 같은 계정 카메라 수령](docs/evidence/showcase-preview3-camera-claim-2026-09-28.json)과 Preview 1의 [두 계정 직접 코드 수령](docs/evidence/showcase-two-account-phone-2026-09-27.json)은 이전 설치본 실증이다. 새 2분 식별 QR의 두 계정·두 휴대전화 촬영→수령은 `NOT_RUN`이다.
- [시연 호스트 격리](infra/showcase-host/README.md): 기존 Lightsail의 독립 API/DB에 가상 A/B/C를 기동하고 두 초대 계정의 내부 발급→수령→도감·중복 방지를 [당시 내부 API 증거](docs/evidence/showcase-internal-auth-claim-2026-09-27.json)로 확인했다. [PR #192](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/192) 병합 뒤 **시연 API만** 새 고객 로그인 코드로 [배포](docs/evidence/showcase-open-login-api-deployment-2026-09-27.json)했다. 새 APK 기본 화면은 폰에서 확인했지만 초대 밖 실계정 로그인과 지갑/NFT는 별도 미검증이다.
- [기존 Lightsail의 포털·운영 웹 이관](infra/lightsail/README.md): AWS DNS·공인 TLS와 운영 웹 Google 로그인을 확인했습니다. [이전 apex/www 설치 안내](docs/evidence/public-open-page-2026-09-28.json)는 운영 test.3·시연 Preview 3을 공개 연결했습니다. [Preview 6 설치 안내](docs/evidence/public-open-preview6-deployment-2026-09-29.json)는 apex/www 공개 HTTPS에 반영됐고 소스 해시가 일치합니다(이후 웹 전용 재배포(PR #244 병합 main `f6fa12f`)로 공개 `/open`은 Preview 10 링크를 보입니다(2026-09-30 오케스트레이터가 `https://www.masscom.kr/open`에서 최신 링크가 Preview 10임을 확인했고 HTTP 200이며 경로는 후행 슬래시 없는 `/open`이다(`/open/`은 404); 이 문서에서 다시 확인하지는 않았습니다). Preview 11 링크는 [Issue #250](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/250) 문서 병합 뒤 웹 전용 재배포로 바뀝니다). 이후 main `3f5b2fa`의 운영 웹 배포 뒤 시점의 [배포 증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json)에서는 `/open`이 Preview 11을 안내했고, Preview 12 링크는 [Issue #261](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/261) 문서 병합 뒤 다음 운영 웹 배포로 바뀐다고 적었습니다(당시 기록). 2026-10-01 main `1e6bb37`의 운영 웹 배포 뒤 [배포 증거](docs/evidence/deployment-1e6bb37-2026-10-01.json)는 `https://masscom.kr/open`의 HTTP 200만 기록했고 안내 내용은 확인하지 않았습니다. 운영 test.4·시연 Preview 13 링크는 [Issue #274](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/274) 문서(PR #276)를 병합한 뒤 main `bdb0301`의 운영 웹 배포(`scripts/deploy-lightsail.sh --deploy`, 종료 0)로 라이브가 됐고, 그 뒤 [배포 증거](docs/evidence/deployment-7bcfef9-2026-10-01.json)에서 apex와 www의 `/open`이 test.4·Preview 13을 안내하고 서빙된 `open.html`의 SHA-256 앞 16자 `491f8f2461b768c0`이 그 시점 저장소 파일과 같음을 확인했습니다(2026-10-01). 이어진 main `7bcfef9` 배포에서는 `/open`의 HTTP 200만 기록했습니다. 운영 test.5·시연 Preview 14 링크는 [Issue #277](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/277) 문서 병합 뒤 다음 운영 웹 배포로 바뀌며 아직 배포 전입니다. Samsung Android Chrome의 서로 다른 Google 계정 2개 순차 로그인·빈 도감·세션 전환은 이전 웹 실증이고 [운영 test.3 APK의 폰 로그인](docs/evidence/operating-android-test3-2026-09-28.json)은 별도 확인했습니다. 실제 기록이 있는 계정 간 도감 격리는 미검증입니다.
- [운영·시연 API·웹 동시 배포(Issue #222)](docs/evidence/explorer-passport-deployment-2026-09-29.json): 2026-09-29 main `758f214`(PR #217·#219·#221)를 기존 Lightsail의 운영 API·웹과 시연 API에 배포했다. 운영 migration은 26→27(0027)이며 혜택·쿠폰·점주·시연 점주는 0건이고, 시연 API는 migration 18→27에 가상 체험 혜택 3건(A 음료·B 디저트·C 세트 할인)을 seed했다. `/presentation`은 404, 익명 `/api/web/badges`는 401·no-store, 두 API health는 200이다. [Preview 7 APK](docs/evidence/showcase-preview7-release-2026-09-29.json)는 공개했고 로그인 뒤 메달→상자→쿠폰→점원 사용 처리 실기는 `NOT_RUN`이다. 공개 `/open`의 Preview 7 링크는 이 문서 병합 뒤 웹 전용 재배포로 반영한다.
- [친구 운영·시연 배포(Issue #230·#234)](docs/evidence/friends-deployment-2026-09-29.json): 2026-09-29 main `87e98f4`(PR #233, main CI 36577029769 PASS)를 운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)과 시연 API에 배포했다. 운영은 API `758f214`·웹 `cd527dd`에서 `87e98f4`로 바뀌었고 migration 0028은 추가만 하는 변경이라 호환된다(배포 스크립트가 migration 전에 자체 pg_dump 백업 `database-before-87e98f464218.dump.oIJ7Ui` 95287바이트를 만들었고 실제 복원은 `NOT_RUN`). 시연 API는 배포 전 백업(mode 600)을 만든 뒤 이미지 `87e98f4`로 교체하고 host seed를 실행했다. 두 API에 친구 테이블 5개가 있고 두 API health는 200, 로그인 없는 `/me/friends`는 401이며 `masscom.kr`·`www`의 `/privacy` 본문 해시가 저장소 `docs/privacy.html`과 같다. [Preview 9 APK](docs/evidence/showcase-preview9-release-2026-09-29.json)를 공개했고 두 계정 친구 추가·시연 링크 열기(`demo.masscom.kr` 인프라 없음)는 `NOT_RUN`이다. 공개 `/open`의 Preview 9 링크는 Issue #234 문서 병합(PR #235) 뒤 웹 전용 재배포로 반영했다(2026-09-29 apex·www 확인).
- [사장님 AI 가게 그림 켜기 준비·컨테이너 리허설([Issue #256](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/256))](docs/evidence/ai-art-enable-rehearsal-2026-09-30.json): 2026-09-30 소유자가 키는 팀 결제 확정 뒤에 넣기로 해(B-026) 시연 서버의 키는 비어 있고, 켜기 준비만 끝냈다. `infra/showcase-host/enable-ai-art.sh`(켜기·끄기·상태)는 가짜 `docker` 시험 86회 실행(compose처럼 읽는 가짜 docker로 `export`·들여쓰기·콜론·중복·`$`·비ASCII·NUL·권한·심볼릭 링크 거절과 compose 미호출, 물려받은 셸 변수 무시, `bash -x` 무누출, 렌더된 키·한도 범위·설정 어긋남(config-hash) 거절, 켜기·끄기·키 바꾸기 성공, `status` 읽기 전용)을 통과하고 CI에 들어갔다. 진짜 Docker Compose(v2.29.7)와 진짜 컨테이너로도 임시 스택에서 13개 확인이 모두 PASS다(`scripts/rehearse-enable-ai-art-real-compose.sh`, 로컬 전용). 컨테이너 리허설(`scripts/rehearse-ai-art-container.sh`)은 배포와 같은 `infra/lightsail/api.Dockerfile` 이미지를 가짜 키·가짜 OpenAI(루프백)에 붙여 19개 시나리오 224개 확인이 모두 PASS(약 54초, 끝나면 컨테이너·DB·이미지 정리): `AI store art: enabled`/`disabled` 기동 로그, 시안 4장→고급 그림→적용→공개 그림 200·고객 목록 `artUrl`·되돌리기 404, 월 예산 USD 0.05에서 두 번째 라운드·최종 503 `AI_ART_BUDGET_EXHAUSTED`, 하루 한도의 429 `AI_ART_DAILY_LIMIT`, OpenAI 429·500·503의 한 번 재시도(성공·계속 실패)와 400·잔액 소진 429의 무재시도, `ai_art_spend`의 정확한 비용(한 흐름 135,940µUSD)과 실패 호출 0, 로그에 키 값 없음. 월 예산은 USD 5로 확정했고 운영 키는 계속 비운다(D-058). 이 준비는 PR #258로 병합돼 main `3f5b2fa`의 일부로 2026-09-30 운영·시연에 배포됐다([배포 증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json): 운영 `OPENAI_API_KEY`는 비어 있다). **실제 OpenAI 호출·실제 키 입력·서버에서의 `enable-ai-art.sh` 실행은 `NOT_RUN`이고**(B-026: 팀 결제 확정 대기) 실제 비용·지연 측정도 `NOT_RUN`이다.
- [사장님 AI 가게 그림 운영·시연 배포(Issue #236·#240)](docs/evidence/ai-store-art-deployment-2026-09-30.json): 2026-09-30 main `f1bba2d`(PR #239, main CI 36598828345 PASS)를 운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)과 시연 API에 배포했다. 운영은 `DEPLOYED_COMMIT`이 `f1bba2d`이고 migration 0029는 추가만 하는 변경(`87e98f4..f1bba2d`의 migration 차이는 `0029_merchant_art.sql`뿐)이라 호환된다. migration 전에 배포 스크립트의 자체 pg_dump 백업(`database-before-f1bba2dd347f.dump.dnZkTu`, 103256바이트)과 오케스트레이터가 먼저 만든 수동 백업(`pre-f1bba2d-20260930.dump`, 218항목·103256바이트·mode 600)이 있고 실제 복원은 `NOT_RUN`이다. 시연 API는 배포 전 백업(218항목·105671바이트·mode 600)을 만든 뒤 이미지 `f1bba2d`로 교체하고 host seed를 실행했다. 두 API에 `ai_art_spend`·`merchant_art`·`merchant_art_images`·`merchant_art_rounds`가 있고 기동 로그는 모두 `AI store art: disabled (OPENAI_API_KEY is empty)`다(운영 키는 D-050에 따라 비워 둔다). 운영 API health 200, 없는 sha의 `/merchant-art/<sha>.webp` 404, `/merchants`는 `{"merchants":[]}`, 시연 API health 200이며 `masscom.kr`·`www`의 `/privacy` 본문 해시가 저장소 `docs/privacy.html`(OpenAI 처리자·국외 이전 고지)과 같다. [Preview 10 APK](docs/evidence/showcase-preview10-release-2026-09-30.json)를 공개했고 실제 AI 생성은 `NOT_RUN`이다. 공개 `/open`의 Preview 10 링크는 Issue #240 문서 병합(PR #244, main `f6fa12f`) 뒤 웹 전용 재배포로 반영했고 2026-09-30 오케스트레이터가 `https://www.masscom.kr/open`에서 최신 링크가 Preview 10임을 확인했고 HTTP 200이며 경로는 후행 슬래시 없는 `/open`이다(`/open/`은 404), Preview 11 링크는 Issue #250 문서 병합 뒤 웹 전용 재배포로 반영한다.
- [방문·쿠폰 되돌리기와 계정 삭제 처리 운영·시연 배포(Issue #243·#194·#248·#250)](docs/evidence/reversal-deletion-deployment-2026-09-30.json): 2026-09-30 main `02cb7e7`(PR #245·#247, main CI 36643877980 PASS)를 운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)과 시연 API에 배포했다. 운영은 api·production-web 이미지 `02cb7e7c5998`이 2026-09-29T23:14:32Z에 시작해 healthy이고 `f1bba2d`에서 `02cb7e7`까지 migration 0030·0031은 호환 변경(`backward_compatible=yes`)이다: 0030은 널 허용 열·`badge_coupon_audit` 표·색인을 더하고 쿠폰 상태에 `VOIDED`를 허용하며 `reward_entitlements_unique_goal`을 같은 이름의 부분 제외 제약으로 바꾸고, 0031은 접수 표의 PK를 새 `id` 열로 옮기되 `account_id`의 고유 색인을 남겨 옛 API의 삽입 문장이 그대로 동작한다. migration 전에 배포 스크립트의 자체 pg_dump(`database-before-02cb7e7c5998.dump.bbiAOH`, 112234바이트)와 수동 `pre-02cb7e7-20260930.dump`(241항목·112234바이트·mode 600)가 있고, 시연 API는 배포 전 백업(241항목·114642바이트·mode 600)을 만든 뒤 이미지 `02cb7e7`로 교체하고 host seed(`SHOWCASE_HOST_SEEDED`)를 실행했다. 세 백업의 실제 복원은 `NOT_RUN`이다. 두 API health 200, 운영 `/merchants` `{"merchants":[]}`, 접수번호를 모르는 삭제 조회 404, 세션 없는 삭제 접수 401, Origin 없는 조회 403이며 `privacy.html`·`account-deletion.html` 본문 해시가 저장소 `docs/`와 같다(운영에서 계정·방문·쿠폰·삭제 요청은 만들지 않았고 확인은 읽기·거절뿐이다). 운영 기동 로그는 `AI store art: disabled (OPENAI_API_KEY is empty)` 그대로다. [Preview 11 APK](docs/evidence/showcase-preview11-release-2026-09-30.json)는 공개했고 [실기기 캡처](docs/evidence/reversal-deletion-2026-09-30/README.md)를 남겼다(접수번호 한 줄 수정은 PR #249). **`NOT_RUN`: 폐기용 실계정의 운영 삭제 접수·처리([B-020](docs/BLOCKERS.md)), 실제 점원의 방문 취소·쿠폰 되돌리기, 세 백업의 복원, TalkBack.** 새 `VOIDED` 쿠폰·`CANCELED` 방문 행이 생긴 뒤에는 API를 `f1bba2d`로 되돌리지 않고 앞으로 고친다. 공개 `/open`의 Preview 11 링크는 이 문서 병합 뒤 웹 전용 재배포로 반영한다(이후 main `3f5b2fa`의 운영 웹 배포 뒤 공개 `/open`은 Preview 11을 안내한다: 아래 Issue #261 배포 증거).
- [점포 운영 시작·약관 동의·NFT 메타데이터·AI 그림 켜기 준비 운영·시연 배포(Issue #261, 기능은 #246·#253·#254·#256)](docs/evidence/store-consent-nft-deployment-2026-09-30.json): 2026-09-30 main `3f5b2fa7ccf0c625cc40798aca393792bc4543a5`(PR #255·#259·#260·#258, 앞선 PR #249·#251 포함, main CI 36682556552 PASS)를 시연 API(수동 compose)와 운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)에 배포했다. **시연:** `/opt/masscom-showcase`에서 소스 전송·배포 전 백업(`pre-3f5b2fa-20260930.dump`, 262항목·128469바이트·mode 600, migrate 전에 만듦)·이미지 빌드·migrate·showcase-api 교체(`masscom-showcase-api:3f5b2fa`, 2026-09-30T08:58:09Z 시작, healthy)·host seed(`SHOWCASE_HOST_SEEDED`)를 했고 이전 `02cb7e7`(마지막 적용 0031)에서 migration 0032·0033·0036이 적용돼 34개, 마지막 `0036_nft_metadata.sql`이다(0034·0035는 아직 열려 있는 팀원 PR #257의 번호(당시; 이후 7bcfef9 배포에서 적용)). **운영:** 이전 `4081999`(API 코드는 `02cb7e7`)에서 migration 0032(상위 집합 감사 action CHECK·`lock_timeout`)·0033(새 표 하나)·0036(`NOT VALID` 시리즈 id CHECK·새 표)이 `backward_compatible=yes`였고 배포 전 운영 DB는 migration 0031·ACTIVE 점포 0곳·`nft_series` 0행이었다. 배포 전 백업 둘(수동 `pre-3f5b2fa-20260930.dump` 262항목·125622바이트·mode 600과 배포 스크립트의 자체 `database-before-3f5b2fa7ccf0.dump.2zniQM` 125622바이트)이 있고 두 호스트 백업의 실제 복원은 `NOT_RUN`이다. api·production-web 이미지 `3f5b2fa7ccf0`이 2026-09-30T09:00:27Z에 시작해 healthy이고 운영 API는 `NFT_MINTING_MODE=PREPARING`·`NFT_MINT_CONSENT_VERSION=nft-mint-v2`, `OPENAI_API_KEY`는 비어 있다(D-050). **PostgreSQL 재생성:** 운영은 배포가 `POSTGRES_RECREATED_FOR_LOG_SETTINGS`로 한 번, 시연은 `docker compose run --rm migrate`가 postgres 정의 변경 때문에 스스로 한 번 다시 만들었고(시연 안내의 사전 볼륨·지문 기록보다 먼저 일어남) 두 호스트 모두 같은 데이터 볼륨·첫 migration 시각이 그대로이고 로그 순환 10 MB×3·`log_min_error_statement=panic`·`log_error_verbosity=terse`가 적용됐음을 확인했다(시연은 그날 폰에서 접수·취소한 삭제 접수 2행도 그대로). 시연 호스트 안내는 이제 postgres 확인·재생성을 migrate 전에 하도록 순서를 적는다. **보관 기간 정리 작업:** 두 호스트에 설치돼 `systemd-analyze verify`가 무출력이고 첫 실제 실행이 성공했다(시연 2026-09-30 08:59:35 UTC 모든 단계 0·`install.sh --verify` 통과, 운영 만료된 웹 세션 10개·지갑 챌린지 2개만 삭제·백업 삭제 0, 다음 운영 실행 2026-09-30 19:22:53 UTC). **외부 HTTPS(읽기·거절뿐이며 운영에서 계정·방문·쿠폰·동의·삭제 요청은 만들지 않았다):** 두 API `/health` 200, `masscom.kr`·`www.masscom.kr`의 `/terms`·`/privacy`·`/account-deletion` 본문이 저장소 `docs/` 파일과 같음, 세션 없는 `GET /api/web/consent` 401 `WEB_SESSION_INVALID`, 없는 토큰의 NFT 메타데이터 404(JSON·`no-store`·CORS `*` 한 줄), 기본 도장 200 `image/png` 26827바이트(고정 해시와 같음), 실증 토큰 200, `/open`은 Preview 11 그대로. **후속(2026-09-30 18:30 KST 무렵):** 시연 [Preview 12 공개 사전 릴리스](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.12)를 게시했다(`3f5b2fa` 소스, SHA-256 `814ad92db647632609f65a308877cc1c4be97e3bb4b04be0b64d75642ddea3f4`, [릴리스 증거](docs/evidence/showcase-preview12-release-2026-09-30.json), Samsung 설치·첫 로그인 동의 화면 확인). (당시) 공개 `/open`은 이 문서 병합 뒤 다음 운영 웹 배포 전까지 Preview 11이었다(이후 웹 배포가 있었다: 아래 Issue #274·#277 항목). **`NOT_RUN`:** Preview 12의 발행 동의 v2 대화상자(지갑 연결 필요)·동의 거절→로그아웃·앱 안 링크 대상 페이지 내용·TalkBack·다크·글자 200%, 운영 Android test.4(당시 이 컴퓨터에 업로드 키 서명 설정이 없어 빌드 못 함, 이후 게시됨), 운영 앱·고객 웹 `/app/`의 새 동의 화면을 거치는 실제 Google 로그인, DB 백업 복원, 실제 관리자 브라우저의 점포 공개·점주 올리기. **API를 이 배포 아래로 되돌리지 않고 앞으로 고친다**([HANDOFF](docs/HANDOFF.md)의 롤백 메모). 이 브랜치는 문서와 증거 JSON만 바꾸고 앱·API·DB·서버는 바꾸지 않았다.
- [운영·시연 재배포와 운영 test.4·시연 Preview 13 공개(Issue #274)](docs/evidence/deployment-1e6bb37-2026-10-01.json): 2026-10-01 main `1e6bb37f255b152e3f31a12be3a4ef8d896700f4`(PR #266·#267·#268·#269·#270·#272)를 시연 API(수동 compose)와 운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)에 배포했다(서버 시계 2026-09-30 약 17:2x~17:5x UTC). **운영:** 배포 전 수동 백업 `pre-1e6bb37-20261001.dump`(135907바이트·mode 600·`pg_restore --list` 283줄, 실제 복원 `NOT_RUN`), `3f5b2fa`와 `1e6bb37` 사이에 `apps/api/migrations`·`apps/worker/migrations`·compose 파일·Caddyfile 변경이 없어 스키마는 0036 그대로, 깨끗한 분리 worktree에서 `--deploy`가 종료 0이었고 api `masscom-api:1e6bb37f255b`·production-web `masscom-production-web:1e6bb37f255b` healthy·caddy 재생성·postgres는 건드리지 않음(가동 8시간). 보관 기간 정리 작업을 다시 설치해 첫 실행이 성공했고 `web_sessions` 1건, 새 `admin_audit_deleted_targets`를 포함한 나머지 단계는 0건·`BACKUPS_DELETED 0`이다. **시연:** 배포 전 백업 `pre-1e6bb37-20260930.dump`(140367바이트·mode 600·283항목), 빌드, `run --rm -T migrate`("database migrations applied", 마지막 `0036_nft_metadata.sql`, postgres 재생성 없음·가동 8시간), `masscom-showcase-api:1e6bb37` healthy, `SHOWCASE_HOST_SEEDED`, 공개 `/merchants`가 가상 점포 3곳을 돌려준다(첫 시도는 도우미가 worktree가 아닌 메인 체크아웃의 HEAD를 봐서 아무것도 하지 않았고 `1e6bb37` worktree에서 다시 실행). **공개 HTTPS:** `api.masscom.kr/health` 200, `masscom.kr/open` 200, `www.masscom.kr/app/` 200, `masscom.kr/terms` 200, `demo-api.masscom.kr/health` 200, 로그인 없는 `api.masscom.kr/me/consent` 401. **앱 릴리스:** [운영 test.4](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.4)([증거](docs/evidence/operating-android-test4-2026-10-01.json))와 시연 [Preview 13](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.13)([증거](docs/evidence/showcase-preview13-release-2026-10-01.json))을 공개 사전 릴리스로 게시했다. Issue #271(동의 버튼 글자 잘림)은 test.4에서 실기로 확인돼 닫을 수 있다. **`NOT_RUN`:** 동의 제출 뒤의 모든 앱 흐름·지갑·QR·방문·NFT·TalkBack·다크·글자 200%·Play 업로드, 시연 앱 로그인 뒤 흐름, DB 백업 복원. 이 브랜치는 문서·증거 JSON·`docs/open.html`·포털 검사 기대값만 바꿨다(당시 기록: 공개 `/open`은 다음 운영 웹 배포 전까지 이전 링크였고, 이후 `bdb0301` 웹 배포로 test.4·Preview 13을 안내했다: 아래 Issue #277 항목).
- [운영·시연 서버 배포(`0fcdfe8`, Issue #356)](docs/evidence/deployment-0fcdfe8-2026-10-03.json): 2026-10-03 main `0fcdfe8cc5da500c308d9b2c92404777ef5b5fdc`(PR #355 병합 결과)를 두 서버에 배포했다. migration 0041 적용으로 두 DB의 `schema_migrations`는 41개다. 시연 API와 운영 API·웹은 healthy이고 공개 health·웹·`/open`은 HTTP 200이다. 라이브 `/open`은 이 문서 PR의 웹 재배포 전이어서 **여전히 test.7·Preview 16을 안내**한다. [운영 test.8](docs/evidence/operating-android-test8-2026-10-03.json)·[시연 Preview 17](docs/evidence/showcase-preview17-release-2026-10-03.json)을 공개 사전 릴리스로 게시했다. Preview 17은 Android 에뮬레이터에서 가상 점포 B의 1·3·5회 수집품 미리보기까지 PASS, 두 최신 APK의 Samsung 실기기는 `NOT_RUN`. 백업 복원과 웹 체험 번들 재빌드도 `NOT_RUN`.
- 이전 배포 상태(당시 기록): [운영·시연 서버 재배포(`65a0005`, Issue #352)](docs/evidence/deployment-65a0005-2026-10-03.json): 2026-10-03 main `65a0005285e1bfbc04af93903054685118633bff`(PR #351 병합 결과)를 두 서버에 배포했다. migration 0040 적용으로 두 DB의 `schema_migrations`는 40개다. 시연 API와 운영 API·웹은 healthy이고 공개 health·웹·`/open`은 HTTP 200이다. 운영 `/open`은 이 문서 변경의 웹 재배포 전이어서 **여전히 test.6·Preview 15를 안내**한다(서빙된 `open.html` SHA-256 앞 16자 `e902e6bdcb2ce892`). [운영 test.7](docs/evidence/operating-android-test7-2026-10-03.json)·[시연 Preview 16](docs/evidence/showcase-preview16-release-2026-10-03.json)을 공개 사전 릴리스로 게시했다. Preview 16은 Android 에뮬레이터 설치·역할 선택 화면까지 PASS, 두 최신 APK의 Samsung 실기기는 `NOT_RUN`. 백업 복원과 웹 체험 번들 재빌드도 `NOT_RUN`.
- [운영·시연 서버 재배포(`b8d981d`, Issue #321 마무리)](docs/evidence/deployment-b8d981d-2026-10-03.json): 2026-10-03 main `b8d981db48d8ed9644feb1cf7a904bb96094a66f`(PR #327 병합 결과, #322 시연 가상 점포 수집품 시드·#325/#326 앱 빌드 수정 포함)를 시연 API(수동 compose)와 운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)에 배포했다. 배포 전 둘 다 `a39b983`이고 사이에 migration이 없어 `schema_migrations`는 39개 그대로다. **시연:** 배포 전 백업 `pre-b8d981d-20261003.dump`(182049바이트·mode 600·338항목, 복원 `NOT_RUN`), 이미지 `masscom-showcase-api:b8d981d` healthy, host seed로 `campaign_collectible_publications` 0→3, 보관 기간 정리 타이머 재설치·검증·수동 실행 성공(`runtime.env`의 `MASSCOM_SHOWCASE_IMAGE_TAG`는 낡은 `7dba450`인 채로 명령줄에서 덮어써 배포). 웹 체험 번들은 다시 만들지 않았다(`NOT_RUN`, `a39b983` export 그대로). **운영:** migration 호환성 `backward_compatible=yes`, `--dry-run`·`--deploy` 종료 0, `masscom-api:b8d981db48d8`·`masscom-production-web:b8d981db48d8` healthy, 운영 DB `is_demo` 점포·`showcase_guest_trials`·`campaign_collectible_publications` 0, 공개 HTTPS 200과 **라이브 `/open`이 test.6·Preview 15를 안내**(서빙된 `open.html` SHA-256 앞 16자 `e902e6bdcb2ce892` = 저장소 파일). **실기:** Samsung SM-S928N 시연 Preview 15에서 가상 점포 C 테스트 방문 뒤 "받은 수집품 보기"가 나타나고 봉투 열기(#297)·"가상 점포 C 방문 수집품" NEW 1/1까지 확인했다(시연 서버에서 봉투 열기의 첫 실기 확인, Issue #322 해소, 스크린샷은 `docs/evidence/deployment-b8d981d-2026-10-03/`). 시연 앱이 콜드 스타트마다 역할 선택 화면을 보이는 점은 관찰로만 남긴다. 백업 복원·웹 체험 번들 재빌드·승인자 부트스트랩·실제 QR·NFT·지갑·Google Play는 `NOT_RUN`.
- [운영·시연 서버 재배포(`a39b983`, Issue #321 서버 부분)](docs/evidence/deployment-a39b983-2026-10-02.json): 2026-10-02 main `a39b983c02de032ea24602f635cca94bf6319d93`(PR #312 병합 결과)을 시연 API·웹 체험 번들과 운영 API·웹(`scripts/deploy-lightsail.sh --deploy`)에 배포했다. 배포 전 운영은 `61bde48`, 시연은 `7bcfef9`이고 migration 0037~0039를 적용해 두 DB의 `schema_migrations`가 39개다. 소유자가 "운영 배포 먼저, APK는 나중에"를 골라 순서를 바꿨고 **APK(Preview 15·test.6)는 만들지 않았으므로** 공개 설치본과 `/open`은 여전히 운영 test.5·시연 Preview 14다(당시 기록, 이후 b8d981d 배포로 해소). 실제 브라우저로 시연 웹 체험의 테스트 방문·도감·상점 뽑기를 확인했고 시연에서 봉투 열기는 닿지 못했다(Issue #322, 당시 기록, 이후 b8d981d 배포로 해소). 백업 복원·승인자 부트스트랩·웹의 실제 Google 로그인·지갑·QR·NFT는 `NOT_RUN`.
- [운영·시연 재배포(`7bcfef9`)와 운영 test.5·시연 Preview 14 공개(Issue #277, 기능은 PR #257 사진 수집품 제작기)](docs/evidence/deployment-7bcfef9-2026-10-01.json): 2026-10-01 main `7bcfef9fa52842f4a9a5a089a64293f6cd26df92`(PR #257 병합)를 운영 API·웹과 시연 API에 배포했다(서버 시계 2026-09-30 약 19:xx~20:xx UTC). **앞선 웹 전용 배포:** `bdb0301`(PR #276 문서·PR #275 스크립트, 런타임·스키마 변경 없음)을 배포 전 수동 백업 `pre-bdb0301-20261001.dump`(135830바이트·mode 600·283항목)와 `scripts/deploy-lightsail.sh --deploy`(종료 0)로 올렸고 apex·www `/open`이 test.4·Preview 13을 안내하며 서빙된 `open.html`(SHA-256 앞 16자 `491f8f2461b768c0`)이 저장소 파일과 같았다. **CI 사건:** PR #257의 CI 런 36761017176 첫 시도가 `시연 웹 라이트·다크 실제 브라우저 검사` 단계에서 67분 넘게 멈췄다(같은 시험은 로컬에서 약 5초에 통과). 강제 취소 뒤 다시 돌려(두 번째 시도) 성공했고 멈춘 원인은 조사하지 못했다(`NOT_RUN`). **운영:** `bdb0301`에서 `7bcfef9`로, 배포 전 수동 백업 `pre-7bcfef9-20261001.dump`(135830바이트·mode 600·283항목, 실제 복원 `NOT_RUN`), 호환성은 0034·0035가 표와 트리거만 더하고 이전 API가 호환, `database migrations applied`로 `schema_migrations` 36개(0036 뒤에 0034·0035가 적용됨), api `masscom-api:7bcfef9fa528`·production-web healthy·caddy 재생성, 보관 기간 정리 작업의 첫 실행 성공(`admin_audit_deleted_targets` 0·`BACKUPS_DELETED 0`). **시연:** `1e6bb37`에서 `7bcfef9`로, 백업을 만들었고(크기는 기록하지 않음) 마이그레이션 적용 후 `schema_migrations` 36개, `masscom-showcase-api:7bcfef9` healthy, `SHOWCASE_HOST_SEEDED`. **공개 HTTPS:** `api.masscom.kr/health` 200 `{"status":"ok"}`, `www.masscom.kr/app/` 200, `www.masscom.kr/merchant/` 200, `/open` 200, 로그인 없는 `www.masscom.kr/api/web/collectibles/x` 401. **앱 릴리스:** [운영 test.5](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.5)([증거](docs/evidence/operating-android-test5-2026-10-01.json))와 시연 [Preview 14](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.14)([증거](docs/evidence/showcase-preview14-release-2026-10-01.json))를 공개 사전 릴리스로 게시했다. **결과:** 처리방침 `privacy-2026-10-01`을 서버가 요구해 새 버전에 동의하지 않은 계정은 test.4와 Preview 12·13에서 '앱을 업데이트해 주세요' 안내에 막힌다(D-059·D-061). 소유자 조치: 운영 test.5에서 동의를 제출하고 시연 앱에 다시 로그인한다. **`NOT_RUN`:** 동의 제출과 그 뒤 모든 흐름, 사진 수집품의 기기 수령·재생, 점주 웹 제작기의 실제 사진·녹음 게시, 지갑, QR·방문·NFT, TalkBack·다크·글자 200%, Play 업로드, 내려받은 APK의 해시 재대조, DB 백업 복원. 이 브랜치는 문서·증거 JSON·`docs/open.html`·포털 검사 기대값만 바꿨고 공개 `/open`의 test.5·Preview 14 링크는 이 변경의 다음 운영 웹 배포 전까지 라이브가 아니다(아직 배포 전).
- [기존 서버 SSH 접속](docs/SERVER_ACCESS.md): 이 Mac의 `ssh masscom` 및 더블클릭 접속 파일 사용법. AWS 콘솔 로그인과 별개이며 개인키는 Git 밖에 보관

- [모바일 디자인 기준](DESIGN.md): 탐색·방문 인증·도감·내 정보와 읽기 전용 시연 웹의 파란 팔레트·접근성 원칙
- [AI 모델 사용 기준](docs/AI_MODEL_ROUTING.md): GPT‑6 Luna/Sol/Astra 작업별 사용처와 검증 경계
- [모바일 UI 변경 명세](docs/superpowers/specs/2026-09-23-mobile-ui-navigation-design.md): Issue #126의 범위·보존 조건·검증 기준
- [프로젝트 포털](docs/index.html): 흐름·아키텍처·평가 증거·결정 상태를 시각적으로 탐색
- [공개 프로젝트 포털](https://www.masscom.kr): 다운로드 없이 열리는 기존 AWS Lightsail의 실제 HTTPS 배포
- [Android 설치본 상태](docs/ANDROID_DOWNLOADS.md): 운영 테스트 APK와 별도 시연 APK의 설치 링크·패키지·미검증 범위
- [시연용 읽기 전용 웹](apps/showcase-web/README.md) · [운영용 읽기 전용 웹](apps/production-web/README.md): 별도 코드·데이터 경계. 기존 apex에서 Android Chrome의 서로 다른 2계정 순차 로그인은 확인했고, 새 www에서는 1계정 로그인·로그아웃과 apex 세션 유지까지 확인했습니다. www의 두 번째 계정과 기록이 있는 도감의 교차 노출은 미검증입니다.
- [현재 HTTPS 시연 웹](https://www.masscom.kr/preview/): 가상 점포 A·B·C 고정 예시. 기존 Vercel 주소는 장애 복구용으로 보존
- [공개 계정 삭제 안내](https://www.masscom.kr/account-deletion): 웹 Google 로그인(최근 10분 안)으로 본인을 확인해 접수하면 접수번호를 받고(24시간 안 취소 가능), 운영자가 접수 뒤 7일 안에 처리하며 접수번호로 결과를 조회합니다([D-052](docs/DECISIONS.md), [설계](docs/superpowers/specs/2026-09-30-account-deletion-processing-design.md)). 시연 앱은 앱 안에서 같은 방식으로 접수하고 운영자가 CLI로 처리합니다. 앱 안 직접 삭제의 5분 `auth_time` 조건(D-026)은 그대로입니다. 이 버전은 [PR #247](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/247)로 main `02cb7e7`에 병합돼 운영 API·웹과 시연 API에 배포됐고 migration 0031이 적용됐습니다([배포 증거](docs/evidence/reversal-deletion-deployment-2026-09-30.json): 접수번호를 모르는 조회 404·세션 쿠키 없는 접수 401·Origin 없는 조회 403, 관리자 웹에 `계정 삭제 요청`). 운영에서 접수하거나 처리한 계정은 없고([옛 접수 전용 배포 기록](docs/evidence/operating-deletion-intake-deployment-2026-09-28.json)은 이전 버전), 폐기용 실계정의 종단 실행은 `NOT_RUN`, Play 제출은 [미완료](docs/BLOCKERS.md)입니다.
- [공개 이용약관](https://www.masscom.kr/terms) · [개인정보처리방침](https://www.masscom.kr/privacy): 무료 개발 단계·양도 불가 NFT·점주가 제공하는 혜택·금지 행위·책임 한계와, 실제로 실행되는 보관 기간(계정 삭제 때까지, 세션 만료, 삭제 접수·감사 기록 1년, 백업 30일, 컨테이너 로그는 용량 기준)·OpenAI 문의처. 첫 로그인 동의로 두 버전을 기록한다
- [현장 검증 빈 기록지](docs/FIELD_VALIDATION.md): 동의·과업·결과를 미리 채우지 않은 양식
- [제출 체크리스트](docs/SUBMISSION_CHECKLIST.md): 승인 전 공개·태그·제출 금지 경계
- [제출 증거 manifest](docs/SUBMISSION_EVIDENCE.json): 2026-09-23 main 기준선(PR #130까지)의 CI·PR·스크린샷·BLOCKED/NOT_RUN 기계 판독 기록. 이후 상태는 [현재 상태](docs/PROJECT_STATE.md)가 우선
- [포털 시각 검증](docs/evidence/project-portal-visual-verdict.json): 데스크톱·모바일 뷰포트와 접근성 결과
- [현재 상태](docs/PROJECT_STATE.md): 실제 완료·미완료·BLOCKER
- 이슈 [#136](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/136)·[#137](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/137)은 미완료 상태로 다시 열었습니다. [시연 앱 진입 계획](docs/superpowers/plans/2026-09-24-issue136-showcase-entry.md), [외부 시연 전달 계획](docs/superpowers/plans/2026-09-24-issue137-showcase-delivery.md), [운영 웹 본인 도감 계획](docs/superpowers/plans/2026-09-24-issue137-production-collection.md)은 실행 계획이지 구현·실기 검증 완료 증거가 아닙니다.
- [제품 요구사항](docs/PRD.md): RQ-001~RQ-021
- [결정 기록](docs/DECISIONS.md): 승인·제안·외부 확인 구분
- [테스트 원장](docs/TEST_STATUS.md): v3 19절의 36개 ID와 실행 근거
- [Phase 1 지갑 연결](docs/PHASE1_WALLET_LINK.md): Android·Reown·SIWE 구현과 실제 MetaMask 검증
- [실제 Android 기기 증거](docs/evidence/android-physical-device.json): 빌드·설치·실행·복귀·MetaMask 준비 상태
- [실제 지갑 흐름 증거](docs/evidence/android-wallet-connection.json): 연결·체인 전환·서명·서버 확인·복원 결과
- [미설치 지갑 복귀 증거](docs/evidence/android-wallet-missing.json): 스토어 이동·수동 복귀·한국어 재시도 안내
- [지갑 주소 변경 증거](docs/evidence/android-wallet-address-change.json): 계정별 확인 격리와 MetaMask 세션 한계
- [음식점 탐색 Android 증거](docs/evidence/android-merchant-discovery.json): 지갑 없는 목록·상세·선택적 지갑 이동
- [방문 수령·도감 Android 증거](docs/evidence/android-claim-collection.json): 점주 권한·1회 코드·고객 수령·상태 분리
- [다음 가게 추천 Android 증거](docs/evidence/android-recommendations.json): 미방문 우선·이유 공개·정원 제외·상세 복귀
- [NFT 계약 로컬 증거](docs/evidence/foundry-contract-local.json): C01~C04·상한·reward key·영구 잠금·Anvil 발행
- [Phase 3 발행·복구 증거](docs/evidence/phase3-worker-anvil-android.json): W07·M01~M08·Android 접수/완료·재발행 없는 복구
- [계정 삭제·개인정보 증거](docs/evidence/account-deletion-privacy.json): D01·D03·Android 삭제 안내와 운영 경계
- [출시 준비 체크리스트](docs/RELEASE_READINESS.md): AAB·서명·16KB·App Links·Data safety·폐쇄 테스트
- [보안 경계](docs/SECURITY.md): 허용 메서드·nonce·의존성 위험
- [전체 보안 감사](docs/SECURITY_AUDIT_2026-09-20.md): Claude·독립 리뷰 HIGH 수정과 운영 전 MEDIUM
- [평가 대응표](docs/EVALUATION_MAP.md): 요구사항·Issue·PR·코드·시험·실증·발표 연결
- [Play Console 등록 초안](docs/PLAY_CONSOLE_DRAFT.md): 실제 Console 입력 전 준비한 텍스트·자료 초안

### 포털 로컬 미리보기

```bash
python3 -m http.server 4173 --directory docs
```

브라우저에서 `http://127.0.0.1:4173/`을 엽니다. GitHub Pages 공개 배포는 저장소 가시성과 조직 요금제를 확인한 뒤 별도 승인으로 진행합니다.

</details>

## 핵심 사용자 흐름

```mermaid
sequenceDiagram
    autonumber
    actor Staff as 시연 점주 앱
    participant API as 시연 API
    participant DB as 시연 PostgreSQL
    actor Customer as 시연 고객 앱
    Staff->>API: 서버 권한 확인 · 1회 코드 발급
    API->>DB: STAFF 확인 · 일회용 슬롯 저장
    API-->>Staff: QR 및 수령 코드
    Customer->>API: 코드 미리보기 · 직접 입력 수령
    API->>DB: 코드 소비 · 방문/보상 함께 기록
    API-->>Customer: 도감과 다음 가게 추천
    Customer->>API: 같은 코드 재확인
    API-->>Customer: 이미 사용됨 · 추가 효과 0
    Note over Staff,Customer: 시연 Preview 3 같은 계정 카메라 수령 PASS, 두 계정·두 기기 QR은 NOT_RUN
```

두 초대 계정의 Android **직접 코드 입력** 흐름은 [폰·DB 실측](docs/evidence/showcase-two-account-phone-2026-09-27.json)에서 확인했습니다. 지갑은 선택 기능이라 시연 앱에서 없어도 탐색·방문 인증·도감을 사용합니다. 앱 수집품과 실제 발행 NFT는 별도 상태이며, 시연 앱의 지갑·NFT는 아직 활성화하지 않았습니다.

## 실제 Android 화면

### 동네 지도(Issue #228): 실제 휴대전화 로컬 확인

아래는 이 기능을 반영한 개발 앱(`kr.masscom.wolgye.dev`)을 Samsung SM-S928N에서 촬영한 화면입니다. 일회용 로컬 API·PostgreSQL의 가상 시연 seed를 썼고 운영·시연 서버와 공개 APK는 쓰지 않았습니다. "검수용 동네 가게"는 길찾기 경로를 시험하려고 **로컬 QA DB에만** 넣은 가짜 가게이며 실제 협약 점포가 아닙니다. 모두 라이트 모드·기본 글자 크기이고, 오른쪽 위의 회색 톱니는 개발 클라이언트 도구 버튼입니다. 환경·결함·`NOT_RUN`은 [증거 README](docs/evidence/town-map-2026-09-29/README.md)에 있습니다.

| 지도 탭: 그림 지도와 핀 | 핀 카드: 길찾기 가능한 가게 |
| :---: | :---: |
| <img src="docs/evidence/town-map-2026-09-29/02-map-top-phone.png" width="250" alt="실제 휴대전화의 동네 지도 화면, 그림 지도 위에 도장 받은 가상 점포 A·B의 이중 테두리 핀과 아직 없는 C의 점선 핀"> | <img src="docs/evidence/town-map-2026-09-29/04-pin-sheet-real-phone.png" width="250" alt="검수용 가게 핀 카드, 아직 도장이 없어요와 자세히 보기·길찾기 버튼"> |
| **길찾기: 지도 앱 선택** | **가상 점포는 길찾기 대신 이유** |
| <img src="docs/evidence/town-map-2026-09-29/05-directions-chooser-phone.png" width="250" alt="어느 지도로 열까요 선택 창, 네이버 지도·카카오맵·취소"> | <img src="docs/evidence/town-map-2026-09-29/06-pin-sheet-demo-phone.png" width="250" alt="가상 점포 A 핀 카드, 길찾기 버튼 없이 가상 위치라 길찾기를 할 수 없어요 문구"> |

### 하늘 동네 개편(Issue #224): 에뮬레이터 로컬 확인

아래는 이 개편을 반영한 개발 앱(`kr.masscom.wolgye.dev`)을 Android 에뮬레이터 `MassCOM_Design_QA`(360dp)에서 촬영한 화면입니다. 로컬 API·일회용 PostgreSQL의 가상 시연 seed를 썼고 운영·시연 서버와 공개 APK는 쓰지 않았습니다. **휴대전화에 설치한 화면이 아니며** 공개된 어떤 APK에도 아직 들어 있지 않습니다. 전후 비교와 결함·`NOT_RUN`은 [증거 README](docs/evidence/sky-town-redesign-2026-09-29/README.md)에 있습니다.

| 도감 표지: 하늘 그림 위 머리글과 여권 | 방문 인증(다크): 도장 카드와 마스코트 |
| :---: | :---: |
| <img src="docs/evidence/sky-town-redesign-2026-09-29/04-collection-top-light.png" width="250" alt="에뮬레이터의 하늘 동네 도감 화면, 동네 산책가 배지 2/9와 떠 있는 세 칸 탭 바"> | <img src="docs/evidence/sky-town-redesign-2026-09-29/05-claim-dark.png" width="250" alt="에뮬레이터의 다크 방문 인증 화면, 도장을 든 마스코트와 점선 도장 카드"> |
| **글자 200% 탐색** | **역할 선택 시안(개발 빌드)** |
| <img src="docs/evidence/sky-town-redesign-2026-09-29/08-explore-font200.png" width="250" alt="글자 200%에서 줄바꿈되는 탐색 화면 머리글과 여권 칩"> | <img src="docs/evidence/sky-town-redesign-2026-09-29/07-role-preview-light.png" width="250" alt="에뮬레이터의 역할 선택 시안, 손을 흔드는 마스코트와 하늘 동네 그림"> |

### 개편 전 화면(2026-09-27 촬영한 이전 UI)

아래는 마스코트 UI를 반영한 시연 APK(source `c956d1f`, [#185](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/185)·[#186](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/186))를 Samsung SM-S928N·Android 16에서 촬영한 화면입니다([실기 기록](docs/evidence/ui-mascot-2026-09-27/device-check.json)). [Preview 1 Release](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.1)의 APK는 이전 UI(source `c53c199`)이며, 이전 화면은 [기록 폴더](docs/evidence/readme-showcase-2026-09-27/)에 보존합니다. 점포·방문·수집품은 모두 **가상 시연 데이터**이며 화면 이미지는 기획 목업이 아닙니다.

| 시연 진입 | 가상 점포 탐색·마스코트 배너 |
| :---: | :---: |
| <img src="docs/evidence/ui-mascot-2026-09-27/role.png" width="250" alt="실제 시연 앱의 사용자·점주 역할 선택 화면"> | <img src="docs/evidence/ui-mascot-2026-09-27/explore.png" width="250" alt="실제 시연 앱의 마스코트 배너와 가상 점포 목록 탐색 화면"> |
| **도감 스탬프판: 방문 2 · 앱 수집품 1 · 실제 NFT 0** | **다음 가게 추천: 가본 곳만 스탬프** |
| <img src="docs/evidence/ui-mascot-2026-09-27/collection.png" width="250" alt="실제 시연 앱의 방문 2건, 앱 수집품 1개, NFT 0개와 스탬프 1/3 도감 화면"> | <img src="docs/evidence/ui-mascot-2026-09-27/recommendations.png" width="250" alt="실제 시연 앱의 미방문 가상 점포 우선 추천 화면, 방문한 점포에만 마스코트 스탬프"> |

### 가상 점포별 수집품 그림

가상 점포 A·B·C의 [카드 그림 3종과 적용 기준](docs/SHOWCASE_COLLECTIBLE_ART.md)을 만들었습니다. [Preview 2 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.2)에서는 해당 점포의 **본인 도감에 존재하는 가상 보상권 카드에만** 그림을 보여줍니다([새 APK 실기](docs/evidence/showcase-collectible-art-2026-09-27/device-check.json)). 아래는 이미지 자산 미리보기이지 발행 완료 NFT나 세 점포의 수집 실적이 아닙니다.

| A | B | C |
| :---: | :---: | :---: |
| <img src="apps/mobile/assets/images/collectibles/showcase-a.png" width="180" alt="가상 점포 A 수집품용 마스코트 그림"> | <img src="apps/mobile/assets/images/collectibles/showcase-b.png" width="180" alt="가상 점포 B 수집품용 마스코트 그림"> | <img src="apps/mobile/assets/images/collectibles/showcase-c.png" width="180" alt="가상 점포 C 수집품용 마스코트 그림"> |

외부 지갑의 NFT 썸네일은 별개입니다. 현재 실증 메타데이터에 이미지 URI가 없어 이번 앱 그림을 온체인 표시 완료로 계산하지 않습니다. 앞으로 발행하는 토큰은 발행 확정 때 고정한 메타데이터에 가게 그림 또는 기본 도장 이미지 주소가 들어갑니다(Issue #254, 실제 발행은 `NOT_RUN`).

## 단계별 진행

| 단계 | 확인된 것 | 아직 남은 것 |
| --- | --- | --- |
| 0 · 기반 | 저장소·CI·요구사항·평가 근거 | 심사 시 공개 전환은 별도 승인 |
| 1 · 외부 지갑 | 개발 앱의 MetaMask 주소 확인 서명·서버 검증 | 시연 APK의 전용 Reown 연동, 동일 세션 주소 변경·미지원 지갑 실기 |
| 2 · 방문·도감 | 시연 APK 두 계정 직접 코드 수령과 같은 계정 카메라 QR 촬영→수령·앱 도감 | 서로 다른 두 계정/두 휴대전화 QR, 실제 제휴 점포 |
| 3 · NFT | Local Anvil·Base Sepolia 발행/복구 검증 | 시연 앱 별도 지갑·발행 연동, 메인넷은 별도 승인 |
| 4–5 · 출시·실증 | 개인정보 안내·발표 자료·private 시연 APK | Play 제출·현장 실증·최종 제출 |

[36개 필수 시험 ID와 실행 근거](docs/TEST_STATUS.md)에서 `PASS / BLOCKED / NOT_RUN`을 구분합니다. 목표 인원·점포 수는 확보 실적이 아닙니다.

## 실제 기능 상태

방문 인증한 가게에 특징 태그(최대 3개)·바라는 점(최대 2개)·100자 의견을 남기거나 고칠 수 있습니다. 공개 화면은 태그 집계만, 점주 웹은 바라는 점과 의견도 보여 줍니다(Issue #334 2단계, 실기 검증 전).

| 영역 | 상태 | 증거 또는 다음 조건 |
| --- | --- | --- |
| 저장소·문서·CI 기준선 | `VERIFIED` | PR #2·#4 merge, GitHub Actions PASS |
| 프로젝트 포털 | `VERIFIED` | PR #6, CI PASS, 접근성·반응형 증거 저장 |
| 운영용 웹 | `IN_PROGRESS` | AWS HTTPS `/app/`·공개 점포 0건, 데스크톱 본인 빈 도감·새로고침·로그아웃·익명 401 PASS. Samsung Android Chrome에서 Google A/B 순차 로그인, A 로그아웃 후 B 세션 유지 PASS. 실제 기록이 있는 계정 간 격리·최신 Android APK는 `NOT_RUN` |
| Android 고객 앱 | `IMPLEMENTED` | Expo 57 dev-client, Android 16 AVD와 Samsung SM-S928N 실기기 debug APK 설치·실행·복귀 |
| Android 기본 UI 네 탭 | `VERIFIED` | 탐색·방문 인증·도감·내 정보, 360dp·200% 글씨·실시간 다크 모드·뒤로 가기·개발 scheme를 Samsung Android 16에서 확인. 모바일 자동 146개·typecheck·lint·Android export PASS([증거](docs/evidence/android-ui-navigation-2026-09-23.json)) |
| 탐색 검색·참여 상태 필터 | `IN_PROGRESS` | 공개 API가 반환한 실제 점포 이름·주소·이야기·캠페인만 로컬 검색. 모바일 148개 자동 시험 PASS. Samsung에서 실제 0건의 라이트·다크·상태표시줄을 확인했으나 점포가 없어 검색·필터 실기는 `NOT_RUN`([증거](docs/evidence/android-discovery-2026-09-23.json)) |
| 공개 점포·캠페인 API | `IMPLEMENTED` | PR #14 merge `a27d0d0`, main CI run `35300158651` PASS |
| Android 음식점 목록·상세 | `VERIFIED` | PR #45, Samsung Android 16에서 DEMO 3곳 목록→상세→선택적 지갑 이동 PASS |
| 점주·직원 권한 API | `IMPLEMENTED` | PR #18 merge `e242c99`, main CI run `35302502498` PASS |
| 일회용 QR 슬롯 API | `IMPLEMENTED` | PR #20, 원문 미저장·버전 잠금 재발급·preview·단일 소비 기반 |
| 방문·고정 보상권 | `IMPLEMENTED` | PR #22, QR 소비·KST 일일 진행·첫/3/5회 보상권을 한 DB 트랜잭션으로 처리 |
| 점주·직원 방문 확인 UI | `VERIFIED` | PR #46, loopback DEMO 계정의 STAFF 권한 확인→1인 코드 발급·재발급 Android 실기 PASS; 운영 인증·별도 웹은 미구현 |
| 고객 방문 수령·도감 | `VERIFIED` | PR #46, preview→redeem→방문 1·앱 수집품 1·실제 NFT 0 분리 표시와 중복 409 PASS |
| 다음 음식점 추천 | `VERIFIED` | PR #47, 정원 마감 제외·미방문 우선·다음 고정 보상 설명·한국 날짜별 회전·상세 연결 PASS |
| 캠페인 참여 등록 API | `IMPLEMENTED` | Issue #73, `POST /campaigns/:id/enrollments` 정원 원자 예약·멱등 재요청, R02 PostgreSQL 동시 20요청 PASS. Android 참여 화면과 수령 시 등록 요구는 미구현(`PLANNED`) |
| 주소 확인 API | `IMPLEMENTED` | ERC-4361 challenge·실제 서명 복구·nonce 소비 15 tests PASS |
| PostgreSQL | `IN_PROGRESS` | 점포·캠페인·멤버십·claim slot·방문·보상권·지갑 challenge·Google session migration 구현. Lightsail 사설 Compose DB에서 migration·session 발급 확인, 외부 백업 복원은 `NOT_RUN` |
| NFT 계약 | `VERIFIED` | Foundry 8/8·fuzz 128·Anvil 발행과 Base Sepolia 계약·role·cap 1 proof series·Worker token #1 PASS |
| wallet binding·mint job·Outbox | `IMPLEMENTED` | PR #50, SIWE 영속화·동시 20요청 job/Outbox 하나·고정 수령인 PostgreSQL 통합 PASS |
| Worker | `VERIFIED` | PR #51, PostgreSQL lease heartbeat·시도·이벤트·자산, 체인 설정 사전 검사, receipt/event/state 대조, 응답 유실·lease·재조직 전 확정 복구를 로컬 Anvil에서 검증 |
| Reown 외부 지갑 코드 | `IMPLEMENTED` | AppKit 2.0.6, 외부 지갑 전용 기능 플래그·메서드 allowlist |
| 외부 지갑에 표시할 서비스 출처 | `IN_PROGRESS` | [PR #134](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/134)에서 메타데이터를 `https://masscom.kr`과 기존 포털 표식으로 변경. 공개 자산 HTTPS는 `VERIFIED`; MetaMask 재연결은 지갑 잠금으로 `BLOCKED`, 운영 APK 반영은 `NOT_RUN` |
| 외부 지갑 실기 | `VERIFIED` | MetaMask 핵심 흐름·W06 PASS; W04 동일 세션 주소 전환과 W05 미지원 스마트지갑은 준비된 외부 환경 부재로 `BLOCKED` |
| NFT 발행 전체 흐름 | `VERIFIED` | Local Anvil 장애·복구와 Base Sepolia PostgreSQL job/Outbox→암호화 service minter→receipt/event/owner/locked→DB FINALIZED·재실행 무작업 PASS |
| 계정 삭제·개인정보 | `IN_PROGRESS` | D01·D03 로컬 PASS. Google 웹 세션에 묶인 **삭제 의사 접수**는 [운영 HTTPS 배포](docs/evidence/operating-deletion-intake-deployment-2026-09-28.json)와 미로그인 401·Origin 없는 요청 403까지 확인(접수만 있던 이전 버전). [5분 재인증·발행 최종성 보안 수리](docs/PRIVACY_DELETION.md)도 서버에 반영. D-052의 접수번호·24시간 취소·운영자 처리·접수번호 조회는 코드와 로컬 시험을 마치고 main `02cb7e7`로 운영·시연에 배포했지만([배포 증거](docs/evidence/reversal-deletion-deployment-2026-09-30.json)의 조회 404·세션 없는 접수 401 등 읽기·거절 확인뿐) 폐기용 실계정의 종단 실행은 미완료([B-020](docs/BLOCKERS.md)) |
| 외부 HTTPS·Play 제출 | `IN_PROGRESS` | 공개 API·포털 HTTPS와 [GitHub 운영 test.8 APK](docs/evidence/operating-android-test8-2026-10-03.json)의 서명·공개 다운로드 PASS, Samsung 실기기 설치·로그인 `NOT_RUN`; [test.6 Samsung 설치·세션 복원·화면 확인](docs/evidence/operating-android-test6-2026-10-02.json) PASS(이전). Play App Signing OAuth·Console 제출은 `NOT_RUN/BLOCKED` |
| 점포 실운영(운영 관리자 웹) | `IN_PROGRESS` | [Issue #246](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/246), PR #255 병합, main `3f5b2fa`로 운영·시연 배포([증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json)): migration 0032·0033·0036 적용, `NFT_MINTING_MODE=PREPARING`. 인증된 관리자 브라우저의 실제 점포 공개·점주 올리기·혜택 등록·캠페인 공개는 `NOT_RUN`이며 운영 점포는 0곳 |
| 방문 취소·쿠폰 되돌리기 | `IMPLEMENTED` | [Issue #243](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/243), PR #245 병합 main `1c59f9a`, main `02cb7e7`로 운영·시연 배포·migration 0030 적용([증거](docs/evidence/reversal-deletion-deployment-2026-09-30.json)). 시연 Preview 11에서 점주 화면 새 카드 두 개의 빈 상태만 확인했고 실제 점원의 방문 취소·쿠폰 되돌리기 기기 실행은 `NOT_RUN` |
| 약관·첫 로그인 동의·보관 기간 | `IN_PROGRESS` | [Issue #253](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/253), PR #259·#257 병합, migration 0033 적용, 보관 기간 정리 작업이 운영·시연 호스트에 설치돼 첫 실행 성공([증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json)). 운영 test.5에서 새 처리방침(`privacy-2026-10-01`) 필수 동의 화면 표시 PASS([증거](docs/evidence/operating-android-test5-2026-10-01.json))지만 실제 계정 제출은 하지 않았다. 시연 앱의 동의 제출은 `BLOCKED`: 아직 동의하지 않은 허용 계정이 기기 Google 계정 선택기에 나타나지 않고(23개 등록 계정 중 18개만 표시), 계정 추가는 비밀번호가 필요해 시도하지 않았다([증거](docs/evidence/device-captures-2026-10-01/README.md)) |
| NFT 메타데이터(가게·동네·업종·그림 고정) | `IMPLEMENTED` | [Issue #260](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/260), PR #260 병합, migration 0036 적용, 공개 `GET/HEAD /nft-metadata/...` 경로 운영·시연 HTTPS 확인(없는 토큰 404, 기본 도장 200)([증거](docs/evidence/store-consent-nft-deployment-2026-09-30.json)). 운영 발행이 `PREPARING`이라 새 형식 메타데이터를 실제로 담은 토큰은 아직 없어 `NOT_RUN` |
| 사장님 AI 가게 그림 | `IMPLEMENTED`(꺼짐) | [Issue #236](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/236)·[#256](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/256), PR #239·#258 병합·배포. 운영·시연 두 서버 모두 `OPENAI_API_KEY`가 비어 `AI store art: disabled` 상태([B-026](docs/BLOCKERS.md), 팀 결제 확정 대기). 가짜 OpenAI로 켜기 리허설 19개 시나리오 224개 확인 PASS([증거](docs/evidence/ai-art-enable-rehearsal-2026-09-30.json)); 실제 OpenAI 호출·비용·지연은 `NOT_RUN` |
| 친구(코드·QR 추가, 여권 보기) | `IN_PROGRESS` | [Issue #230](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/230), PR #233 병합 main `87e98f4`로 운영·시연 배포([증거](docs/evidence/friends-deployment-2026-09-29.json)). 친구 탭이 든 [시연 Preview 9 APK](docs/evidence/showcase-preview9-release-2026-09-29.json)의 Samsung 설치·친구 탭 불러오기 PASS. 두 시연 계정의 실제 친구 추가·시스템 공유창·App Link 열기는 `NOT_RUN` |
| 하늘 동네·탐험 여권(메달·상자·쿠폰·지도) | `VERIFIED` | [Issue #216](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/216)·[#224](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/224)·[#228](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/228), 에뮬레이터·Samsung 실기에서 방문→축하→상자→쿠폰→점원 사용 처리 확인([증거](docs/evidence/explorer-passport-emulator-2026-09-29/README.md)). 운영 혜택은 0건이고 TalkBack 낭독·시연 빌드 반영 확인은 `NOT_RUN` |
| 사진 수집품 제작기 | `IMPLEMENTED` | [Issue #329](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/329) 폰 개편은 `feat/329-creator-wizard-mobile`에서 4단계 펼침·접힘, 전체 화면 작업 영역, 고정 머리글·하단 바, ⋯ 메뉴, 뒤로가기와 음성 파형을 구현했다. 로컬 QA fixture 브라우저 화면과 347/347 시험·gate는 PASS, Samsung 실기·Android 제스처 뒤로가기·기기 실제 음성 파형은 `NOT_RUN`이며 이 개편의 운영 배포 근거는 아니다([화면 구성](docs/COLLECTIBLE_CREATOR.md#화면-구성-issue-329-2026-10-03), [검증·캡처](docs/TEST_STATUS.md)). [Issue #252](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/252), PR #257 병합 main `7bcfef9`로 운영·시연 배포, 운영 test.5·시연 Preview 14부터 포함(현재 최신은 test.8·Preview 17)([증거](docs/evidence/deployment-7bcfef9-2026-10-01.json)). 시연 앱 도감 카드의 실기 확인(라이트·다크·글자 200%, 잘림 없음)은 PASS했지만 이 카드는 일반 보상권이고, `artwork`가 있는 #257 수집품의 native 상세 화면은 보유 허용 계정이 없어 `NOT_RUN`이다([실기 캡처](docs/evidence/device-captures-2026-10-01/README.md)). 실제 브라우저 녹음 업로드·실제 카메라 사진은 `NOT_RUN`([세부](docs/COLLECTIBLE_CREATOR.md)). [Issue #284](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/284) 표현 v2(스티커 배치·뒷면·모션 재생·인사말 개별화·패럴랙스·living picture·각도 프레임·기울임)는 스키마·웹 A·Android·웹 B 네 WP가 모두 코드·node/모바일 단위 시험으로 완료됐다(세부는 [COLLECTIBLE_CREATOR.md](docs/COLLECTIBLE_CREATOR.md#wp3-웹-b-구현-결과-issue-284-2026-10-02--네-wp-전부-완료)). 실제 브라우저로 패럴랙스·living·각도 프레임을 눈으로 확인하는 스크린샷과 Android 실기기·에뮬레이터의 새 필드 조합 확인은 `NOT_RUN`이다 |
| 발견→방문→다음 방문 연결과 점주 효과 지표 | `IMPLEMENTED`(운영·시연 배포) | [Issue #354](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/354): 가게 상세에 방문 전 수집품 미리보기(등급 그림·획득 조건)·내 진행·길찾기, 방문 뒤 상태별 주요 행동 하나, 도감·수집품·친구 여권에서 가게로 연결, 홈 다음 목표. 점주 웹 체크리스트의 항목별 해결 동작과 제작기 첫 시작 기본값, 점주 앱의 방금 처리한 방문·쿠폰 되돌리기. 점주 현황의 첫/재방문·수집품 획득·쿠폰 발급 대비 사용·가게 상세 조회, 운영자 흐름 지표. 조회는 계정·기기·IP 없이 가게·날짜·경로별 횟수만 센다(D-071). 지표는 방문 인증 기준이며 매출이 아니다(D-072). [0fcdfe8 배포](docs/evidence/deployment-0fcdfe8-2026-10-03.json)·[Preview 17 가상 점포 B 상세](docs/evidence/showcase-preview17-release-2026-10-03.json) 확인. Samsung 실기와 로그인 뒤 흐름은 `NOT_RUN` |
| 시연 전부 체험(보너스 마일리지·서로 다른 날의 테스트 방문) | `IMPLEMENTED`(시연 서버만, 미배포) | [Issue #333](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/333), [D-068](docs/DECISIONS.md): 시연 앱에서 `테스트 방문 만들기`를 같은 점포에 5번 누르면 오늘부터 하루씩 앞선 서로 다른 날로 세어져 1·3·5회에 브론즈·실버·골드 수집품이 나오고, 상점에는 시연 체험 마일리지 100,000P가 더해져 골드까지 뽑을 수 있다(상점에 "시연 체험 마일리지 포함" 표시). 운영 규칙·응답은 그대로. 자동 시험은 [TEST_STATUS](docs/TEST_STATUS.md), 배포·실기 확인은 `NOT_RUN` |

상태 정의는 `PLANNED / IN_PROGRESS / IMPLEMENTED / VERIFIED / BLOCKED / NOT_RUN`입니다. 구현 코드가 있어도 필요한 환경에서 검증하지 않았다면 `VERIFIED`로 올리지 않습니다.

## 보안·제품 경계

- 기존 블록체인을 사용하며 자체 체인·자체 사용자 지갑을 만들지 않습니다.
- 사용자 개인키·복구 문구를 요구하거나 보관하지 않습니다.
- 외부 지갑에는 주소 확인용 메시지 서명만 요청합니다.
- 송금·`approve`·`permit`·스왑·구매·내장 지갑 기능을 넣지 않습니다.
- 발행 요청의 수령 주소와 연결 버전을 고정하고 재시도로 중복 발행하지 않습니다.
- DEMO 계정 헤더는 loopback 이외 바인드에서 API 기동을 거부합니다. 운영 Caddy는 로그인 제한용 원 클라이언트 IP를 덮어써 전달하고 API는 명시 설정에서만 사용합니다. [운영 API·Caddy 배포와 HTTPS/401 확인](docs/evidence/lightsail-api-deployment-2026-09-23.json)은 `PASS`; 외부 두 IP 제한 실증은 `NOT_RUN`입니다.
- 체인 이벤트의 블록 해시와 현재 정식 블록 해시가 다르면 Worker는 최종 완료로 저장하지 않고 재시도합니다. 오프라인 로그아웃 시 로컬 정보는 지우되 서버 세션 회수 실패를 알립니다.
- 개인정보·주문번호·정확한 식사 시각을 온체인/IPFS에 넣지 않습니다.

## 아키텍처

```mermaid
flowchart LR
    subgraph operating["운영 데이터 경계"]
        prodApp["Android 운영 앱"] --> prodApi["api.masscom.kr"]
        prodWeb["www.masscom.kr/app · 본인 도감 열람"] --> prodApi
        prodApi --> prodDb[(PostgreSQL masscom)]
        prodDb --> outbox["Outbox · 발행 Worker"]
        outbox --> testnet["Base Sepolia · 시험망 검증"]
        prodApp <-->|주소 확인 메시지 서명| wallet["외부 지갑 앱"]
    end
    subgraph showcase["가상 시연 데이터 경계"]
        demoApp["Android .demo APK"] --> demoApi["demo-api.masscom.kr"]
        demoApi --> demoDb[(PostgreSQL masscom_showcase)]
    end
    demoWeb["www.masscom.kr/preview/ · 고정 예시 · 읽기 전용"]
```

시연 DB는 운영 DB와 계정·볼륨·Docker 네트워크를 공유하지 않습니다([공개 edge 실측](docs/evidence/showcase-public-edge-2026-09-27.json)). `apps/mobile`, `apps/api`, `apps/worker`, `apps/api/migrations`, `contracts`, `infra/lightsail`이 구현됐고 별도 점주 웹은 후속 범위입니다. 운영 앱의 시험망 NFT 검증과 시연 앱의 가상 수집품을 같은 완료 상태로 보지 않습니다.

### 기술 구현에서 중요한 경계

| 문제 | 구현에서 지키는 조건 | 코드·검증 |
| --- | --- | --- |
| 같은 날 반복 방문 | 방문 이벤트는 남겨도 한국 날짜의 보상 진행은 한 번만 증가 | [방문 트랜잭션](apps/api/src/postgres/claim-slot-service.ts) · [두 계정 폰 재입력 증거](docs/evidence/showcase-two-account-phone-2026-09-27.json) |
| Worker 동시 재시도 | 발행 작업과 Outbox를 함께 잠그고, 불확실한 거래는 기존 해시부터 대조 | [작업 lease](apps/worker/src/postgres-mint-repository.ts) · [Anvil 장애 복구](docs/evidence/phase3-worker-anvil-android.json) |
| 지갑 요청의 범위 | 주소 확인용 메시지 서명만 허용하고 송금·승인·구매 메서드는 차단 | [메서드 정책](apps/mobile/src/wallet/wallet-method-policy.ts) · [회귀 시험](apps/mobile/src/wallet/wallet-method-policy.test.ts) |

예를 들어 방문 진행을 기록하는 SQL은 이미 유효한 같은 점포·같은 한국 날짜의 진행이 있으면 두 번째 보상 진행 행을 만들지 않습니다.

```sql
ON CONFLICT (customer_account_id, merchant_id, business_date)
  WHERE status = 'VALID' AND progress_counted
DO NOTHING
```

이것은 [실제 구현의 일부](apps/api/src/postgres/claim-slot-service.ts)이며, 방문 2건과 앱 수집품 1개가 동시에 성립한 [시연 DB·폰 결과](docs/evidence/showcase-two-account-phone-2026-09-27.json)와 연결됩니다. 발행 Worker가 시연 APK에서 가동된다는 뜻은 아닙니다.

## 기술 선택 상태

| 영역 | 채택한 기술 | 이 프로젝트에서 맡는 일 | 실제 상태 |
| --- | --- | --- | --- |
| Android | React Native · Expo SDK 57 · TypeScript | 운영·시연 package를 분리하고 같은 코드의 사용자 흐름을 검증 | 시연 APK 폰 실기 `PASS`, Play 제출 `NOT_RUN` |
| 서버·DB | Node.js · TypeScript · PostgreSQL | 점주 권한, 일회용 코드, 방문·보상권을 서버/트랜잭션에서 판정 | 시연 HTTPS·두 계정 수령·중복 거절 `PASS` |
| 배포 | 기존 AWS Lightsail · Docker Compose · Caddy | 운영/시연 DB 격리와 각 HTTPS host의 TLS·라우팅 | [외부 서버 실측](docs/evidence/showcase-public-edge-2026-09-27.json) `PASS` |
| 외부 지갑 | Reown AppKit · SIWE 주소 확인 | 개인키를 보관하지 않고 지갑의 주소 통제를 검증 | 운영 개발 앱 실기 근거 있음, 시연 APK 연결 `NOT_RUN` |
| 블록체인 | Foundry · Base Sepolia | 기존 체인에서 NFT 계약·발행/복구를 시험 | 시험망 검증 `PASS`, Base 메인넷 배포 `NOT_RUN` |

D-004~D-008은 2026-09-18 승인됐습니다. 유료 자원 생성·메인넷·공개 배포는 이 승인에 포함되지 않습니다.

## 설치·검증

저장소 기준선 검사는 추가 패키지가 필요하지 않습니다.

```bash
git clone --recurse-submodules https://github.com/2026-KW-HACKATHON/27_MassCOM.git
cd 27_MassCOM
git submodule update --init --recursive  # 이미 clone한 저장소에서 실행
bash tests/bootstrap/check_secrets_test.sh
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
bash tests/bootstrap/check_pr_korean_test.sh  # checker 자체 회귀 시험
bash tests/bootstrap/verify_bootstrap_test.sh
bash tests/site/check_site_accessibility_test.sh
bash tests/site/verify_project_site_test.sh
```

Phase 1·2 앱과 API 검증:

```bash
npm ci --prefix apps/api
npm test --prefix apps/api
npm run typecheck --prefix apps/api
npm ci --prefix apps/mobile
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
npm run export:android --prefix apps/mobile
bash scripts/check-privacy.sh
bash tests/bootstrap/check_privacy_test.sh
```

Phase 3 계약·Worker 검증:

```bash
./scripts/forge.sh fmt --check
./scripts/forge.sh build
./scripts/forge.sh test -vvv
./scripts/forge.sh lint
npm ci --prefix apps/worker
npm test --prefix apps/worker
npm run typecheck --prefix apps/worker
TEST_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom_test' npm run test:postgres --prefix apps/worker
```

`npm run test:anvil --prefix apps/worker`는 별도 로컬 Anvil과 `_test` 데이터베이스가 필요합니다. Worker 실행 entrypoint는 `CHAIN_ID=31337`과 `ALLOW_UNLOCKED_LOCAL_MINTER=true`를 동시에 요구해 운영 키나 공개 체인에 사용할 수 없도록 제한했습니다. `CHAIN_REORG_MARGIN`은 cursor보다 다시 확인할 블록 수이며 현재 로컬 기본값은 12입니다. `MINTER_MIN_BALANCE_WEI`(기본 0) 이하로 민터 잔액이 내려가면 신규 전송을 미루고 재시도합니다.

Base Sepolia에는 계약 `0x1edca95bb453d8456cfe28c6e24c4e51172e36c4`를 암호화 Foundry keystore로 배포했고, cap 1 proof series에서 실제 Worker job/Outbox→service minter→receipt/event/owner/locked/metadata→DB FINALIZED를 PASS했습니다. mainnet 배포는 하지 않았습니다.

```bash
scripts/deploy-base-sepolia.sh <keystore-account>          # 시뮬레이션
scripts/deploy-base-sepolia.sh <keystore-account> --broadcast  # 실제 배포(NOT_RUN)
```

`BASE_SEPOLIA_ADMIN`·`BASE_SEPOLIA_MINTER`·`BASE_SEPOLIA_PAUSER` 환경 변수가 필수이며 `BASE_SEPOLIA_RPC_URL`은 선택(기본 `https://sepolia.base.org`)입니다. Android 운영 package `APP_VARIANT`와 release AAB 빌드는 [`apps/mobile/README.md`](apps/mobile/README.md)를 따릅니다.

Phase 2 점포 카탈로그, 점포별 권한, QR 수령 슬롯, 방문·보상권 검증은 실제 PostgreSQL 연결이 필요합니다.

```bash
export DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom_dev'
read -s MERCHANT_REFERENCE_HMAC_SECRET && export MERCHANT_REFERENCE_HMAC_SECRET
read -s PGPASSWORD && export PGPASSWORD
npm run db:migrate --prefix apps/api
export TEST_DATABASE_URL='postgresql://사용자@127.0.0.1:5432/masscom_test'
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate --prefix apps/api
npm run test:postgres --prefix apps/api
```

통합 테스트는 테이블을 비우므로 DB 이름이 `_test`로 끝나는 전용 데이터베이스만 허용합니다. `GET /merchants`는 로그인·지갑 없이 활성 점포와 공개 중인 현재 캠페인만 반환합니다. 점주용 API는 활성 점포 멤버십을 매 요청 확인합니다. QR token은 SHA-256, 주문 참조는 점포 범위 HMAC-SHA-256만 저장합니다. 재발급은 직전 `tokenVersion`을 조건으로 한 요청만 성공시킵니다. 수령 POST는 슬롯 소비·방문 이벤트·한국 날짜 진행도·첫/3/5회 보상권을 한 트랜잭션으로 처리합니다. 저장소에는 실제 협약 점포 seed를 넣지 않으며 테스트 fixture는 `demo: true`로 구분합니다.

상세 development build 절차와 환경 변수는 [`apps/mobile/README.md`](apps/mobile/README.md), [`apps/api/README.md`](apps/api/README.md), [`apps/worker/README.md`](apps/worker/README.md)를 따릅니다.

## 데모·배포·출시

- 정적 프로젝트 포털: [https://www.masscom.kr](https://www.masscom.kr)·`/privacy`·`/account-deletion` 공인 TLS와 HTTPS 200 `VERIFIED`; 기존 apex 호환 경로도 유지
- 읽기 전용 시연 웹: [https://www.masscom.kr/preview/](https://www.masscom.kr/preview/)의 가상 A·B·C HTML/CSS가 저장소 원본과 바이트 일치([전환 증거](docs/evidence/www-web-cutover-2026-09-25.json)). 로컬 라이트/다크·대비·반응형 검사도 PASS([기존 증거](docs/evidence/design-consistency-2026-09-24/README.md)). Android 시연 앱과 진행 동기화되지 않으며 고정 예시는 실제 협약 점포·방문·NFT 실적이 아닙니다.
- 읽기 전용 운영 웹: [https://www.masscom.kr/app/](https://www.masscom.kr/app/)이 기존 Lightsail의 운영 데이터(현재 공개 점포 0곳)를 표시합니다. OAuth 비밀값은 Git 밖 권한 600 런타임에 있습니다. Samsung Android Chrome에서 www의 한 기존 Google 계정 로그인·빈 도감·URL 재열기·로그아웃과 www 로그아웃 뒤 apex 로그인 유지가 PASS입니다. 기존 apex의 두 계정 순차 로그인은 [이전 증거](docs/evidence/android-web-auth-2026-09-25.json)이고, www의 두 번째 계정과 기록이 있는 도감의 교차 노출은 `NOT_RUN`입니다.
- 운영 Android UI: Issue #142·#146의 화면 수정과 [Samsung Android 16 개발 앱 UI](docs/evidence/android-dev-ui-2026-09-24/README.md)는 이전 실기입니다. 최신 [운영 test.7 APK](docs/evidence/operating-android-test7-2026-10-03.json)의 서명·공개 다운로드는 확인했고 Samsung 설치·로그인은 `NOT_RUN`입니다. [test.6의 Samsung 설치·세션 복원·화면 확인](docs/evidence/operating-android-test6-2026-10-02.json)과 [test.5의 새 버전 동의 화면](docs/evidence/operating-android-test5-2026-10-01.json)은 이전 설치본 증거입니다.
- 로컬 API 시연 데이터: [전용 DB 실행 방법](apps/api/README.md#격리된-로컬-시연-점포)에 따라 `masscom_showcase_test`에 가상 점포 A·B·C와 각 점포의 1/3/5회 목표를 생성. 실제 영업점·방문·NFT가 아니며 운영 API/DB에는 미적용. 정적 시연 웹과도 아직 실시간 연결되지 않습니다.
- 로컬 시연 API·DB: [독립 Docker 환경](infra/showcase-local/README.md)은 운영 Compose와 다른 프로젝트·볼륨·loopback 포트로만 실행합니다. 이는 [현재 외부 시연 API](docs/evidence/showcase-public-edge-2026-09-27.json)와 별도이며, 외부 API·폰 로그인의 최신 판정은 위 실증을 따릅니다. 고객 QR 수령·지갑·NFT는 이 로컬 환경과 외부 시연 앱 모두에서 별도 미검증입니다.
- 운영 API: AWS Lightsail 서울 리전의 기존 [배포 이력](docs/evidence/lightsail-api-deployment-2026-09-23.json)에 이어 코드 PR #169의 merge `3c59ac0`을 배포했고 `https://api.masscom.kr/health` 200, 웹 호스트 경계 DB migration 0016·0017 및 기존 PostgreSQL 컨테이너 보존을 확인했습니다([전환 증거](docs/evidence/www-web-cutover-2026-09-25.json)). DB·API 내부 포트는 비공개이며 www 단일 계정 로그인은 PASS, 기록이 있는 두 계정 도감 격리는 별도 `NOT_RUN`입니다.
- Google 로그인: Samsung SM-S928N Android 16에서 실제 동의→ID token→외부 API session·콜드 스타트 복원·logout revoke `PASS`; 두 번째 계정 전환은 `NOT_RUN`
- Android debug APK: Android 16 16KB AVD와 Samsung SM-S928N 실기기에서 빌드·설치·실행·홈 복귀·콜드 스타트 검증, 저장소에는 미포함
- Android 음식점 탐색: 로컬 PostgreSQL의 `demo: true` 점포 3곳으로 목록·상세·고정 보상 조건·선택적 지갑 이동 검증
- Android 방문 수령: loopback DEMO에서 점주 권한→1회 코드→고객 수령→도감 검증; 점주 화면의 QR을 고객 화면에서 촬영해 같은 수령 API로 연결(권한 거부 시 수동 입력, 수령용이 아닌 QR·연속 인식은 앱에서 걸러냄). 실제 촬영→수령 실기는 `NOT_RUN`
- Android 다음 가게: 미방문·다음 고정 보상 이유를 표시하고 기존 상세 탐색으로 복귀하는 순환 검증
- NFT 계약: 고정 Docker Foundry로 C01~C04와 로컬 Anvil 발행 검증; 테스트넷·메인넷으로 표현하지 않음
- NFT 발행 요청: 클라이언트 주소·series 입력을 무시하고 검증된 binding/version에서 수령인을 고정해 보상권·job·Outbox 원자 저장
- NFT 발행 Worker: Local Anvil에서 중복 Worker·응답 유실·설정 오류·이벤트 불일치·확정 전 재조직·DB 복구와 RPC 중단·발행 중지·민터 잔액 부족·DB 장애 뒤 자동 복구(O02, Issue #77)를 검증하고 Android가 접수/확인 중/등록 완료를 구분
- 공개 GitHub 설치본: [운영 test.7](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/android-v0.1.0-test.7)과 [시연 Preview 16](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.16)은 로그인 없이 각각 내려받습니다. APK SHA-256·서명·내장 API 주소 검사는 [운영](docs/evidence/operating-android-test7-2026-10-03.json)·[시연](docs/evidence/showcase-preview16-release-2026-10-03.json) 증거를 따릅니다. 실기기는 두 최신 설치본 모두 `NOT_RUN`이고 시연 에뮬레이터의 역할 선택 화면만 확인했습니다.
- 운영 package ID `kr.masscom.wolgye`(개발 `kr.masscom.wolgye.dev`), scheme `masscom`/`masscom-dev`: `IMPLEMENTED`; 시연 `kr.masscom.wolgye.demo`/`masscom-demo`는 별도 API·키로 서명. 최신 test.8·Preview 17은 Samsung 실기기 `NOT_RUN`; Preview 17 에뮬레이터에서 로그아웃 상태 가상 점포 3곳과 점포 B 수집품 미리보기 PASS. 이전 Preview 16은 에뮬레이터 역할 선택 화면 PASS. 이전 운영 test.3의 4KB Samsung 로그인·16KB AVD 설치/콜드 실행, test.4~6 Samsung 설치는 각 이전 APK의 기록이며 시연 가상 데이터는 운영에 없음
- 백업·복원 drill: `scripts/db-restore-drill.sh`로 dump→scratch DB 복원→행 수·migration 대조를 로컬 PostgreSQL 18에서 PASS. 운영 DB·외부 백업 저장소는 `NOT_RUN`
- 실기 시험 절차는 [`docs/DEVICE_TEST_PLAN.md`](docs/DEVICE_TEST_PLAN.md), 외부 HTTPS·로그인 실제 결정은 [`docs/HOSTING_LOGIN_PROPOSAL.md`](docs/HOSTING_LOGIN_PROPOSAL.md)를 따릅니다.
- 운영 AAB 지갑 진입점 검사(W08): upload key 서명본을 공식 bundletool로 읽어 package와 source marker를 확인하고 결제 권한·결제/온램프/내장 지갑 SDK·AppKit 기능 flag·계정 화면 도달 경로·세션 메서드를 정적 검사해 PASS. 실기기 UI는 별도 `NOT_RUN`
- upload keystore·공개 인증서 핀·[test.7 AAB/APK](docs/evidence/operating-android-test7-2026-10-03.json)의 서명 인증서 일치: `VERIFIED`. [이전 test.3 AAB/APK의 Samsung 로그인·16KB AVD 설치](docs/evidence/operating-android-test3-2026-09-28.json)는 이전 설치본의 증거입니다. 자동 App Link 열기는 폰 설정으로 `BLOCKED`, Play Console 제출은 `NOT_RUN`
- 운영 AAB 서명 비밀번호를 키체인에 두기([Issue #262](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/262)): `~/.gradle/gradle.properties`의 평문 비밀번호 대신 소유자가 한 번만 `security add-generic-password -U -s masscom-upload-keystore -a masscom-upload -w`를 실행해(비밀번호는 화면에 보이지 않게 두 번 묻는다) 넣고 `MASSCOM_RELEASE_USE_KEYCHAIN=1 bash scripts/build-release-aab.sh`로 빌드한다. 키 저장소는 `~/.android/masscom-upload.jks`, 별칭은 `masscom-upload`가 기본이다(`MASSCOM_RELEASE_KEYSTORE_FILE`·`MASSCOM_RELEASE_KEY_ALIAS`로 바꾼다). 빌드 전에 인증서 SHA-256이 승인된 업로드 인증서 `5e5ed3c3…fa395`와 같은지 확인하고 다르면 Gradle 전에 멈춘다. 비밀번호는 `gradlew` 자식 프로세스의 환경에만 전달하며 출력·파일·명령줄 인자에 남기지 않고 `set -x`(셸 추적)에서는 거절한다. `MASSCOM_RELEASE_USE_KEYCHAIN`이 없으면 기존 gradle.properties 방식 그대로다. 자동 시험은 가짜 `security`·`keytool`로 하며 실제 키체인·키 저장소·AAB는 쓰지 않는다(`bash tests/release/verify_release_keychain_test.sh`). 2026-09-30에 소유자 키체인·실제 업로드 키로 운영 AAB 검증 빌드를 해 인증서 일치·서명 검증을 확인했다(TEST_STATUS).
- 시연·운영 빌드가 다른 쪽 API 주소를 담지 않게 막기([Issue #273](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/273)): 시연 APK의 JS 번들에 운영 `EXPO_PUBLIC_API_URL`이 들어간 일이 있었다. 원인은 추정이다: 시연 스크립트의 Gradle 단계가 `CI=1`이면 Expo가 Metro 캐시 재생성을 건너뛰는 것으로 보이며, 공용 캐시에 남은 다른 빌드의 값이 인라인된 것으로 짐작한다. 그래서 시연 Gradle 단계도 운영처럼 `CI=0`으로 바꿨지만 이것이 원인 제거인지는 확인하지 못했다. 실제 방어는 빌드 뒤 `scripts/check-embedded-api.sh`다: APK·AAB의 JS 번들(`assets/index.android.bundle`)을 읽어 시연은 `https://demo-api.masscom.kr`만, 운영은 `https://api.masscom.kr`만 들어 있을 때만 통과시킨다(어긋나면 빌드 실패·`rm -rf "${TMPDIR:-/tmp}/metro-cache"` 뒤 재빌드 안내, 시연 provenance의 `checks.embeddedApi`). 앱 소스에 API origin을 리터럴로 두면 모든 variant 번들에 들어가 이 검사에 걸리므로([Issue #325](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/325): 체험 로그인 가드의 시연 주소가 운영 AAB를 막았다), 시연 전용 값은 `app.config.ts`의 시연 `extra`로만 넣고 `apps/mobile/src/config/embedded-api-origin.test.ts`가 소스 리터럴을 CI에서 먼저 잡는다. 자동 시험은 가짜 APK·AAB로 하며(`bash tests/release/check_embedded_api_test.sh`) 실제 빌드 재확인은 `NOT_RUN`
- 계정 삭제: 앱 내부 Local DEMO와 PostgreSQL 미전송 취소·제출 거래 보존·비식별화 PASS; 외부 HTTPS 삭제 URL PASS(옛 접수 전용 버전), 웹 접수→운영자 처리(D-052)는 로컬 PostgreSQL 시험 PASS·main `02cb7e7` 운영·시연 배포(외부 HTTPS의 조회 404·세션 없는 접수 401)이고 폐기용 실계정 종단 실행은 `NOT_RUN`, 직접 fresh reauthentication 삭제는 `NOT_RUN`
- 실제 Reown 지갑 흐름: 개발 package MetaMask 연결·서명·자동 복귀·콜드 스타트 서버 binding 복원과 W06 `PASS`; Account 1 검증이 Account 2 재연결에 승계되지 않음 `PASS`; 운영 release package, 정확한 W04 동일 세션 변경과 W05 스마트지갑은 `NOT_RUN/BLOCKED`
- 테스트넷 계약·Worker 발행 1건: `VERIFIED` Base Sepolia, [구조화 증거](docs/evidence/base-sepolia-deployment.json)
- 메인넷·Google Play·대회 제출: 명시 승인 전 실행 금지
- 저장소: 대회 조직 저장소 `PUBLIC`·활성, 개인 저장소 `PRIVATE`. [통합 이력](docs/PUBLIC_SYNC.md)을 보존하며 심사 공개·최종 제출 방식은 [대회 규칙](docs/COMPETITION.md)과 실제 제출 공지를 재확인

개인 Google Play 계정 적격성, 사업자·법률·개인정보·금융 기능 신고는 실제 기능과 Console 기준으로 다시 확인합니다.

## 대회·기여·출처

- 대회 규칙과 일정: [docs/COMPETITION.md](docs/COMPETITION.md)
- 자료명·버전·SHA-256: [docs/SOURCE_INDEX.md](docs/SOURCE_INDEX.md)
- AI 사용과 사람 검토 구분: [docs/AI_USAGE.md](docs/AI_USAGE.md)
- 외부 코드·자산·라이선스: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- 인수인계: [docs/HANDOFF.md](docs/HANDOFF.md)

없는 협약 점포·현장 검증·Play 승인·매출 증가·사람의 기여를 만들지 않습니다. 목표 인원과 점포 수는 확보 실적과 분리합니다.

## Git·리뷰 운영

`Issue → 작업 브랜치 → 테스트 → 한글 PR → CI → merge → main CI` 순서를 사용합니다. main은 통합 기준선으로 유지하고, merge된 원격 브랜치와 worktree는 상태를 확인한 뒤 정리합니다. 커밋은 왜 변경했는지와 `Tested / Not-tested` 경계를 Lore trailer로 남깁니다. 보안·계정·민팅 변경은 독립 code-reviewer와 architect가 모두 증거를 반환하기 전 merge-ready로 표시하지 않습니다.

## 사진 수집품 제작기

[Issue #252](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/252)의 새 제작기는 점주 웹 `/merchant/`에서 사진 한 장으로 시작합니다. 원형·우표·톱니, 자르기·보정·스티커, 자유로운 등급과 홀로그램 등 재질, 동작·두께·인사말·음성·가게 이야기를 편집하고 초안을 저장할 수 있습니다. 게시할 때 기존 캠페인 목표에 외형을 직접 연결하며, 이후 받은 수집품에는 획득 당시 게시 버전을 보관합니다. 고객 웹·Android 도감에서 다시 열 수 있습니다.

사진·음성은 외부 AI에 보내지 않습니다. 제작은 서버가 확인한 점포 권한, 보유품 상세는 보유자 권한으로 제한합니다. 운영 반영에는 사진 migration `0034`·`0035`와 웹·API 배포, `expo-audio`가 포함된 Android 새 빌드가 필요합니다. 점주는 게시한 수집품을 게시 중지하거나 삭제할 수 있고, 점주 계정을 삭제하면 그 계정이 만든 게시 수집품도 새 고객에게 더 나가지 않습니다. 사진 속 인물·목소리의 삭제 요구는 운영자 제거 절차([API 안내](apps/api/README.md#운영자-게시-미디어-제거-절차))로 이미 받은 고객의 도감에서도 지웁니다. 저장할 때 사진 EXIF와 MP3 태그를 서버가 지웁니다. 처리방침에 사진·목소리 처리 안내가 더해져 처리방침 버전을 `privacy-2026-10-01`로 올렸으므로 배포 뒤 모든 계정이 첫 로그인 동의를 다시 봅니다(약관 `terms-2026-09-30`은 그대로, [D-061](docs/DECISIONS.md)). 현재 PR의 로컬 구현·검증과 운영 배포·실기기 확인을 구분하며, [세부 명세와 제한](docs/COLLECTIBLE_CREATOR.md)·[시험 상태](docs/TEST_STATUS.md)를 참고하세요.
