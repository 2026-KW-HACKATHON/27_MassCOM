# HANDOFF

기준 시각: 2026-10-08 KST. 이 문서는 다음 작업의 현재 상태만 기록한다. 날짜별 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

## 1. 기준 커밋과 작업 위치

- 기준 main 커밋 SHA: `8b336ece`. 작업 브랜치: `fix/submission-readiness`.
- Issue #401 진행 중. 이 문서 변경은 아직 커밋·PR·배포 완료를 뜻하지 않는다. 같은 worktree의 다른 영역은 병렬 작업 중이다.

## 2. 현재 통합 상태

- PR #398과 #400은 병합됐다(2026-10-07 감사 기록 및 저장소 이력 기준). #398을 열린 PR로 적은 과거 전달은 [당시 기록](HANDOFF_HISTORY.md#2026-10-07-pr이슈-점검-전달-결과)이다.
- PR #396은 닫혔으나 main에 병합되지 않았다. 미병합 초안을 공개본 기능으로 계산하지 않는다.
- 재개 시 `git status -sb`, `git log -1 --oneline`, `gh pr list --state all`로 다시 대조한다.

## 3. 공개 서버와 설치본

- 마지막 기록된 공개 배포 소스는 `db280032`이며 두 DB의 migration 원장은 43건이다. [배포 증거](evidence/deployment-db28003-2026-10-05.json)를 따른다.
- 공개 운영 Android는 test.10, 시연 Android는 Preview 19다. 현재 작업 소스의 기능을 공개 설치본에서 수용했다고 기록하지 않는다.
- 두 DB 백업의 실제 복원은 `NOT_RUN`이다. 공개 서버의 현재 상태는 새 배포 전에 재확인한다.

## 4. 이번 작업의 범위

