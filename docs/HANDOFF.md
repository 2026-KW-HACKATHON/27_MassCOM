# HANDOFF

마지막 갱신 시각: 2026-09-18 KST

기준 브랜치: `feat/19-one-time-claim-slot`

통합 기준 커밋 SHA: `main@e242c996b996dd01fa9b798c0376caedd4e8ed31`, 기능 코드 `6823119`

## 이번 세션에서 완료한 것

- GitHub `main`, 로그인 주체, remote, 최근 merge, 열린 Issue/PR, CI를 재확인
- PR #18 merge `e242c99`, Issue #17 종료, main CI run `35302502498` PASS 확인
- PostgreSQL `claim_slots` migration과 1인용 수령 슬롯 구현
- QR token은 SHA-256, 점포 주문 참조는 점포 범위 HMAC-SHA-256만 저장
- 발급·버전 잠금 재발급·본문 preview·대상 계정 단일 소비 API 구현
- 같은 `tokenVersion` 동시 재발급 2요청 중 성공 1건·충돌 1건 검증
- 동일 token 20개 동시 소비 성공 1건과 만료 경합 최종 상태 1개 검증
- Q02·Q03을 `PASS`로 갱신하고 방문 이벤트가 없는 Q01은 `NOT_RUN` 유지

## 생성한 Issue

- #19 `feat: 1인용 일회용 QR 슬롯 발급·재발급 기반 구현`

## 생성한 브랜치

- `feat/19-one-time-claim-slot`

## 생성한 PR

- #20 `feat: 1인용 일회용 QR 슬롯 기반 구현`(열림)

## merge된 PR

- #14, merge commit `a27d0d0`
- #16, merge commit `240dad2`
- #18, merge commit `e242c99`

## 실행한 테스트

- API 단위 테스트 25/25 `PASS`
- PostgreSQL 18 Alpine 실제 통합 테스트 3/3 `PASS`
- 동일 token 동시 20요청에서 소비 성공 1건 `PASS`
- 정확한 만료 시각 동시 20요청에서 `EXPIRED` 최종 상태 1개 `PASS`
- 재발급 후 이전 token 거절·slot 수 1 유지·동시 재발급 1건만 성공 `PASS`
- API typecheck·build·production audit `PASS`

## 현재 열린 PR

- #20, CI 확인 중

## 현재 작업 중인 기능

- Issue #19 1인용 일회용 QR 슬롯 기반

## BLOCKER

- 실제 Reown·MetaMask 실기는 project ID·설치 지갑 부족
- 외부 HTTPS·유료 AWS·공개 배포는 별도 승인 필요
- Phase 2 claim slot API 자체에는 현재 blocker 없음

## 사용자 승인이 필요한 사항

- PR #20 범위에는 없음
- 저장소 공개·유료 자원·테스트넷 전송·Play 배포·대회 제출은 계속 승인 필요

## 다음 세션이 가장 먼저 해야 할 작업

1. PR #20의 최신 CI와 보안 리뷰 결과 확인
2. CI PASS 후 PR #20 merge, Issue #19 종료 확인
3. main merge SHA와 CI run을 다음 기능 문서에 반영
4. 다음 기능은 별도 Issue로 claim slot 소비와 방문 이벤트·보상 평가를 한 트랜잭션으로 연결(Q01·R01·R03)

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
- Q02·Q03·Q05는 실제 PostgreSQL 증거로 PASS이며 Q01·Q04·R01~R03은 계속 NOT_RUN
- token·점포 주문 참조 원문을 DB나 로그에 남기지 않고 운영 HMAC 비밀값을 저장소에 커밋하지 않음
- Google 로그인과 점주 웹을 구현했다고 표시하지 않음
- Phase 1 외부 지갑 실기를 완료로 과장하지 않음
- 개인 private mirror는 사용자가 나중에 요청할 때만 생성
