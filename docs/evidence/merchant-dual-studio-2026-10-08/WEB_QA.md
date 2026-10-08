# 점주 웹 두 갈래 제작 검증 — Issue #417

기준 main: `e06c97cdad8d03b4e69b4008a91d39bedbbd874d`, 2026-10-08 KST. 첨부 기획 문서·이미지는 참고 자료로 읽었으며 문서 안 제안을 사용자 승인이나 실제 검증 결과로 취급하지 않았다.

## 실제 브라우저 결과

Codex in-app Chromium, 루프백 `http://127.0.0.1:4188/merchant/`, `COLLECTIBLE_QA_AI=1 node tests/fixtures/collectible-qa-server.mjs`로 실행했다. 이 서버의 계정·AI·캠페인은 **합성 UI fixture**다. 실제 Google 인증·AI 모델 호출·DB 저장의 증거가 아니다.

- PASS: 두 진입 카드 표시. 데스크톱 작업 영역에서 기존 페이지 44rem 자식 폭 제한을 해제했다.
- PASS: AI 시작 → 합성 초안 표시 → 그림 선택 → 사진 배치 1/4 → 작업 메뉴의 초안 저장 성공. 대표 그림 적용·자동 게시를 하지 않는다.
- PASS: 준비 이미지 시작 버튼에서 실제 파일 선택창이 열림 → 최신 첨부 참고 이미지 PNG 선택 → 사진 배치 → 등급 미리보기 2/4 → 초안 저장 성공.
- PASS: 제작기는 점포 운영 페이지 안에서 아래로 길게 펼쳐지지 않고 전체 높이 dialog로 열린다. 준비 이미지 선택 후 현재 단계 패널만 표시되고, 다음·이전 버튼으로 1→2→3→4와 되돌아가기를 수행한다. 4단계 DOM 검증값은 `data-step=4`, 보이는 패널 `["4"]`, 하단 버튼 `previous-step/replay/publish`다.
- PASS: 단계별 내용은 내부에서 스크롤하고 하단 다음·이전 버튼은 유지된다. 다음 단계와 시작 화면에 돌아올 때 스크롤 위치를 초기화한다. AI 화면의 시작 방식 복귀는 진행 중 polling을 취소한다. 녹음·파일 처리 중에는 외부 닫기와 Esc에 저장하지 않은 내용 확인이 적용된다(자동 회귀 시험). 휴대폰 native dialog에서는 운영 화면 복귀 버튼을 inert로 잠그지 않는다. 390px 웹 화면에서 새 초안의 운영 화면 복귀를 확인했다. 변경 후 확인창 수락·취소는 in-app browser CDP가 응답하지 않아 UI 종단 검증을 완료하지 못했고 자동 회귀 시험으로 확인했다.
- PASS: 390×844 뷰포트에서 모바일 작업 화면 표시, 문서 `scrollWidth=clientWidth=377`, 가로 넘침 없음. 실제 휴대전화·카메라·물리 기울임은 NOT_RUN.
- 실제 계정 로그인은 운영 점주 웹에서 성공했다. 승인된 점포가 없다는 안내가 표시되어 해당 계정의 제작·저장·게시 종단 검증은 BLOCKED다. 계정 권한을 임의 부여하지 않았다.
- 공개 점주 웹·운영 API health·시연 API health·GitHub는 재확인 시 HTTP 200. 공개 `/api/web/v1/*` 프록시 404는 기존 PR #413 배포 전까지 남는다. 이 PR의 운영 배포·APK 갱신·실제 유료 AI 생성은 NOT_RUN.

## 화면 증거

