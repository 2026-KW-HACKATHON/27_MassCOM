# 점주 웹 두 갈래 제작 검증 — Issue #417

기준 main: `e06c97cdad8d03b4e69b4008a91d39bedbbd874d`, 2026-10-08 KST. 첨부 기획 문서·이미지는 참고 자료로 읽었으며 문서 안 제안을 사용자 승인이나 실제 검증 결과로 취급하지 않았다.

## 실제 브라우저 결과

Codex in-app Chromium, 루프백 `http://127.0.0.1:4188/merchant/`, `COLLECTIBLE_QA_AI=1 node tests/fixtures/collectible-qa-server.mjs`로 실행했다. 이 서버의 계정·AI·캠페인은 **합성 UI fixture**다. 실제 Google 인증·AI 모델 호출·DB 저장의 증거가 아니다.

- PASS: 두 진입 카드 표시. 데스크톱 편집기 폭 1,096px, 가로 넘침 없음. 기존 페이지 44rem 자식 폭 제한을 제작기에서 해제했다.
- PASS: AI 시작 → 합성 초안 표시 → 그림 선택 → 사진 배치 1/4 → 작업 메뉴의 초안 저장 성공. 대표 그림 적용·자동 게시를 하지 않는다.
- PASS: 준비 이미지 시작 버튼에서 실제 파일 선택창이 열림 → 최신 첨부 참고 이미지 PNG 선택 → 사진 배치 → 등급 미리보기 2/4 → 초안 저장 성공.
- PASS: 390×844 뷰포트에서 모바일 작업 화면 표시, 문서 `scrollWidth=clientWidth=375`, 가로 넘침 없음. 실제 휴대전화·카메라·물리 기울임은 NOT_RUN.
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

실제 PostgreSQL 가상 점포 등록·앱 API 노출은 같은 폴더의 영속 QA 기록에서 별도로 확인한다.

## 배포 담당자에게 전달할 조건

1. 기존 PR #413의 Caddy `/api/web/v1/*` 수정과 이 PR의 API·웹 자산을 함께 배포한다. 신규 migration은 없다.
2. 실계정의 점포 승인은 기존 점주·직원 승인 절차로 처리한다. URL이나 이메일만으로 권한을 만들지 않는다.
3. AI는 기존 제공자·예산·일일 한도를 확인해 설정한 뒤 실제 생성 성공·실패를 검증한다. 키·토큰·QR 원문은 PR에 첨부하지 않는다.
4. 가상 가게는 시연 DB·API에만 추가한다. 로컬 QA 가게 등록을 공개 운영 앱 반영으로 설명하지 않는다.

되돌리기는 이 변경 커밋을 revert하고 API·웹을 함께 이전 자산으로 재배포한다. 이전 보유 수집품·프로젝트·DB schema에는 변경이 없다.
