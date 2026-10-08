# HANDOFF

2026-10-09 PR #445 우표형 뽑기 영상과 효과음은 main `97d351bd`에 병합됐다. 이번 통합은 영상 준비 뒤 재생·효과음 설정 대기·움직임 줄이기 조건을 유지하며, 공유 재고·일반 상자·재뽑기 보상과 등록 앨범도 함께 보존한다. 당시 시험 결과는 [TEST_STATUS](TEST_STATUS.md)에 남긴다.

## 2026-10-09 PR #440 리뷰 지적 수정 (파일 수정만·미배포)

작업 위치 `/Users/choi/Desktop/MassCOM/27_MassCOM/.worktrees/pr440`, 브랜치 `feat/friend-actions-guestbook`, HEAD `2a541d736ba8f9eb272eed3725afbc36620e5d37`, 로컬 `origin/main` `3645c4c7dedc3fc750e9ebadc218432a74a23e0a`다. 실제 [PR #440](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/440)은 OPEN이며 조회 시 원격 head는 `380b3c43918a637c26b1dbcb9fa4d2b90b70d51a`였다. 이 작업은 HEAD 위 파일 수정이며 Git add·commit·stash·merge·rebase·push를 실행하지 않는다.

- body 없는 방명록·스탬프 DELETE, 새 앱의 공개 범위 capability 헤더와 구 파서 응답 호환, 작성자 본인 방 공개에 따른 친구 추가 동의·하루20회 제한, 비친구의 전체 공개 방 공통 가게 비공개, 글 하루10건 제한을 수정했다. 제거 본문은 지우고 중복 방지 행을 유지한다. 잘못된 cursor와 삭제 계정 오류도 서비스 오류로 응답한다.
- migration0076의 확장 CHECK는 `NOT VALID`, 신고 entry FK 조회는 인덱스를 사용한다. 신고 처리와 계정 삭제는 동일한 잠금 순서를 적용하며 PostgreSQL 동시 회귀로 검증했다. 새 시험은 기존 단언을 약화하지 않는다.
- 배포 분류는 **`backward_compatible=no`**, 전환 경로는 **stop-migrate-start**다. 구 API+새 스키마는 방 소유자 삭제 시 비연쇄 FK에 막히고, 새 API+구 스키마는 삭제 시 없는 테이블을 조회하므로 rolling 배포나 구 API 자동 복귀를 하지 않는다. 운영 test.14·시연 Preview 24·API·웹·`privacy-2026-10-09`를 한 유지보수 창에서 전환한다. 이전 API/쓰기 Worker 중지·검증 백업 → migration0076 → 새 API 시작 → 두 앱과 공개 링크 게시·확인 순서이며 실패 시 [전진 복구](OPERATIONS_RUNBOOK.md)를 따른다. 동의 상승에 따른 기존 설치본 제한은 이번 사용자 요청에서 승인됐다.
- 새 검증은 API681/681·모바일2197/2197·PostgreSQL600건 중597 PASS/기존3 SKIP/FAIL0·법률 페이지12/12, 두 앱 타입·모바일 lint(기존 경고1)·API 빌드·CI 연결103개·운영 문서·gate PASS다. [TEST_STATUS](TEST_STATUS.md)의 PR #440 후속 항목과 `/private/tmp/pr440-review-*` 로그를 따른다. 실제 배포·APK 빌드/서명/설치·각 variant 실기·원격 CI는 이번 수정과 별개다. 다음 명령은 `git diff --check`, `git diff`이며 커밋·통합·배포는 하지 않았다.

**이하 이전 팀원 작업 이력 — 위치·검사 수치·진행 상태는 각 기록 당시 기준이다.**

## 2026-10-09 Issue #436 친구 그림 버튼·방명록 전달

작업 위치는 `C:/Hackerton/27_MassCOM-friend-actions`, 브랜치는 `feat/friend-actions-guestbook`이다. 최초 기준은 PR #433 반영 `c7632b35`다. PR #434 반영 최신 `origin/main` `3645c4c7`을 병합 커밋 `2a541d73`에 통합했고 [PR #440](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/440)을 열었다. 최종 조회에서도 main의 추가 커밋은0건이다. 아래의 다른 브랜치·병합 상태는 당시 이력이다.

- 친구 오른쪽 하트·편지·숟가락·집, 원자 우정 받기/답장, 추천 없는 날짜·시간 휠을 구현했다. 우정의 기존 하루 보내기5회·행동별5P·합계25P를 유지한다.
- 모두/친구/개인 방 공개, 300자 글 방명록, 같은 방 하루 첫 글5P·별도 하루25P, 작성자 정보/친구 추가 팝업, 표시된 글만 읽음 처리하는 빨간 점을 구현했다. 기존 이웃 공개와 칭찬 스탬프 이력은 보존한다. 결정은 [D-104](DECISIONS.md), 재현·제한은 [증거](evidence/friend-actions-2026-10-09/README.md)를 따른다.
- API 단위679/679·모바일2196/2196·관련 웹173/173, API/모바일 타입·API 빌드·모바일 lint·운영/시연 Android export, 비밀 검사·CI 연결103개 파일은 PASS다. 방 관련 대상57/57·우정 PostgreSQL53/53도 PASS이며 전체 PostgreSQL599건은596 PASS·0 FAIL·기존 hosted 전용3 SKIP다. 브라우저 합성 화면48장과 실제 동작을 확인했다. 최신 통합본에서 공개 설정 저장·보상 후 헤더 갱신을 재확인했고 독립 코드 검토는 APPROVE다.
- 적용 시 `0076_room_guestbook_actions.sql`을 새 API보다 먼저 적용하고 API·앱·운영 웹·처리방침의 `privacy-2026-10-09`를 함께 맞춘다. 되돌릴 때도 방명록·마일리지 이력을 삭제하거나 기존 `NEIGHBORS`를 전체 공개로 바꾸지 않는다.

현재 PR은 #440이다. 최신 main 통합·한국어 PR 검사·독립 검토·로컬 gate·두 variant 최종 export는 PASS다. 원격 CI는 PR 검사에서 확인한다. 운영 배포·새 APK·서명·설치·실기·TalkBack은 NOT_RUN이며 제출 기준선과 공개 설치본 기록은 바꾸지 않았다.

**이하 이전 작업 이력 — 아래의 ‘현재’, SHA, 미병합 상태와 시험 합계는 각 기록 당시 기준이다.**

기준 시각: 2026-10-09 KST. PR #440의 `feat/friend-actions-guestbook` HEAD `2a541d73` 위 리뷰 수정 상태를 기록한다. 날짜별 이전 기록은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

### PR #440 기준 커밋과 작업 위치

- 기준 main 커밋 SHA: `3645c4c7dedc3fc750e9ebadc218432a74a23e0a`(로컬 `origin/main`)다. 현재 worktree `/Users/choi/Desktop/MassCOM/27_MassCOM/.worktrees/pr440`, 브랜치 `feat/friend-actions-guestbook`, HEAD `2a541d736ba8f9eb272eed3725afbc36620e5d37`다. PR #440(D-104)의 제품 의도와 통합된 BGM(D-103)·T9(D-101)·제작기(D-102)를 보존한다.
- 사용자 요청으로 파일만 수정했다. Git add·commit·stash·merge·rebase·push를 실행하지 않았다. `gh pr view 440`의 OPEN·원격 head 조회는 읽기 전용이며 원격 CI나 새 배포 완료를 뜻하지 않는다.

### PR #440 현재 상태

- PR #440 리뷰 지적9건의 로컬 수정과 지정 검증을 완료했다. 서버·새 앱의 capability 계약과 방명록 작성·친구 추가 상한은 [D-104](DECISIONS.md)를 따른다. 전용 테스트 DB migration 뒤 전체 PostgreSQL600건 중597 PASS·기존3 SKIP·FAIL0을 확인했으며 운영 DB에는 접근하지 않았다.
기준 시각: 2026-10-09 KST. PR #445 `feat/gacha-stamp-reveal`에 main을 합치고 리뷰 지적(우표 영상 준비 전 재생, 효과음 설정 대기)을 고친 상태다.

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

이전 fresh schema 75/75 migration 검증에는 당시 이름 `0076_ai_art_account_limits.sql`이 포함됐다. 최신 통합 파일은 `0077_ai_art_account_limits.sql`과 `0076_room_guestbook_actions.sql`을 함께 포함하므로 76개이며 재검증이 필요하다. 신규 통합 전체를 운영/시연 DB에 적용하지 않았다. 호스트 적용은 별도 배포 증거로 판정한다.

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
