# HANDOFF

기준 시각: 2026-10-08 KST. 이 문서는 다음 작업의 현재 상태만 기록한다. 날짜별 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 보존했다. 문서보다 실제 Git·PR·서버·설치본 상태가 우선한다.

## 1. 기준 커밋과 작업 위치

- 기준 main 커밋 SHA: `2d483ed8645151b502253ac35860b3546e3473c5`(PR #403 병합, 트리 `74e47887c1c56da255271cdf1651f1f14c9044a3`와 동일). 현재 문서 worktree는 `docs/submission-1008-deploy`다.
- 시연 배포와 두 Android Release 게시는 완료했다. 운영 서버 배포는 이 문서 PR 병합 직후 진행 예정이며 결과는 후속 기록한다.

## 2. 현재 통합 상태

- PR #398과 #400은 병합됐다(2026-10-07 감사 기록 및 저장소 이력 기준). #403도 main `2d483ed8`로 병합됐다. #398을 열린 PR로 적은 과거 전달은 [당시 기록](HANDOFF_HISTORY.md#2026-10-07-pr이슈-점검-전달-결과)이다.
- PR #396은 닫혔으나 main에 병합되지 않았다. 미병합 초안을 공개본 기능으로 계산하지 않는다.
- 재개 시 `git status -sb`, `git log -1 --oneline`, `gh pr list --state all`로 다시 대조한다.

## 3. 공개 서버와 설치본

- 시연 서버는 main `2d483ed8`의 API와 트리 `74e47887`의 `/play/` 웹 번들로 배포 완료했다. 시연 DB 원장은 43→68건(마지막 `0067_room_guestbook.sql`), 공개 `demo-api /health`·`/play/`·가상 점포 collectible-preview 200, `/coin-shop` 401(인증 필요)이다. [시연 배포 증거](evidence/showcase-deployment-2d483ed-2026-10-08.json)를 따른다.
- 운영 API·DB는 아직 새 소스로 배포하지 않았다. 기존 `api.masscom.kr/health`·`www`·`/app/` 200을 확인했으며, 운영 배포는 진행 중이다.
- 운영 Android test.11과 시연 Android Preview 20을 게시해 익명 다운로드 해시가 일치했다([운영](evidence/operating-android-test11-2026-10-08.json), [시연](evidence/showcase-preview20-release-2026-10-08.json)). 실제 설치·실기 수용은 별도다. 시연 서버·설치본에는 지도 키가 없어 목록 기반 탐색으로 동작한다.
- 시연·운영 서버 안 실제 DB 복원 리허설이 각각 PASS다. 운영은 첫 실제 복원 증거(P03)이며 복제본 migration 43→68건·`account_consents` 5=5 보존 후 복제본·임시 dump를 삭제했다([운영 리허설](evidence/production-restore-rehearsal-2026-10-08.json)).

## 4. 이번 작업의 범위

- [Issue #401](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/401)은 제출 전 운영·문서·심사 대응 정리다. 이 worktree의 코드·문서·시험 변경과 실제 공개 반영은 별도 상태로 추적한다.
- 서버·모바일·웹·첫인상·운영 결함 수정과 심사 대응 문서 정리 뒤 시연 배포와 두 Android 게시가 완료됐다. 구현·검증은 [PROJECT_STATE](PROJECT_STATE.md)와 [TEST_STATUS](TEST_STATUS.md)를 따른다. 아래 시연 순서는 완료 이력이며 운영 전환은 계획이다.

## 5. 시연 배포 순서

- 시연 전용 DB 복원 리허설 PASS(107개 테이블 행 수·migration 목록 일치), 배포 전 백업, 25개 migration 적용으로 원장 68건을 기록했다. API·`/play/` 공개 전환과 Preview 20 게시도 완료했다.
- `/open` 안내는 이 문서 PR에서 갱신한다. 공개 HTTPS 일부 probe와 APK 다운로드 해시는 확인했으나 실제 설치본의 동의·체험 수용은 후속 확인으로 남긴다.
- 정확한 순서와 실패 대응은 [운영 절차](OPERATIONS_RUNBOOK.md)를 따른다.

## 6. 운영 배포 조건

- 운영 DB 실데이터의 서버 안 실제 복원과 복제본 migration 리허설은 PASS다. 원본 107개 테이블 행 수, 복제본 43→68건·1.8초, `account_consents` 5=5·공개 점포 0을 확인했다. 이 증거로 P03 복원 관문을 충족했다.
- 운영 서버 전환은 문서 PR 병합 직후 `backward_compatible=no` 증거와 `scripts/deploy-lightsail.sh --deploy`로 진행 예정이다. test.11은 이미 게시됐고 `/open` 안내는 이 PR에서 갱신한다. 운영 배포 완료로 기록하지 않는다.

## 7. 마이그레이션과 롤백 경계

- 새 원장에 거래가 기록된 뒤에는 이를 모르는 구 API로 자동 복귀하지 않는다. 이번 비호환 릴리스의 배포 증거는 `backward_compatible=no`로 기록하고 실패 시 쓰기를 멈춘 뒤 새 원장을 이해하는 버전으로 전진 복구한다.
- 릴리스 전후 백업·원장 수·쓰기 중지 조건은 [운영 절차](OPERATIONS_RUNBOOK.md)와 실제 복원 시험에서 검증한다.

## 8. 개인정보 재동의와 버전 결합

- 새 API의 개인정보 안내 버전은 `privacy-2026-10-07`이다. API만 먼저 공개하면 test.10/Preview 19의 동의 화면에서 `outdated`로 막힐 수 있다(`apps/mobile/src/privacy/consent-flow.ts`).
- 시연 API·웹 번들·Preview 20이 공개됐고 `/open`은 이 PR에서 갱신한다. 운영 API와 `/open`의 정책 버전 일치는 운영 배포 후 확인한다. 구 설치본의 재동의 확인은 별도 수용 항목이다.

## 9. 자동 검증 상태

- 필수 36개 상태: `31 PASS / 2 BLOCKED / 3 NOT_RUN` ([시험 원장](TEST_STATUS.md), [제출 증거](SUBMISSION_EVIDENCE.json)).
- Issue #401 구현 브랜치 `fix/submission-readiness`의 당시 검사: API 단위 567/567·PostgreSQL 524 PASS/3 SKIP(전용 55435 hosted seed 컨테이너 조건), API typecheck·build, 모바일 1,872/1,872·typecheck·lint·운영/시연 Android export·variant 자산·접근성 의미 PASS.
- 해당 브랜치의 사이트·운영 시험(로컬 restore drill 실DB 포함)·`bash tools/gate.sh` PASS. 이번 운영 서버 실데이터 복원·migration 리허설은 별도 [P03 증거](evidence/production-restore-rehearsal-2026-10-08.json)로 기록한다.
- Issue #401의 당시 로컬 검사 결과이며 PR #403은 병합됐다. 이번 문서 worktree의 gate·운영 문서·세 readiness·포털·접근성·증거 정합 검사와 legal/public-entry 14/14는 PASS다. [TEST_STATUS](TEST_STATUS.md)에 명령·환경·첫 실패 후 수정 경위를 별도로 기록했다.
- 기본 재현: `bash tools/gate.sh`, `bash tests/bootstrap/verify_operations_docs_test.sh`, `bash tests/site/verify_evidence_consistency_test.sh`, `bash tests/ops/showcase_host_readiness_test.sh`.

## 10. 수동 수용과 미실행 항목

- 실제 Preview 20/test.11 설치·개인정보 재동의·점주 역할·NFT 발행은 이 문서 갱신으로 `PASS`가 되지 않는다. 운영 DB 복원 리허설은 별도 서버 증거로 PASS이고 운영 배포 결과는 아직 없다.
- 로컬 자동 시험, 서명된 빌드, 서버 배포, 다운로드, 실기 수용, 최종 제출은 각각 다른 증거로 기록한다.

## 11. 남은 이슈와 PR 확인

- #206의 전체 체험 수용과 #380·#394의 남은 범위는 실제 Issue 상태와 증거를 재확인한다. 과거 기록의 열린 PR 목록을 현재 목록으로 사용하지 않는다.
- PR 상태는 `gh pr list --state all` 및 개별 `gh pr view <번호> --json state,mergedAt,headRefOid`로 확인한다.

## 12. 다음 실행 명령

1. 이 문서 PR의 `/open` 링크·증거 JSON·현재 요약을 검사하고 병합한다.
2. 병합 커밋과 `backward_compatible=no` 증거로 `scripts/deploy-lightsail.sh --deploy`를 실행하고 운영 migration·API·retention·HTTPS 결과를 별도 기록한다.
3. 운영 API·test.11·`/open`의 개인정보 버전 일치와 실제 설치·재동의·탐색을 확인한다. Google Play·최종 제출은 별도 승인 경계다.

PR 제목·본문 검사:

```bash
PR_TITLE='한국어 PR 제목'
PR_BODY='변경 내용과 실제 검증 결과를 설명하는 한국어 본문'
bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"
bash tests/bootstrap/check_pr_korean_test.sh  # checker 자체 회귀 시험
```

## 13. 승인·보안 경계

- 운영 키 생성·메인넷·사용자 자산 이동·Google Play 공개·대회 최종 제출은 별도 승인 경계다. 개인키·복구 문구·비밀번호는 기록하지 않는다.
- 운영 DB 첫 실제 복원과 복제본 데이터 보존은 PASS다. 배포 전 새 백업과 실제 배포 결과는 별도 확인한다.

## 14. 이력과 변경 규칙

- 2026-09-22부터 2026-10-07까지의 날짜별 인수인계 원문은 [HANDOFF_HISTORY](HANDOFF_HISTORY.md)에 그대로 보존한다. 과거 기록의 “현재”, “열린 PR”, “다음 명령”은 작성 당시의 상태다.
- 다음 중단 전 이 14절의 기준 SHA·브랜치·PR·공개 버전·검증 상태·다음 명령만 실제 근거에 맞춰 갱신한다.
