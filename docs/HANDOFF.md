# HANDOFF

마지막 갱신 시각: 2026-09-18 KST

기준 브랜치: `feat/17-merchant-access`

통합 기준 커밋 SHA: `main@240dad291e3dbb2f671ee36e130c13f21edd02e0`, 기능 코드 `1549938`

## 이번 세션에서 완료한 것

- GitHub `main`, 로그인 주체, remote, 최근 merge, 열린 Issue/PR, CI를 재확인
- 최신 main `240dad2`, 열린 Issue·PR, main CI run `35300586559` PASS 재확인
- PostgreSQL `merchant_members` migration과 `OWNER`·`STAFF` 권한 경계 구현
- 점주 context API에서 다른 점포·무소속·철회 계정을 같은 403으로 거절
- 권한을 매 요청 조회해 같은 서버 세션에서도 철회를 즉시 반영
- Q05 PostgreSQL 18 통합 시험을 `PASS`로 갱신

## 생성한 Issue

- #17 `feat: 점포별 점주·직원 권한 경계 구현`

## 생성한 브랜치

- `feat/17-merchant-access`

## 생성한 PR

- #18 `feat: 점포별 점주·직원 권한 경계 구현`(열림)

## merge된 PR

- #14, merge commit `a27d0d0`
- #16, merge commit `240dad2`

## 실행한 테스트

- API 단위 테스트 19/19 `PASS`
- PostgreSQL 18 Alpine 실제 통합 테스트 2/2 `PASS`(카탈로그·Q05)
- 다른 점포·무소속·철회 계정 조회와 `CONFIRM_VISIT` 권한 거절 `PASS`
- 같은 서버 세션에서 멤버십 철회 즉시 반영 `PASS`
- API typecheck·build `PASS`

## 현재 열린 PR

- #18, CI 확인 중

## 현재 작업 중인 기능

- Issue #17 점포별 점주·직원 권한 경계

## BLOCKER

- 실제 Reown·MetaMask 실기는 project ID·설치 지갑 부족
- 외부 HTTPS·유료 AWS·공개 배포는 별도 승인 필요
- Phase 2 권한 API 자체에는 현재 blocker 없음

## 사용자 승인이 필요한 사항

- PR #18 범위에는 없음
- 저장소 공개·유료 자원·테스트넷 전송·Play 배포·대회 제출은 계속 승인 필요

## 다음 세션이 가장 먼저 해야 할 작업

1. PR #18의 최신 CI와 리뷰 조건 확인
2. CI PASS 후 PR #18 merge, Issue #17 종료 확인
3. main merge SHA와 CI run을 상태 문서에 동기화
4. 다음 기능은 별도 Issue로 일회용 QR 발급·재발급 경계(Q01~Q03)를 시작

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
- Q05만 실제 PostgreSQL 증거로 PASS이며 Q01~Q04·R01~R03은 계속 NOT_RUN
- Google 로그인과 점주 웹을 구현했다고 표시하지 않음
- Phase 1 외부 지갑 실기를 완료로 과장하지 않음
- 개인 private mirror는 사용자가 나중에 요청할 때만 생성
