# HANDOFF

2026-10-09 PR #445 우표형 뽑기 영상과 효과음은 main `97d351bd`에 병합됐다. 이번 통합은 영상 준비 뒤 재생·효과음 설정 대기·움직임 줄이기 조건을 유지하며, 공유 재고·일반 상자·재뽑기 보상과 등록 앨범도 함께 보존한다. 당시 시험 결과는 [TEST_STATUS](TEST_STATUS.md)에 남긴다.

2026-10-09 CI 병렬화(PR #443)는 API·PostgreSQL 2샤드·모바일·웹/운영/문서·계약/Worker로 기존 검사를 나누고 필수 `bootstrap-contract` 집계를 유지한다. 상세 변경과 당시 검증은 [TEST_STATUS](TEST_STATUS.md)에 보존한다. 실제 GitHub 실행 시간과 actionlint는 이 로컬 병합에서 확인하지 않았다.

## 1. 기준 커밋과 작업 위치

기준 시각: 2026-10-09 KST
기준 main 커밋 SHA: `b37063c0` (통합 HEAD `48ad22be`)
브랜치 `fix/ai-image-gap-fixes`, worktree `.worktrees/ai-image-gap-fixes`. 최신 소스는 통합되어 커밋되었으며 부모가 PR 준비를 진행한다.

## 2. 현재 구현

통합본에는 도감 보상 등록과 실제 가게만 노출하는 공개 경계가 포함된다. 점주 체험 AI 생성은 계정 전체 기준 KST 하루 시안 3회·최종 3회, 요청 간 60초 제한이다. 공유 뽑기·일반 상자·재뽑기·연합 미션 규칙은 최신 통합 HEAD에서 유지된다.

## 3. 현재 검증 결과

API 677/677, 모바일 2220/2220, 사이트 493/493 PASS. API·모바일 typecheck/build 및 모바일 lint(경고 0) PASS. 최신 독립 리뷰에서 핵심 7개 경로와 UI 대상 19개 모두 APPROVE. 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN`.

## 4. PostgreSQL 검증

fresh schema migration 75/75 PASS. 전체 통합은 603개 중 600 PASS / 0 FAIL / 3 SKIP이고, 각 SKIP은 fresh host-seed 환경에서 별도로 1/1 PASS했다. 이를 단일 603/603 runner 결과라고 쓰지 않는다.

## 5. 브라우저와 화면 증거

이전 HEAD `43c0cee0`의 [기능 캡처](evidence/alliance-draw-2026-10-09/README.md)는 일반 상자·공유 재고·재뽑기·보유 상세·7일권 만료·가상 A/B/C 시연 코스·AI 잔여량 표시를 확인한 양성 검증이다. 최신 main 통합 뒤의 [development 캡처와 manifest](evidence/alliance-draw-2026-10-09/integration-9545b503.json)는 개발 화면이라 가상 A/B/C가 보인다. hosted real-only 화면의 시각적 비노출 근거로 설명하지 않는다. real-only filter는 integration/PG 시험에서 확인했다.

## 6. 배포와 개인정보 동의

최신 통합 소스는 운영·시연 서버나 공개 APK에 반영되지 않았다. `privacy-2026-10-09` 동의 변경을 포함하므로 배포 시 API·웹·운영 APK·시연 APK·시연 웹을 함께 갱신한다.

## 7. OpenAI 키와 과금 경계

운영·시연 API의 키는 기존 이미지에서 healthy 상태로 확인됐다. 서버별 USD 5 월 예산과 기존 점포별 시안·최종 일 3회 설정이 적용돼 있고 새 계정 공통 제한은 소스에서만 동작한다. 실제 유료 생성은 `NOT_RUN`; 키·환불·결제 개인정보는 문서에 기록하지 않는다.

## 8. 데이터베이스 변경

fresh schema 75/75 migration 검증에는 `0076_ai_art_account_limits.sql`이 포함된다. 신규 통합 전체를 운영/시연 DB에 적용하지 않았다. 호스트 적용은 별도 배포 증거로 판정한다.

## 9. 알려진 검증 한계

과거 완료 최종 생성 행은 새 계정 한도에 소급 집계되지 않는다(독립 P2 리뷰 APPROVE, WATCH). main 통합 후 development 화면에는 가상 점포가 표시된다. hosted real-only UI 수용, Android 실기, 유료 생성 및 새 소스의 운영/시연 배포는 `NOT_RUN`이다.

## 10. 다음 확인

PR 생성 및 CI는 부모가 진행한다. 배포 시 개인정보 동의 버전과 API·웹·두 APK·시연 웹의 동시 릴리스 조건을 확인한다.

## 11. PR 추적과 제출 검사

현재 PR 목록은 `gh pr list --repo 2026-KW-HACKATHON/27_MassCOM`으로 확인한다. 제출 시 제목과 본문을 실제 내용에 맞게 바꿔 검사한다.

```bash
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
bash tests/bootstrap/check_pr_korean_test.sh  # checker 자체 회귀 시험
```

## 12. 문서·검증 명령

운영 문서 회귀는 `bash tests/bootstrap/verify_operations_docs_test.sh`, 출시 문서 일치는 `node scripts/render-current-release.mjs --check`, 빠른 전체 gate는 `bash tools/gate.sh`로 확인한다.

## 13. 승인·보안 경계

OpenAI 키는 서버 비밀 파일에만 둔다. 자동/가상 시험을 실제 점주 동의·현장 방문·유료 이미지 생성·운영 변경·공개 배포의 증거로 표현하지 않는다. 개인키·복구 문구·결제 정보를 기록하지 않는다.

## 14. 이력과 변경 규칙

- 이전 브랜치 검증과 main 병합 전 브라우저 캡처는 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 당시 범위 그대로 보존한다.
- 최신 main 이후 development 캡처는 별도 표기하고 hosted real-only 시각 검수와 혼동하지 않는다.
- 한국어 PR 검사와 Lore 커밋 규칙을 따른다. AI 공동 작성자 표시는 넣지 않는다.

최종 추가 통합: PR #446, main9282477d·2cfcc8e8 반영, 제품 코드 API 변경 없이 모바일2233/2233·사이트495/495·CI연결105·병렬CI2/2·gate PASS. 공개 배포는 미실행이다.

최종 우표 영상 병합: main97d351bd/HEAD2cc31120, 모바일2246/2246·타입·lint PASS. 직전 GitHub CI7/7 통과 후 최신 CI는 재실행 중이며 최신 결과를 이전 통과로 대체하지 않는다. PR446에 모든 변경을 푸시했다.
