# HANDOFF

## 2026-10-09 PR #446·#448 통합 배포와 Android 사전 릴리스

PR #448은 main `76e56cc2`, PR #446은 main `ff6d7d71`에 병합됐다. 배포한 소스 `dbcc44037264344dc79c92766bc2681fb5386837`의 트리는 main `ff6d7d71`과 같다. 운영 API·웹과 시연 API·`/play/`가 이 소스로 동작하며 두 DB 원장은 76개, 마지막 `0077_ai_art_account_limits.sql`이다([배포 근거](evidence/release-dbcc440-2026-10-09.json)). 운영 test.14와 시연 Preview 24 APK가 공개 사전 릴리스로 게시됐고 자산 digest가 빌드 SHA-256과 일치한다([현재 릴리스](CURRENT_RELEASE.json)). `/open`의 새 설치 링크는 이 문서 커밋을 운영 웹에 배포한 뒤 확인한다. 신규 두 APK의 기기 설치·로그인·지도·지갑·QR·TalkBack과 최종 제출은 아직 수용하지 않았다.

2026-10-09 PR #445 우표형 뽑기 영상과 효과음은 main `97d351bd`에 병합됐다. 이번 통합은 영상 준비 뒤 재생·효과음 설정 대기·움직임 줄이기 조건을 유지하며, 공유 재고·일반 상자·재뽑기 보상과 등록 앨범도 함께 보존한다. 당시 시험 결과는 [TEST_STATUS](TEST_STATUS.md)에 남긴다.

## 2026-10-09 시연 지갑·지도 설정 복구 (Issue #447)

