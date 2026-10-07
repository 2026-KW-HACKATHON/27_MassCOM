# HANDOFF

기준 시각: 2026-10-08 KST. 이 문서는 다음 작업의 현재 상태만 기록한다. 날짜별 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

## 1. 기준 커밋과 작업 위치

- 기준 main 커밋 SHA: `a742e32dd76f36555e6969082b400946c048ad6b`(PR #402 병합). 현재 worktree는 `.worktrees/docs-final`, 브랜치는 `docs/submission-1008-final`이며 문서만 바꾼다.
- 병합 순서: PR #403(점검 결함 수정, `2d483ed8`) → #404(시연 배포·Preview 20·test.11 기록, `09dfceb0`) → #405(공개 체험 결함 4건 수정·운영 배포 기록·test.12/Preview 21, `08f125b4`) → #402(뽑기 `CONSENT_REQUIRED`의 "동의 확인하기" 연결, `a742e32d`). Issue #401은 #403 병합으로 닫혔다.
- 운영·시연 서버 배포, 두 Android Release 게시, `/open` 전환, 수정본 `/play/` 재측정은 모두 끝났다. #402의 변경만 공개 설치본·`/play/`에 아직 없다.

## 2. 현재 통합 상태

- PR #398·#400·#402·#403·#404·#405는 병합됐다. #398을 열린 PR로 적은 과거 전달은 [당시 기록](HANDOFF_HISTORY.md#2026-10-07-pr이슈-점검-전달-결과)이다.
- PR #396은 닫혔으나 main에 병합되지 않았다. 미병합 초안을 공개본 기능으로 계산하지 않는다.
- 재개 시 `git status -sb`, `git log -1 --oneline`, `gh pr list --state all`로 다시 대조한다.

## 3. 공개 서버와 설치본

- 운영 API·웹은 main `08f125b4`다. `scripts/deploy-lightsail.sh`로 배포했고 `backward_compatible=yes`, API 코드 변경 없음, migration 68건 유지다. 직전 `09dfceb0` 배포에서 원장이 43→68건(마지막 `0067_room_guestbook.sql`)이 됐고 API·웹 이미지 healthy, Caddy 재생성, retention 첫 실행 success였다([`09dfceb0` 배포 증거](evidence/production-deployment-09dfceb-2026-10-08.json)). `08f125b4` 재배포는 제공된 실행 기록이며 별도 증거 JSON은 아직 없다.
- 시연 API는 `2d483ed`(migration 68건, 마지막 `0067_room_guestbook.sql`)다([시연 배포 증거](evidence/showcase-deployment-2d483ed-2026-10-08.json)). 시연 웹 `/play/`는 소스 `9f5ebfa6`, entry `entry-bf096d15e2c9fd7c9a6b8bc41de15c48.js`다.
- 라이브 `/open`은 운영 [test.12](evidence/operating-android-test12-2026-10-08.json)·시연 [Preview 21](evidence/showcase-preview21-release-2026-10-08.json)을 가리킨다. 설치본 `MassCOM-operating-android-9f5ebfa.apk`(SHA-256 `266c64795ace1e1bbf0ba2bac4224e3638d88a9e6a1633e343ed309a9f4febd3`)와 `MassCOM-showcase-android-9f5ebfa.apk`(SHA-256 `f8c484a60e06084d64e7fe913091ec3901b53c1ce715e932fb9af0b78a807cc4`)는 익명 다운로드 해시가 게시 값과 일치했다. 두 APK 모두 `RECORD_AUDIO`가 없고 내부 versionName/Code는 `0.1.0-test.2`/`2`다. 실제 설치·실기 수용은 별도다.
- **#402의 상점 동의 오류 단추·문구는 공개 설치본과 `/play/`에 아직 들어가지 않았다.** 다음 빌드에서 반영한다. 시연·설치본에는 지도 키가 없어 목록 기반 탐색으로 동작한다.
- 시연·운영 서버 안 실제 DB 복원 리허설이 각각 PASS다. 운영은 첫 실제 복원 증거(P03)이며 복제본 migration 43→68건·`account_consents` 5=5 보존 후 복제본·임시 dump를 삭제했다([운영 리허설](evidence/production-restore-rehearsal-2026-10-08.json)).

## 4. 이번 작업의 범위

- [Issue #401](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/401)은 제출 전 운영·문서·심사 대응 정리이며 #403 병합으로 닫혔다. 이 worktree의 작업은 수정본 재측정 결과와 최종 공개 상태를 현재 요약 문서에 반영하는 문서 전용이다.
- [수정본 재측정](evidence/submission-2026-10-08-recheck/README.md)(Playwright, 시연 서버 임시 계정만)에서 이전 [17단계 실측](evidence/submission-2026-10-08/README.md)의 결함 4건이 모두 FIXED였다. 5분 시연 15단계가 전부 PASS이고 `console.error`·`pageerror`·4xx/5xx·요청 실패는 0건이다. 대체 시연 영상 `demo-flow-390.webm`(10,053,739바이트·4분 8초·390×844)과 캡처 68장을 같은 폴더에 보존했다.
- 새로 본 낮은 결함 4건은 아직 고치지 않았다: 이웃 방 하단 탭 두 벌 렌더링·탐색 선택 표시, 이웃 방→탐색 뒤 브라우저 뒤로 가기가 앱 밖으로 나감, 다크 꾸미기 "대표 수집 코인" 칩 흰색, 떠 있는 탭 바 아래 8px 틈으로 콘텐츠 비침. 구현·검증은 [PROJECT_STATE](PROJECT_STATE.md)와 [TEST_STATUS](TEST_STATUS.md)를 따른다.

## 5. 시연 배포 순서

- 시연 전용 DB 복원 리허설 PASS(107개 테이블 행 수·migration 목록 일치), 배포 전 백업, 25개 migration 적용으로 원장 68건을 기록했다. API·`/play/` 공개 전환과 Preview 20 게시도 완료했다.
- 라이브 `/open`은 #405 병합 커밋 `08f125b4`의 운영 웹 재배포로 test.12·Preview 21 링크가 됐다. 실제 설치본의 동의·체험 수용은 후속 확인으로 남긴다.
- 다음 빌드의 시연 `/play/` 번들 전환과 설치본 게시 순서·실패 대응은 [운영 절차](OPERATIONS_RUNBOOK.md)를 따른다.

## 6. 운영 배포 조건

- 운영 DB 실데이터의 서버 안 실제 복원과 복제본 migration 리허설은 PASS다. 원본 107개 테이블 행 수, 복제본 43→68건·1.8초, `account_consents` 5=5·공개 점포 0을 확인했다. 이 증거로 P03 복원 관문을 충족했다.
- 운영 서버는 `backward_compatible=no` 증거와 `scripts/deploy-lightsail.sh --deploy`로 `09dfceb0`(PR #404 병합) 배포를 완료했다. 배포 전 백업 `/opt/masscom/backups/database-before-09dfceb0b39b.dump.*`는 186,604바이트·mode 600이며 `DEPLOYED_COMMIT`이 새 SHA를 가리킨다([증거](evidence/production-deployment-09dfceb-2026-10-08.json)). 원장 변경 릴리스이므로 구 API 자동 복귀는 금지된다.
- 이후 `08f125b4` 재배포는 API 코드 변경과 migration이 없어 `backward_compatible=yes`로 기록했고 원장은 68건 그대로다.

## 7. 마이그레이션과 롤백 경계

- 새 원장에 거래가 기록된 뒤에는 이를 모르는 구 API로 자동 복귀하지 않는다. 이번 비호환 릴리스의 배포 증거는 `backward_compatible=no`로 기록하고 실패 시 쓰기를 멈춘 뒤 새 원장을 이해하는 버전으로 전진 복구한다.
- 릴리스 전후 백업·원장 수·쓰기 중지 조건은 [운영 절차](OPERATIONS_RUNBOOK.md)와 실제 복원 시험에서 검증한다.

## 8. 개인정보 재동의와 버전 결합

- 새 API의 개인정보 안내 버전은 `privacy-2026-10-07`이다. API만 먼저 공개하면 test.10/Preview 19의 동의 화면에서 `outdated`로 막힐 수 있다(`apps/mobile/src/privacy/consent-flow.ts`).
- 시연 API와 운영 API는 배포됐고 Preview 21·test.12가 게시됐으며 라이브 `/open`이 새 링크를 가리킨다. 구 설치본의 재동의 확인은 별도 수용 항목이다.

## 9. 자동 검증 상태

- 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN` ([시험 원장](TEST_STATUS.md), [제출 증거](SUBMISSION_EVIDENCE.json)).
- Issue #401 구현 브랜치 `fix/submission-readiness`의 당시 검사: API 단위 567/567·PostgreSQL 524 PASS/3 SKIP(전용 55435 hosted seed 컨테이너 조건), API typecheck·build, 모바일 1,872/1,872·typecheck·lint·운영/시연 Android export·variant 자산·접근성 의미 PASS. `9f5ebfa6` 수정은 독립 Codex 리뷰 APPROVE, 모바일 1,876/1,876·typecheck·lint·접근성·gate PASS다.
- 해당 브랜치의 사이트·운영 시험(로컬 restore drill 실DB 포함)·`bash tools/gate.sh` PASS. 이번 운영 서버 실데이터 복원·migration 리허설은 별도 [P03 증거](evidence/production-restore-rehearsal-2026-10-08.json)로 기록한다.
- PR #402는 모바일 1,878/1,878·gate 통과, 독립 리뷰 승인 뒤 병합했다. 앞 문장의 Issue #401 결과와 PR #404 문서 worktree 검사는 당시 기록이며, 현재 문서 브랜치의 검사 결과는 [TEST_STATUS](TEST_STATUS.md)에 별도로 기록한다.
- 기본 재현: `bash tools/gate.sh`, `bash tests/bootstrap/verify_operations_docs_test.sh`, `bash tests/site/verify_evidence_consistency_test.sh`, `bash tests/ops/showcase_host_readiness_test.sh`.

## 10. 수동 수용과 미실행 항목

- 실제 Preview 21/test.12 설치·개인정보 재동의·점주 역할·NFT 발행은 이 문서 갱신으로 `PASS`가 되지 않는다. 운영 DB 복원 리허설과 운영 배포는 각각 별도 증거로 PASS이고, 수정된 `/play/` 번들의 공개 재측정도 [재측정 기록](evidence/submission-2026-10-08-recheck/README.md)으로 PASS다.
- `NOT_RUN` 또는 소유자 몫으로 남은 항목: 실제 점주·이용자 현장 자료, 설치본 실기·TalkBack, 지도 공급자 키·한도, 가구 가격·리롤권 지급량, 발표 리허설(사람), 대회 최종 제출(소유자 승인 필요).
- 로컬 자동 시험, 서명된 빌드, 서버 배포, 다운로드, 실기 수용, 최종 제출은 각각 다른 증거로 기록한다.

## 11. 남은 이슈와 PR 확인

- #206의 전체 체험 수용과 #380·#394의 남은 범위는 실제 Issue 상태와 증거를 재확인한다. 과거 기록의 열린 PR 목록을 현재 목록으로 사용하지 않는다.
- PR 상태는 `gh pr list --state all` 및 개별 `gh pr view <번호> --json state,mergedAt,headRefOid`로 확인한다.
- [PR #402](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/402)(팀원 PragmoB, 뽑기 `CONSENT_REQUIRED`를 "동의 확인하기"로 연결)는 `a742e32d`로 병합됐다. 최신 main과 문서 충돌을 풀고 `INTERNAL_ERROR` 문구를 일반 재시도 안내로 바꾸고 동의 문구 연결을 시험으로 고정했으며 모바일 1,878/1,878·gate 통과, 독립 리뷰 승인이다. 공개 설치본·`/play/`에는 아직 없다. 남은 🟡: 개발용 DEMO 계정의 동의 화면 "로그아웃"이 DEMO 상태를 벗어나지 못함, 동의·미설정 거절 뒤 뽑기 대기 기록 유지(같은 요청 ID 복구).
- 재측정이 새로 본 낮은 결함 4건(이웃 방 하단 탭 두 벌 렌더링·탐색 선택 표시, 이웃 방→탐색 뒤 브라우저 뒤로 가기가 앱 밖으로 나감, 다크 꾸미기 "대표 수집 코인" 칩 흰색, 떠 있는 탭 바 아래 8px 틈)는 아직 고치지 않았다. [근거](evidence/submission-2026-10-08-recheck/README.md)

## 12. 다음 실행 명령

1. 이 문서 PR의 현재 요약·재측정 링크·영상 SHA-256을 검사하고 병합한다.
2. 다음 빌드에서 #402(상점 동의 오류 단추·문구)를 공개 설치본과 `/play/`에 반영한다. 새 Preview·test 번호와 게시는 이 문서가 정하지 않는다. 같은 빌드에서 낮은 결함 4건의 처리 여부를 정하고, 시연 `/play/` 번들을 바꾸면 5분 흐름을 다시 측정한다.
3. 실제 점주·이용자 현장 자료, 설치본 실기·TalkBack, 지도 공급자 키·한도, 가구 가격·리롤권 지급량, 발표 리허설은 소유자 판단·수동 항목이다.
4. 대회 최종 제출과 Google Play는 소유자 승인이 필요한 별도 경계다. 승인 전에는 제출 버전을 고정하지 않는다.

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
- braces·node-forge 의존성 보안 예외는 2026-10-31에 만료된다. 만료 전에 재검토한다.

## 14. 이력과 변경 규칙

- 2026-09-22부터 2026-10-07까지의 날짜별 인수인계 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 그대로 보존한다. 과거 기록의 “현재”, “열린 PR”, “다음 명령”은 작성 당시의 상태다.
- 다음 중단 전 이 14절의 기준 SHA·브랜치·PR·공개 버전·검증 상태·다음 명령만 실제 근거에 맞춰 갱신한다.
