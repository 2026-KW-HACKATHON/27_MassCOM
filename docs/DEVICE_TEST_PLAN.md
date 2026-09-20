# Android 실기 회귀 시험 계획

이 문서는 실행 절차입니다. 결과는 `docs/TEST_STATUS.md`와 `docs/evidence/*.json`에만 기록하며, 실행하지 않은 항목은 `NOT_RUN` 또는 `BLOCKED`로 남깁니다. 시험용 fixture 결과와 실제 기기·외부 지갑 결과는 서로 다른 행으로 적습니다.

2026-09-20 기준 상태: 개발 장비에 `adb`는 있으나 연결된 기기가 없습니다(`adb devices` 빈 목록). 아래 시험은 모두 기기 연결 뒤에 실행합니다.

## 공통 준비

| 항목 | 값 |
| --- | --- |
| 기기 | 이전 증거와 같은 Samsung SM-S928N·Android 16 권장. 다른 기기면 모델·OS를 증거에 기록 |
| 지갑 | MetaMask Android(이전 증거 8.11.0). 버전을 증거에 기록. 자산이 없는 시험 전용 계정만 사용 |
| 체인 | Base Sepolia `eip155:84532` |
| 서버 | 개발 장비의 API + Docker PostgreSQL `_test`/DEMO DB. `adb reverse tcp:<port> tcp:<port>`로 loopback 연결 |
| 로그 | `adb logcat -c` 후 `adb logcat --pid=$(adb shell pidof <package>) > scratch/<시험ID>.log`. 로그·스크린샷에 token 원문·개인정보가 있으면 증거로 커밋하지 않음 |

소유자가 할 조작: USB 연결, 기기에서 “USB 디버깅 허용”, 지갑 앱의 연결·서명·계정 선택 화면 확인. 나머지(빌드·설치·로그 수집·API 조회·증거 작성)는 에이전트가 수행합니다.

계정 삭제·초기화는 시험 전용 계정(`demo-*`)과 DEMO DB에서만 합니다. 지갑 앱의 데이터나 실사용 계정은 지우지 않습니다.

## E01 Expo patch 회귀