- [Issue #401](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/401)은 제출 전 운영·문서·심사 대응 정리다. 이 worktree의 코드·문서·시험 변경과 실제 공개 반영은 별도 상태로 추적한다.
- 앱/API 변경을 포함한 최종 통합 결과는 이 문서 작성 시점에 확정되지 않았다. 이 문서의 배포 내용은 실행 계획이다.

## 5. 시연 배포 순서

- 시연 전용 DB 복원 리허설과 0044~0067의 SQL 파일 25개 적용·재실행 검증을 먼저 기록한다. `0050_quality_game_records.sql`과 `0050_social_mail.sql`을 모두 포함한다.
- 같은 전환 창에서 시연 API와 `/play/` 웹 번들, Preview 20 APK, `/open` 안내를 준비·전환하고 공개 HTTPS와 실제 설치본의 동의·체험을 확인한다. 한 구성요소의 배포 성공을 전체 성공으로 표시하지 않는다.
- 정확한 순서와 실패 대응은 [운영 절차](OPERATIONS_RUNBOOK.md)를 따른다.

## 6. 운영 배포 조건

- 운영 DB의 실제 복원 리허설이 `PASS`일 때만 새 API와 test.11 APK 및 `/open` 안내를 같은 창에서 전환한다.
- 리허설이 실패하거나 증거가 없으면 운영 서버·DB·공개 설치본은 `db280032`/test.10 상태로 유지한다. 시연의 성공을 운영의 검증으로 대체하지 않는다.

## 7. 마이그레이션과 롤백 경계

- 새 원장에 거래가 기록된 뒤에는 이를 모르는 구 API로 자동 복귀하지 않는다. 이번 비호환 릴리스의 배포 증거는 `backward_compatible=no`로 기록하고 실패 시 쓰기를 멈춘 뒤 새 원장을 이해하는 버전으로 전진 복구한다.
- 릴리스 전후 백업·원장 수·쓰기 중지 조건은 [운영 절차](OPERATIONS_RUNBOOK.md)와 실제 복원 시험에서 검증한다.

## 8. 개인정보 재동의와 버전 결합

- 새 API의 개인정보 안내 버전은 `privacy-2026-10-07`이다. API만 먼저 공개하면 test.10/Preview 19의 동의 화면에서 `outdated`로 막힐 수 있다(`apps/mobile/src/privacy/consent-flow.ts`).
- 시연 API·웹 번들·Preview 20·`/open`, 이후 조건을 충족한 운영 API·test.11·`/open`을 각각 같은 창에서 맞춘다. 구 설치본의 재동의 확인을 별도 수용 항목으로 기록한다.

## 9. 자동 검증 상태

- 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN` ([시험 원장](TEST_STATUS.md), [제출 증거](SUBMISSION_EVIDENCE.json)).
- Issue #401 운영·문서 소유 범위의 회귀·구문·diff 검사는 PASS다. `bash tools/gate.sh`와 `bash tests/site/verify_evidence_consistency_test.sh`는 `evidence date drift`로 FAIL이다: 읽기 전용 `SUBMISSION_EVIDENCE.json`의 `recordedAt=2026-10-01 KST`가 별도 작업 영역 `docs/index.html`에 없다. 두 파일은 이 작업에서 수정하지 않았다. 메인 스레드 통합 후 다시 검사하고 [TEST_STATUS](TEST_STATUS.md)에 명령·환경·결과를 기록한다.
- `node --test tests/ops/verify_web_auth_rollback_test.mjs`는 전용 `_test` DB가 없어 0 PASS / 0 FAIL / 1 SKIP이며 실제 시험은 NOT_RUN이다. 실제 DB 복원·Docker 런타임 배포 실패 시험도 NOT_RUN이며 운영 전환 관문을 충족하지 않는다.
- 기본 재현: `bash tools/gate.sh`, `bash tests/bootstrap/verify_operations_docs_test.sh`, `bash tests/site/verify_evidence_consistency_test.sh`, `bash tests/ops/showcase_host_readiness_test.sh`.

## 10. 수동 수용과 미실행 항목

- 새 공개 API/웹·실제 Preview 20/test.11 설치·개인정보 재동의·점주 역할·운영 DB 복원·NFT 발행은 이 문서 갱신으로 `PASS`가 되지 않는다.
- 로컬 자동 시험, 서명된 빌드, 서버 배포, 다운로드, 실기 수용, 최종 제출은 각각 다른 증거로 기록한다.

## 11. 남은 이슈와 PR 확인

- #206의 전체 체험 수용과 #380·#394의 남은 범위는 실제 Issue 상태와 증거를 재확인한다. 과거 기록의 열린 PR 목록을 현재 목록으로 사용하지 않는다.
- PR 상태는 `gh pr list --state all` 및 개별 `gh pr view <번호> --json state,mergedAt,headRefOid`로 확인한다.

## 12. 다음 실행 명령

1. `git status -sb`와 `git log -1 --oneline`, `gh pr list --state all`로 작업·PR 상태를 복원한다.
2. `bash tests/bootstrap/verify_operations_docs_test.sh`와 `bash tools/gate.sh`를 실행하고 결과를 [TEST_STATUS](TEST_STATUS.md)에 기록한다.
3. 배포 전 두 DB의 복원 리허설·25개 migration·앱/웹 번들 출처·서명·동의 버전·공개 HTTPS 전환 조건을 [운영 절차](OPERATIONS_RUNBOOK.md)로 확인한다.

PR 제목·본문 검사:

```bash
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
bash tests/bootstrap/check_pr_korean_test.sh  # checker 자체 회귀 시험
```

## 13. 승인·보안 경계

- 운영 키 생성·메인넷·사용자 자산 이동·Google Play 공개·대회 최종 제출은 별도 승인 경계다. 개인키·복구 문구·비밀번호는 기록하지 않는다.
- 백업의 실제 복원과 데이터 보존을 확인하지 않은 운영 배포는 진행하지 않는다.

## 14. 이력과 변경 규칙

- 2026-09-22부터 2026-10-07까지의 날짜별 인수인계 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 그대로 보존한다. 과거 기록의 “현재”, “열린 PR”, “다음 명령”은 작성 당시의 상태다.
- 다음 중단 전 이 14절의 기준 SHA·브랜치·PR·공개 버전·검증 상태·다음 명령만 실제 근거에 맞춰 갱신한다.
