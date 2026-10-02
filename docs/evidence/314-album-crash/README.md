# 도감 탭 흰 화면 크래시 수정 · 에뮬레이터 실기 (Issue #314)

Android 에뮬레이터 `MassCOM_Design_QA`(API 36)의 `kr.masscom.wolgye.dev` 개발 앱과 `scripts/qa-local.sh`가 띄운 로컬 전용 PostgreSQL·API(`127.0.0.1:3000`)에서 수행했습니다. 기준 main `439ba83`, 브랜치 `fix/314-album-crash`. 로컬 QA 전용 가상 점포 방문(`테스트 방문 만들기`)으로 만든 가상 수집품만 사용했고, 실제 영업점·운영 계정·실제 NFT 발행에는 연결하지 않았습니다. 계정 식별자·QR·친구 코드가 보이는 화면은 찍지 않았습니다.

| 캡처 | 글꼴·테마 | 확인 내용 |
| --- | --- | --- |
| `album-open-font2.0-dark-final.png` | 2.0 · 어두운 테마 | 도감 탭 직접 탭 진입, 레드박스 없음(수정 전 재현했던 두 레드박스 모두 사라짐) |
| `album-detail-open-font2.0-dark.png` | 2.0 · 어두운 테마 | 그림 있는 수집품 카드를 눌러 상세(기울임·두께 보기) 연 상태, 레드박스 없음 |
| `album-nft-row-closed-font2.0-dark.png` | 2.0 · 어두운 테마 | 상세를 닫고 돌아온 도감, "외부 지갑 주소 확인" 버튼(원인이던 그 Link)이 정상 렌더 |
| `album-open-font1.0-light.png` | 1.0 · 밝은 테마 | "도감에서 보기"로 진입(방문 수령 직후 경로), 레드박스 없음 |
| `album-nft-row-font1.0-light.png` | 1.0 · 밝은 테마 | 같은 화면에서 "외부 지갑 주소 확인" 버튼까지 스크롤, 정상 렌더 |
| `collection-error-state-font2.0-dark.png` | 2.0 · 어두운 테마 | API를 내려 만든 최초 조회 실패 상태, "다시 불러오기" 버튼이 첫 화면부터 탭 막대 위로 보임(스크롤 불필요) |
| `collection-error-state-font1.0-light.png` | 1.0 · 밝은 테마 | 같은 오류 상태, 같은 결과 |

사전 상태(수정 전): 같은 조건에서 `adb logcat`·Metro 로그로 레드박스 2개를 확인했다 — `[expo-router]: You are passing an array of styles to a child of <Slot>`(진짜 원인), 그 뒤 `Attempted to navigate before mounting the Root Layout component`(연쇄 오류로 흰 화면 고착). 이 세션에서는 흰 화면 상태 자체는 따로 캡처하지 않고(재현이 곧 레드박스로 이어져 일반 사용자가 보는 흰 화면과는 다른 개발 모드 화면이었음), `adb logcat`/Metro 로그 텍스트로 원인을 확인한 뒤 고치고 바로 수정 후 상태를 캡처했다. 자세한 경위는 [HANDOFF](../../HANDOFF.md#2026-10-02-issue-314-도감-탭-흰-화면-크래시-android-release-blocker).

**NOT_RUN:** 실제 기기(에뮬레이터 아닌) 확인, 방문 인증 탭의 "테스트 방문 만들기"·가상 점포 B·C가 탭 버튼에 가려진다는 제보 재현(이번 QA의 글꼴 1.0·2.0 정지 상태에서는 재현하지 못함).