| 파일 | 확인 내용 |
| --- | --- |
| [01-desktop-entry.jpg](01-desktop-entry.jpg) | 데스크톱 두 진입 카드 |
| [02-ai-synthetic-drafts.jpg](02-ai-synthetic-drafts.jpg) | 실제 AI 생성이 아닌 합성 초안임을 명시한 선택 카드 |
| [03-ai-studio-saved.jpg](03-ai-studio-saved.jpg) | AI 초안 진입·저장 후 사진 배치 |
| [04-prepared-image-desktop.jpg](04-prepared-image-desktop.jpg) | 준비 이미지의 데스크톱 등급 미리보기 |
| [05-prepared-image-mobile.jpg](05-prepared-image-mobile.jpg) | 휴대폰 웹 등급 미리보기 |
| [06-mobile-entry.jpg](06-mobile-entry.jpg) | 두 진입 카드를 휴대폰에서 전체 폭으로 표시 |
| [07-customer-app-virtual-store.jpg](07-customer-app-virtual-store.jpg) | 실제 로컬 PostgreSQL 가상 가게를 고객 앱 목록에서 확인 |
| [08-customer-app-store-detail.jpg](08-customer-app-store-detail.jpg) | 실제 API의 주소·캠페인·1/3/5 목표를 고객 앱 상세에서 확인 |
| [10-wizard-step-1-photo.jpg](10-wizard-step-1-photo.jpg) | 준비 이미지 업로드 뒤 1/4 사진 배치만 표시 |
| [12-wizard-step-4-publish.jpg](12-wizard-step-4-publish.jpg) | 4/4 게시 단계에서 이전·전체 미리보기·게시 버튼 표시 |

실제 PostgreSQL 가상 점포 등록·앱 API 노출은 같은 폴더의 영속 QA 기록에서 별도로 확인한다.

## 실제 고객 앱과 영속 DB 결과

최신 `apps/mobile` development Expo 웹 export를 `http://127.0.0.1:8094/`에 열었다. API는 실제 로컬 PostgreSQL의 `masscom_showcase_ci_20261008133817_test`를 쓰는 3308이다. 루프백 프록시는 이 API 한 곳에만 연결하며 Cookie·Origin·Referer를 전달하지 않는다. 앱 목록이나 응답을 fixture로 바꾸지 않았다. Metro 캐시를 지우고 다시 export한 뒤 탐색의 새로고침으로 `/v1/discovery/search` 200을 관측했다.

- PASS: 목록의 `QA 가상 월계 달빛빵집`, 시연 데이터 표기, 위치 확인됨, 진행 중 캠페인·보상 가능.
- PASS: 실제 상세에서 이름·주소·최신 첨부 사진 우선 표시와 1·3·5회 코인 목표 확인. 최신 첨부 이미지는 콘셉트 시안이며 실제 영업점 사진이 아니다.
- PASS: DB의 프로젝트 서비스 `create/publish` 결과가 앱의 캠페인에 연결됨. 로그인·동의 제출 없이 공개 탐색·상세만 확인했다.
- NOT_RUN: 시연 점포 길찾기는 앱에서 비활성화돼 있다. 실제 T map 요청·실기 방문·코인 지급은 검증하지 않았다.

화면: [07-customer-app-virtual-store.jpg](07-customer-app-virtual-store.jpg), [08-customer-app-store-detail.jpg](08-customer-app-store-detail.jpg). 해당 DB·HTTP 실행 기록은 [browser-db-result.json](browser-db-result.json)이다. 최종 QA 스크립트는 다른 API를 잘못 확인하지 않도록 포트 점유를 검사하며, 별도 포트 3309·fresh DB에서 다시 PASS했다([result.json](result.json)). PostgreSQL 최신 사진 통합 시험은 별도 `_test` DB에서 1/1 PASS다.

## 배포 담당자에게 전달할 조건

1. 기존 PR #413의 Caddy `/api/web/v1/*` 수정과 이 PR의 API·웹 자산을 함께 배포한다. 신규 migration은 없다.
2. 실계정의 점포 승인은 기존 점주·직원 승인 절차로 처리한다. URL이나 이메일만으로 권한을 만들지 않는다.
3. AI는 기존 제공자·예산·일일 한도를 확인해 설정한 뒤 실제 생성 성공·실패를 검증한다. 키·토큰·QR 원문은 PR에 첨부하지 않는다.
4. 가상 가게는 시연 DB·API에만 추가한다. 로컬 QA 가게 등록을 공개 운영 앱 반영으로 설명하지 않는다.

되돌리기는 이 변경 커밋을 revert하고 API·웹을 함께 이전 자산으로 재배포한다. 이전 보유 수집품·프로젝트·DB schema에는 변경이 없다.