- 대상 빌드: 개발 variant debug APK(`kr.masscom.wolgye.dev`), 현재 `main`
- 사전 조건: `docs/REOWN_PATCH.md`의 patch가 적용된 `npm ci` 상태
- 순서: 설치 → 콜드 스타트 → 점포 목록 → 점포 상세 → 도감 → 추천 → 계정 설정 → 지갑 연결 화면 진입 → 홈 버튼 → 복귀
- 기대: 모든 화면이 crash 없이 열리고 logcat에 `FATAL EXCEPTION`·JS redbox 없음. 하단 콘텐츠가 제스처 바에 가리지 않음(PR #83)
- 기록: `docs/evidence/android-regression-<날짜>.json`

## E02 새 package·scheme에서 지갑 복귀 (A02의 일부)

- 대상 빌드: 운영 variant release 빌드(`kr.masscom.wolgye`, scheme `masscom`). upload key가 없으면 debug 서명본으로 실행하고 증거에 “debug 서명”을 적음. 개발 variant(`masscom-dev`)가 함께 설치된 상태에서도 실행
- 순서: 지갑 연결 → MetaMask에서 승인 → 앱으로 자동 복귀 확인 → 주소 확인 서명 → 복귀 확인
- 기대: 복귀 대상이 운영 앱이며 개발 앱이 대신 열리지 않음. `CONNECTED / VERIFIED` 표시
- 실패 시 수집: `adb shell dumpsys package kr.masscom.wolgye | grep -A5 -i scheme`, logcat의 intent 줄

## E03 계정 삭제 뒤 세션 복원 방지

- 사전 조건: 시험 계정으로 지갑 `VERIFIED` 상태
- 순서: 계정 설정 → 삭제 요청(DEMO 재인증) → 앱 강제 종료 → 재실행 → 지갑 화면
- 기대: 지갑 세션이 복원되지 않고 미연결 상태. API 응답이 HTTP 410 `ACCOUNT_DELETED`. AsyncStorage에 `@masscom:appkit:` 키가 남지 않음(`adb shell run-as <package> ...`는 debug 빌드에서만 가능)

## D02 계정 전환과 캐시·상태 분리

운영 로그인이 아직 없어 계정은 빌드 시점의 `EXPO_PUBLIC_DEMO_ACCOUNT_ID`로 정해집니다. 따라서 “로그아웃→로그인”은 **같은 package의 앱 데이터를 유지한 채 계정 ID만 다른 빌드로 덮어 설치**하는 것으로 대체합니다. 이 대체 절차로 통과해도 운영 로그인 구현 뒤 실제 전환 시험을 다시 해야 합니다.

1. 계정 A 빌드 설치 → 지갑 연결·확인, 방문 수령 1건, 도감·발행 상태 확인 → 스크린샷
2. 앱을 지우지 않고 계정 B 빌드를 `adb install -r`로 덮어 설치 → 실행
3. 기대: 도감·추천·발행 작업·지갑 주소에 A의 데이터가 하나도 없음. 지갑은 미연결. 시작 시 A의 지갑 세션 키가 제거됨
4. 앱 강제 종료 → 재실행 → 3을 다시 확인
5. 다시 계정 A 빌드로 덮어 설치 → A의 서버 데이터는 보이되 지갑 세션은 복원되지 않음(2에서 제거됨)

## W04 세션 중 지갑 주소 변경

- 현재 기준: 서명 요청 뒤 지갑 주소가 바뀌면 이전 challenge·서명·확인 상태가 재사용되지 않아야 함. 자동 시험(`currentAddress` 불일치 → `WALLET_CHANGED`)과 “Account 1 VERIFIED → Account 2 재연결 시 UNVERIFIED” 실기는 PASS
- 남은 것: **같은 WalletConnect 세션 안에서** 서명 대기 중 계정을 바꾸는 실기. MetaMask 8.11.0은 세션 계정 편집 경로가 없어 `BLOCKED`(B-010)
- 실행 조건: 세션 안에서 계정 전환(`accountsChanged`)을 내는 지갑이 준비될 때. 후보 지갑은 소유자가 자산 없는 계정으로 준비
- 주소를 바꾸는 시점: (a) challenge 발급 직후·서명 요청 전, (b) 지갑의 서명 화면이 떠 있는 동안, (c) 서명 승인 직후·앱 복귀 전
- 기대: 세 시점 모두 앱이 `VERIFIED`로 가지 않고 다시 확인을 요구. 서버에 새 binding이 생기지 않음(`GET /wallets/active-binding`으로 확인)

## W05 미지원 스마트 지갑

- 기준: 지원이 아니라 **안전한 거절과 설명**. 제품에 스마트 지갑 지원을 추가하지 않음
- fixture(실기 아님): 서버가 ERC-1271·ERC-6492 형태 서명을 `SIGNER_MISMATCH`로 거절, binding 미생성(Issue #90)
- 실기: 자산·복구 문구가 없는 시험 전용 스마트 지갑이 제공될 때만 실행(B-011). 순서: 연결 → 주소 확인 서명 시도 → 기대: 앱이 미지원 안내를 표시하고 `VERIFIED`가 되지 않음, 발행 요청 불가

## A02 release AAB 설치

- 사전 조건: upload key 서명 AAB(소유자), `bundletool`(다운로드 승인 필요) 또는 Play 내부 테스트 트랙
- 순서: AAB → 기기용 APK 세트 설치 → E01·E02 반복 → 16KB page size 기기 또는 에뮬레이터에서 실행
- 빌드 성공·서명 확인·설치 확인·Play 업로드·심사 승인은 각각 따로 기록