[PR #448](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/448), `fix/showcase-wallet-map-config`. 시연 Reown 명시 설정·지도 키 누락 차단을 구현했고 재발급된 TMAP 키를 Git 밖 설정에 반영했다. Samsung 최종APK `f07637eb`는 동일서명 설치·설치파일 해시 일치·실제 TMAP 타일·지갑 CONNECTED/BASE_SEPOLIA 복원 PASS. 주소 서명은 UNVERIFIED로 남겼다. 최신 main 병합 `c3c41bf3`에서 모바일2231/2231·타입 PASS, lint 오류0/기존경고1. [실기/자동검사](evidence/wallet-map-config-2026-10-09/README.md). 네이버 결제수단은 기존 등록 확인, Reown 기존 프로젝트 공유는 소유자 확정이고 `.demo` 허용 목록을 등록했다. DNS·결제·공개 서버/배포·Play는 변경하지 않았다. PR 최신 CI·병합 상태는 GitHub에서 확인한다.


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

### 2026-10-09 PR #445와 main 병합 중 (파일 수정만·미배포)

현재 `.worktrees/pr445`의 `feat/gacha-stamp-reveal` HEAD `dd76e693`에 main `2cfcc8e8`을 합치는 중이다. 문서와 브라우저 fixture 양쪽 기능을 보존하고 영상 준비·소리 설정 회귀를 수정했다. 대상 9/9·모바일 전체 Node loader 2229/2229, typecheck·lint(기존 경고 1), 접근성·지갑 표면·CI 연결(104개 시험 파일)·운영 제출 준비, fixture 문법·빌드 전용 검사 PASS다. npm 진입점은 sandbox tsx IPC `listen EPERM`으로 BLOCKED다. API 674/674는 앞선 측정값이며 이번 병합에서는 `NOT_RUN`이다. 새 앱 빌드·브라우저·실제 기기 재생·청음·배포도 NOT_RUN이다. Git index는 미병합 상태이며 상세는 [TEST_STATUS](TEST_STATUS.md) 최상단에 기록했다.

### 2026-10-09 우표 뽑기 영상·제공 효과음 PR 인수인계

- 현재 작업 트리: `C:\Hackerton\27_MassCOM-gacha-stamp`, 브랜치 `feat/gacha-stamp-reveal`, 분기 기준 main `b37063c0`, 구현 커밋 `6b7bc2f7`. Issue #442의 [PR #445](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/445)를 생성·push했다. 아래 파일 수정만 요청한 세션 기록은 이전 이력이다. GitHub CI는 PR에서 진행 상태를 확인한다.
- 사용자 승인 영상 스트림을 보존하고 제공 OGG 10개로 개봉 효과음을 교체했다. 기존 BGM·효과음 설정, 보상 지급·중복 복구·도감 등록을 유지한다. 새로운 Android 재생 모듈이 포함되어 실제 네이티브 영상에는 앱 재빌드가 필요하다.
- 모바일 전체 2212/2212, 브라우저 27/27·콘솔 오류 0, 타입·린트, 네이티브 모듈 컴파일과 두 variant Android JS export PASS. 린트 기존 경고 1개. 지정 architect 모델 실행 불가는 [QA](GACHA_STAMP_QA_2026-10-09.md)에 별도 기록했고 code-reviewer APPROVE·보조 critic CLEAR를 받았다.
- 다음 수용 경계는 운영/시연 설치본 재생·청음이며 이번에는 NOT_RUN이다. 배포·Play 업로드는 수행하지 않았다. 테스트 명령과 화면·자산 증거는 [TEST_STATUS](TEST_STATUS.md) 최상단이다.
- 로컬 gate의 비밀·크기·충돌·부트스트랩·운영 문서·증거 일관성은 통과했고, 마지막 배포 문서 검사는 Windows CRLF 정규화 뒤 별도 재실행으로 통과했다. 무관한 줄바꿈 변경은 Git diff에 포함하지 않았다.

**2026-10-09 CI 병렬 작업 분리 (PR #443)**

작업 위치 `.worktrees/ci`, 브랜치 `ci/parallel-jobs`, 기준 HEAD `3645c4c7dedc3fc750e9ebadc218432a74a23e0a`. 기존 검사를 API·PG 2샤드·모바일·웹/운영/문서·계약/worker로 분리하고 필수 `bootstrap-contract` 집계를 유지했다. 변경 파일은 `.github/workflows/ci.yml`, 새 `tests/ci/parallel_jobs.test.mjs`, TEST_STATUS·AI_USAGE·이 인수인계 항목이다. 로컬 CI 연결·기존 YAML 참조 회귀·샤드/집계 2/2·YAML/문법/명령 보존 PASS; 실제 GitHub 약 5~6분 예상은 미측정, actionlint 미설치. 다음 로컬 확인은 `bash tests/ci/ci_wiring_test.sh`와 `node --test tests/ci/parallel_jobs.test.mjs`; 상세는 [TEST_STATUS](TEST_STATUS.md) 최상단. 사용자 지시로 Git add·commit·stash·merge·rebase·push와 원격 CI 실행은 하지 않았다.

### 앞선 인수인계 — 2026-10-09 PR #435 리뷰 후속
### 앞선 2026-10-09 PR #439 통합 기록 (당시 미커밋·미배포)

당시 기준 시각: 2026-10-09 KST. 당시 브랜치 `integ/pr439`에서 main과 PR #439의 파일 내용을 통합 중이었다.
기준 main 커밋 SHA: `b37063c0f6aadd845c6939b7b6a48eb4eab183b3`.

- 당시 작업 위치는 `.worktrees/i439`, 브랜치는 `integ/pr439`, HEAD는 main `b37063c0`, MERGE_HEAD는 PR #439 `e7395c96`이다. 충돌 파일의 내용만 합치고 Git index의 미병합 상태는 유지한다. #439의 홈·도감 다음 행동, 가게 코인 보기, 점주 결과 이동과 main의 T9 은퇴 점포 숨김·BGM·#435 등록 후속·공공자료 고지를 함께 보존한다. 점주 최근 결과 바로가기는 같은 가게 쿠폰 사용 직후에도 다시 읽도록 수정한다. 홈 다음 행동은 T9 은퇴 점포의 코인권을 노출하지 않도록 기존 공통 필터를 재사용하고 회귀 시험으로 고정한다.
- 당시 README·PROJECT_STATE 합계는 API 674/674(앞선 main 측정, 당시 재실행 아님)과 모바일 2216/2216(당시 통합 실측)을 동일한 한 줄에 기록했다. 모바일 npm 진입점은 tsx IPC `EPERM`으로 BLOCKED였고 동일 glob Node loader로 2216/2216 PASS했다. 점주 사이트 선택 86/86, 모바일 typecheck·lint(기존 경고 1개), 접근성·CI 연결·운영 제출 준비도 PASS였다. 상세는 TEST_STATUS의 PR #439 절을 따른다. 당시보다 이전 브랜치 수치와 Android export/브라우저 검증은 아래 이력으로만 취급한다. 당시 작업에서 Git add·commit·stash·merge·rebase·push, 배포·기기 수용은 수행하지 않았다.

### 2026-10-09 선택 작업 후속 (Issue #438, 이전 브랜치 기록·미배포)

작업 위치는 `/Users/choi/Desktop/MassCOM/collection-next-actions`, 브랜치는 `feat/collection-next-actions`이다. PR #435 `644beb75` 위에서 홈·도감·가게 코인 연출·점주 결과 이동을 보완했으며, #435와 기존 #418/#429 코인 디자인 변경을 보존한다. [작업 결과와 검증 한계](SELECTED_ACTIONS_QA_2026-10-09.md), [P4/X2 보류·미승인 정책안](SELECTED_POLICY_REVIEW_2026-10-09.md)을 먼저 읽는다. P4의 실제 잔여 재고와 표시 기준, X2 동일 방문 인증·강화권 규칙은 구현하지 않았다. 기존 쿠폰·NFT·소유·추첨 권리는 그대로다. 구현 소스는 `833f0000`이며 모바일2183/2183·typecheck/lint·점주17/17·로컬 gate·두 variant Android export가 PASS다. 후속 [PR #439](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/439)의 base는 `feat/reward-album-confirmation`이다. 선행 #435가 병합된 뒤 최신 main과 비교해 base를 전환하고 후속 검사/병합한다. 이번에 #435 또는 main을 병합하지 않는다. CI는 `gh pr checks 439 --repo 2026-KW-HACKATHON/27_MassCOM`으로 확인한다. 운영 배포·실기 수용은 NOT_RUN이다.

### 이전 인수인계 — 2026-10-09 PR #435 리뷰 후속

- 현재 위치: `.worktrees/album`, 브랜치 `fix/album-registration-followups`, HEAD `5e4e648e99a7c028e117c0b219e5b11507ed9221`. PR #434·#435·#437을 포함한 통합 기준 위 파일만 수정했다. 아래 BGM·T9·이전 획득 구현 기록은 이전 작업의 상태다.
- 옷 신규 판정·등록 헤더·코인 모달 움직임 감소·등급 등록 단계 보존 4건을 수정하고 회귀 12건을 추가했다. 기존 시험 약화 없이 모바일2203/2203·대상60/60·typecheck·lint·접근성·CI 연결103개 파일 PASS. npm test는 tsx IPC EPERM으로 BLOCKED이며 같은 glob Node loader로 검증했다. 기존 lint 경고1개. 당시 상세 명령·로그·검증 경계는 [TEST_STATUS](TEST_STATUS.md)의 PR #435 절이다.
- README·PROJECT_STATE 현재 합계는 동일하다. API674/674는 기존 통합 측정값이며 이번 API 재실행·빌드·배포·각 Android 설치본 수용은 NOT_RUN이다. 보상 정책·운영 데이터·의존성 변경은 없다.
- Git add·commit·stash·merge·rebase·push를 수행하지 않았고 index는 비어 있다. 다음 검토 명령: `git diff --check`, `git diff`, `git status --short`. 커밋·통합은 이 세션의 요청 범위 밖이다.

아래는 이전 인수인계 기록이다.

이전 기준 시각: 2026-10-09 KST. 배경음 수정 브랜치 `fix/bgm-start`에 PR #433 반영 main `c7632b35`를 병합 중인 작업 트리의 현재 상태를 기록한다. 날짜별 이전 기록은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

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
