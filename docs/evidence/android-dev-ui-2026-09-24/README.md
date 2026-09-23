# Android 개발 앱 실기 · Issue #146

기준 코드: `f177c0af79d3df871aa74091eebfbb4d2a8e7e8d`의 JavaScript를 `kr.masscom.wolgye.dev` 개발 앱에서 실행했습니다. 기기는 Samsung SM-S928N / Android 16입니다. 기존 운영 앱 `kr.masscom.wolgye`의 `0.1.0-test.2` 출시본을 검증한 결과가 아닙니다.

환경: 원 저장소의 `.env.local`을 복사하지 않은 격리 checkout, USB `adb reverse` 8081(Metro)·3000(API), 127.0.0.1에만 바인드한 개발 DEMO API와 `masscom_showcase_test` PostgreSQL. `가상 점포 A`·`showcase-local-customer`·로컬 STAFF는 시험 데이터이며 실제 점포·방문·혜택이 아닙니다. 사용한 일회용 코드는 이 문서나 Git에 기록하지 않았습니다.

| 확인 항목 | 결과 | 근거·한계 |
| --- | --- | --- |
| 수정 전 ‘내 정보’ | FAIL | `main` 기준 Expo Router `<Slot>` 스타일 배열 오류를 동일 폰에서 재현 (`before-settings-error.png`) |
| 수정 후 ‘내 정보’·역할 시안 링크 | PASS | `f177c0a`에서 렌더 오류 없이 진입·뒤로 가기 (`after-settings.png`, `role-preview.png`) |
| 네 탭과 가상 점포 상세·추천 | PASS | 탐색·방문 인증·빈 도감·내 정보, 가상 점포 1곳의 상세와 다음 가게 추천 화면 진입 (`discovery.png`, `claim.png`, `collection.png`, `detail.png`, `recommendations.png`) |
| 로컬 STAFF 화면·코드 발급 | PASS | 서버 권한 표시 뒤 가상 고객용 1회 코드와 QR을 1건 발급 (`merchant.png`). 원문 토큰·QR 이미지는 저장소에 넣지 않음 |
| 고객 코드 미리보기 | PASS | 같은 폰의 고객 화면에서 수동 입력 후 상태 ‘수령 가능’, 가상 점포/캠페인 일치 확인. 토큰 원문은 저장소에 넣지 않음 |
| 고객 수령 확정·보상권 | BLOCKED | 확정 탭 직전 USB ADB 연결 해제. 전용 DB에서 `visit_events=0`, `reward_entitlements=0`, `claim_slots=1` 확인; 수령 PASS 주장 금지 |
| 실제 QR 카메라 촬영·외부 지갑·NFT | NOT_RUN | 같은 폰 화면의 QR을 동일 기기 카메라로 촬영하지 않았고 지갑·체인 요청도 하지 않음 |
| 다크 모드·TalkBack·운영/시연 릴리스 APK | NOT_RUN | 이번 실기는 개발 빌드의 라이트 모드·로컬 API에 한정 |

자동 회귀: `npx tsx --test src/navigation/primary-tabs.test.ts`는 수정 전 3/4(새 검사 FAIL) → 수정 후 4/4 PASS. 전체 `npm test --prefix apps/mobile` 182/182, typecheck·lint PASS. 실제 화면은 USB 재연결 때마다 임의로 성공 처리하지 않았습니다.
