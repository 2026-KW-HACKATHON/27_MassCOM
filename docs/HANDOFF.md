# HANDOFF

기준 시각: 2026-10-08 KST. 이 문서는 다음 작업의 현재 상태만 기록한다. 날짜별 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

## 1. 기준 커밋과 작업 위치

- 기준 main 커밋 SHA: `09dfceb0b39beaa8afe39bcc4bced471f9eb582c`(PR #404 병합). 현재 worktree 브랜치는 `fix/play-web-navigation`이며 수정 커밋은 `9f5ebfa6f6e4259142f8a1834d3b1ccb26fc3e49`다.
- 운영 API·웹 배포, 시연 API 배포, 두 Android Release 게시는 완료했다. 새 `/open` 링크와 `/play/` 번들 전환은 이 PR 병합 뒤 진행한다.

## 2. 현재 통합 상태

- PR #398·#400·#403·#404는 병합됐다(제공된 2026-10-08 기록 기준). #398을 열린 PR로 적은 과거 전달은 [당시 기록](HANDOFF_HISTORY.md#2026-10-07-pr이슈-점검-전달-결과)이다.
- PR #396은 닫혔으나 main에 병합되지 않았다. 미병합 초안을 공개본 기능으로 계산하지 않는다.
- 재개 시 `git status -sb`, `git log -1 --oneline`, `gh pr list --state all`로 다시 대조한다.

## 3. 공개 서버와 설치본

- 시연 서버는 main `2d483ed8`의 API와 트리 `74e47887`의 `/play/` 웹 번들로 배포 완료했다. 시연 DB 원장은 43→68건(마지막 `0067_room_guestbook.sql`), 공개 `demo-api /health`·`/play/`·가상 점포 collectible-preview 200, `/coin-shop` 401(인증 필요)이다. [시연 배포 증거](evidence/showcase-deployment-2d483ed-2026-10-08.json)를 따른다.
- 운영 API·웹은 main `09dfceb0`로 배포 완료했다. 원장 43→68건(마지막 `0067_room_guestbook.sql`), API·웹 이미지 healthy, Caddy 재생성, retention 첫 실행 success, 공개 `api.masscom.kr/health`·`www` `/`·`/app/`·`/admin/`·`/open` 200, `/coin-shop` 401이다([운영 배포 증거](evidence/production-deployment-09dfceb-2026-10-08.json)).
- 소스 `9f5ebfa6`의 [운영 Android test.12](evidence/operating-android-test12-2026-10-08.json)와 [시연 Android Preview 21](evidence/showcase-preview21-release-2026-10-08.json)을 게시했다. 두 APK 모두 `RECORD_AUDIO`가 없고 내부 versionName/Code는 `0.1.0-test.2`/`2`다. 실제 설치·실기 수용은 별도다. 시연 서버·설치본에는 지도 키가 없어 목록 기반 탐색으로 동작한다.
- 시연·운영 서버 안 실제 DB 복원 리허설이 각각 PASS다. 운영은 첫 실제 복원 증거(P03)이며 복제본 migration 43→68건·`account_consents` 5=5 보존 후 복제본·임시 dump를 삭제했다([운영 리허설](evidence/production-restore-rehearsal-2026-10-08.json)).

## 4. 이번 작업의 범위

- [Issue #401](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/401)은 제출 전 운영·문서·심사 대응 정리다. 이 worktree의 코드·문서·시험 변경과 실제 공개 반영은 별도 상태로 추적한다.
- 서버·모바일·웹·첫인상·운영 결함 수정과 심사 대응 문서 정리 뒤 시연·운영 배포와 두 Android 게시가 완료됐다. 공개 체험에서 17단계 PASS·콘솔 오류 및 HTTP 4xx/5xx 0건을 기록했고 발견한 4건은 `9f5ebfa6`에서 수정했다([캡처·원자료](evidence/submission-2026-10-08/README.md)). 구현·검증은 [PROJECT_STATE](PROJECT_STATE.md)와 [TEST_STATUS](TEST_STATUS.md)를 따른다.

## 5. 시연 배포 순서

- 시연 전용 DB 복원 리허설 PASS(107개 테이블 행 수·migration 목록 일치), 배포 전 백업, 25개 migration 적용으로 원장 68건을 기록했다. API·`/play/` 공개 전환과 Preview 20 게시도 완료했다.
- 라이브 `/open`은 배포 당시 test.11·Preview 20 링크였다. 저장소 안내를 test.12·Preview 21로 갱신한 뒤 이 PR 병합 커밋의 운영 웹 재배포로 반영한다. 실제 설치본의 동의·체험 수용은 후속 확인으로 남긴다.
- 정확한 순서와 실패 대응은 [운영 절차](OPERATIONS_RUNBOOK.md)를 따른다.

## 6. 운영 배포 조건

- 운영 DB 실데이터의 서버 안 실제 복원과 복제본 migration 리허설은 PASS다. 원본 107개 테이블 행 수, 복제본 43→68건·1.8초, `account_consents` 5=5·공개 점포 0을 확인했다. 이 증거로 P03 복원 관문을 충족했다.
- 운영 서버는 `backward_compatible=no` 증거와 `scripts/deploy-lightsail.sh --deploy`로 `09dfceb0` 배포를 완료했다. 배포 전 백업 `/opt/masscom/backups/database-before-09dfceb0b39b.dump.*`는 186,604바이트·mode 600이며 `DEPLOYED_COMMIT`이 새 SHA를 가리킨다([증거](evidence/production-deployment-09dfceb-2026-10-08.json)). 원장 변경 릴리스이므로 구 API 자동 복귀는 금지된다.

## 7. 마이그레이션과 롤백 경계

- 새 원장에 거래가 기록된 뒤에는 이를 모르는 구 API로 자동 복귀하지 않는다. 이번 비호환 릴리스의 배포 증거는 `backward_compatible=no`로 기록하고 실패 시 쓰기를 멈춘 뒤 새 원장을 이해하는 버전으로 전진 복구한다.
- 릴리스 전후 백업·원장 수·쓰기 중지 조건은 [운영 절차](OPERATIONS_RUNBOOK.md)와 실제 복원 시험에서 검증한다.

## 8. 개인정보 재동의와 버전 결합

- 새 API의 개인정보 안내 버전은 `privacy-2026-10-07`이다. API만 먼저 공개하면 test.10/Preview 19의 동의 화면에서 `outdated`로 막힐 수 있다(`apps/mobile/src/privacy/consent-flow.ts`).
- 시연 API와 운영 API는 배포됐고 Preview 21·test.12가 게시됐다. 라이브 `/open`은 이 PR 병합 뒤 웹 재배포로 새 링크를 반영한다. 구 설치본의 재동의 확인은 별도 수용 항목이다.

## 9. 자동 검증 상태

- 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN` ([시험 원장](TEST_STATUS.md), [제출 증거](SUBMISSION_EVIDENCE.json)).
- Issue #401 구현 브랜치 `fix/submission-readiness`의 당시 검사: API 단위 567/567·PostgreSQL 524 PASS/3 SKIP(전용 55435 hosted seed 컨테이너 조건), API typecheck·build, 모바일 1,872/1,872·typecheck·lint·운영/시연 Android export·variant 자산·접근성 의미 PASS. `9f5ebfa6` 수정은 독립 Codex 리뷰 APPROVE, 모바일 1,876/1,876·typecheck·lint·접근성·gate PASS다.
- 해당 브랜치의 사이트·운영 시험(로컬 restore drill 실DB 포함)·`bash tools/gate.sh` PASS. 이번 운영 서버 실데이터 복원·migration 리허설은 별도 [P03 증거](evidence/production-restore-rehearsal-2026-10-08.json)로 기록한다.
- 앞 문장의 Issue #401 결과와 PR #404 문서 worktree 검사는 당시 기록이다. 현재 브랜치의 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 별도로 기록한다.
- 기본 재현: `bash tools/gate.sh`, `bash tests/bootstrap/verify_operations_docs_test.sh`, `bash tests/site/verify_evidence_consistency_test.sh`, `bash tests/ops/showcase_host_readiness_test.sh`.

## 10. 수동 수용과 미실행 항목

- 실제 Preview 21/test.12 설치·개인정보 재동의·점주 역할·NFT 발행은 이 문서 갱신으로 `PASS`가 되지 않는다. 운영 DB 복원 리허설과 운영 배포는 각각 별도 증거로 PASS다. 수정된 `/play/` 번들의 공개 재측정은 아직 `NOT_RUN`이다.
- 로컬 자동 시험, 서명된 빌드, 서버 배포, 다운로드, 실기 수용, 최종 제출은 각각 다른 증거로 기록한다.

## 11. 남은 이슈와 PR 확인

- #206의 전체 체험 수용과 #380·#394의 남은 범위는 실제 Issue 상태와 증거를 재확인한다. 과거 기록의 열린 PR 목록을 현재 목록으로 사용하지 않는다.
- PR 상태는 `gh pr list --state all` 및 개별 `gh pr view <번호> --json state,mergedAt,headRefOid`로 확인한다.
- [PR #402](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/402)(뽑기 `CONSENT_REQUIRED`를 "동의 확인하기"로 연결): 2026-10-08 최신 main과 문서 충돌을 풀고 모바일 1,878/1,878·gate 통과, 독립 리뷰 승인. 남은 🟡: 개발용 DEMO 계정의 동의 화면 "로그아웃"이 DEMO 상태를 벗어나지 못함, 동의·미설정 거절 뒤 뽑기 대기 기록 유지(같은 요청 ID 복구).

## 12. 다음 실행 명령

1. 이 PR의 `/open` 링크·증거 JSON·현재 요약을 검사하고 병합한다.
2. 병합 커밋으로 운영 웹을 재배포해 `/open`의 test.12·Preview 21 링크를 확인한다(API 변경·migration 없음).
3. 시연 `/play/`를 `9f5ebfa6` 번들로 전환하고 5분 흐름을 재측정한다. 실제 설치·재동의·탐색을 별도 확인한다. Google Play·최종 제출은 별도 승인 경계다.

PR 제목·본문 검사:

```bash
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
bash tests/bootstrap/check_pr_korean_test.sh  # checker 자체 회귀 시험
```

## 13. 승인·보안 경계

- 운영 키 생성·메인넷·사용자 자산 이동·Google Play 공개·대회 최종 제출은 별도 승인 경계다. 개인키·복구 문구·비밀번호는 기록하지 않는다.
- 운영 DB 첫 실제 복원과 복제본 데이터 보존, 배포 전 백업과 `09dfceb0` 실제 배포 결과는 각각 증거로 PASS다.

## 14. 이력과 변경 규칙

- 2026-09-22부터 2026-10-07까지의 날짜별 인수인계 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 그대로 보존한다. 과거 기록의 “현재”, “열린 PR”, “다음 명령”은 작성 당시의 상태다.
- 다음 중단 전 이 14절의 기준 SHA·브랜치·PR·공개 버전·검증 상태·다음 명령만 실제 근거에 맞춰 갱신한다.
