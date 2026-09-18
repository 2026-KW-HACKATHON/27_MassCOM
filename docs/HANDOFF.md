# HANDOFF

마지막 갱신 시각: 2026-09-18 KST

기준 브랜치: `feat/merchant-catalog`

기능 기준 커밋 SHA: `4066b95` + CI 증거 문서 작업 트리

## 이번 세션에서 완료한 것

- GitHub `main`, 로그인 주체, remote, 최근 merge, 열린 Issue/PR, CI를 재확인
- Phase 2 재개 결정을 D-015로 기록
- `GET /merchants` 공개 API 경계 구현
- PostgreSQL `merchants`·`campaigns`·`campaign_goals` migration 구현
- 활성 점포와 공개·현재 캠페인만 반환하고 정원 마감을 구분하는 repository 구현
- `PROJECT_STATE.md`·`TEST_STATUS.md`를 세션 복원 정본으로 전환

## 생성한 Issue

- #13 `feat: 지갑 없이 조회 가능한 점포·캠페인 API 구현`

## 생성한 브랜치

- `feat/merchant-catalog`

## 생성한 PR

- #14 `feat: 지갑 없이 조회하는 점포·캠페인 API 구현`

## merge된 PR

- 이번 세션 없음
- 최근 merge: #12, `b634eee`

## 실행한 테스트

- API 단위 테스트 16/16 `PASS`
- PostgreSQL 18 Alpine 실제 통합 테스트 1/1 `PASS`(로컬 Docker·PR #14 CI run `35299748690`)
- migration 두 번 연속 실행 `PASS`
- API typecheck·build·production audit `PASS`
- bootstrap 정본 누락 회귀 테스트 `PASS`

## 현재 열린 PR

- #14, 전체 CI PASS, merge 전 최종 증거 문서 반영 중

## 현재 작업 중인 기능

- Issue #13 점포·캠페인 공개 카탈로그 PR 준비

## BLOCKER

- 실제 Reown·MetaMask 실기는 project ID·설치 지갑 부족
- 외부 HTTPS·유료 AWS·공개 배포는 별도 승인 필요
- Phase 2 카탈로그 자체에는 현재 blocker 없음

## 사용자 승인이 필요한 사항

- 현재 PR 범위에는 없음
- 저장소 공개·유료 자원·테스트넷 전송·Play 배포·대회 제출은 계속 승인 필요

## 다음 세션이 가장 먼저 해야 할 작업

1. `git status`와 Issue #13/열린 PR을 확인
2. PR이 없으면 전체 회귀 후 커밋·push·한글 PR 생성
3. CI PASS와 필수 리뷰 조건을 확인한 뒤 merge
4. merge 상태를 `PROJECT_STATE.md`와 이 문서에 동기화

## 실행 명령

```bash
npm test --prefix apps/api
npm run typecheck --prefix apps/api
npm run build --prefix apps/api
bash tests/bootstrap/check_secrets_test.sh
bash tests/bootstrap/check_pr_korean_test.sh
bash tests/bootstrap/verify_bootstrap_test.sh
```

PostgreSQL 통합은 실제 DB에 `TEST_DATABASE_URL`을 지정하고 `npm run test:postgres --prefix apps/api`를 실행합니다.

## 주의사항

- 실제 협약 점포 seed를 만들지 말고 테스트 fixture는 `demo: true`로 유지
- Q01~Q05·R01~R03은 이번 카탈로그 PR로 PASS 처리하지 않음
- Phase 1 외부 지갑 실기를 완료로 과장하지 않음
- 개인 private mirror는 사용자가 나중에 요청할 때만 생성
