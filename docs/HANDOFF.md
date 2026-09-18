# HANDOFF

마지막 갱신 시각: 2026-09-18 KST

기준 브랜치: `feat/21-visit-rewards`

통합 기준 커밋 SHA: `main@c2f3076fbb7257fbfb77ed69edff3b3fef8ac84b`, 기능 코드 `3eb9e5a`

## 이번 세션에서 완료한 것

- PR #20 merge `c2f3076`, Issue #19 종료, main CI run `35304829656` PASS 확인
- PR #20 리뷰의 주문 참조 HMAC·동시 재발급·실제 비밀값 스캔·API 환경 예시를 모두 수정
- Issue #21과 `feat/21-visit-rewards` 생성
- PostgreSQL `visit_events`·`reward_entitlements` migration 구현
- claim slot 소비·방문 이벤트·한국 날짜 진행도·첫/3/5회 고정 보상권을 한 트랜잭션으로 처리
- 같은 QR 20개 동시 요청에서 슬롯·방문·첫 보상권 효과 각 1건 검증
- `Asia/Seoul` 날짜 경계와 같은 날짜 중복 방문의 진행도 미증가 검증
- 같은 계정·캠페인·목표 보상권 중복 방지와 캠페인 부재 시 전체 롤백 검증
- Q01·R01·R03을 실제 PostgreSQL 근거로 `PASS` 갱신

## 생성한 Issue

- #21 `feat: 방문 이벤트와 고정 보상권을 원자적으로 확정`

## 생성한 브랜치

- `feat/21-visit-rewards`

## 현재 열린 PR

- 생성 전

## merge된 PR

- #14, merge commit `a27d0d0`
- #16, merge commit `240dad2`
- #18, merge commit `e242c99`
- #20, merge commit `c2f3076`

## 실행한 테스트

- API 단위 테스트 25/25 `PASS`
- PostgreSQL 18 Alpine 실제 통합 테스트 4/4 `PASS`
- Q01 동일 token 동시 20요청에서 claim·방문·보상 성공 1건 `PASS`
- R01 UTC `14:59:59.999`/`15:00:00` KST 날짜 경계와 일일 진행 최대 1회 `PASS`
- R03 첫/3/5회 보상권 각각 한 건, 반복 평가 후 총 3건 유지 `PASS`
- 활성 캠페인 부재 시 claim slot `ISSUED` 유지·방문/보상 미생성 `PASS`
- API typecheck·build·production audit `PASS`

## 현재 작업 중인 기능

- Issue #21 방문 이벤트·고정 보상권 원자 처리

## BLOCKER

- 실제 Reown·MetaMask 실기는 project ID·설치 지갑 부족
- 외부 HTTPS·유료 AWS·공개 배포는 별도 승인 필요
- GitHub Pages는 현재 꺼져 있고 private 저장소의 조직 요금제·공개 정책 확인 및 공개 승인 필요
- Issue #21 구현 자체에는 현재 blocker 없음

## 사용자 승인이 필요한 사항

- Issue #21 범위에는 없음
- 저장소/포털 공개·유료 자원·테스트넷 전송·Play 배포·대회 제출은 계속 승인 필요

## 다음 세션이 가장 먼저 해야 할 작업

1. 기능·문서 커밋 push 후 Issue #21을 닫는 한국어 PR 생성
2. 원격 CI와 독립 보안·동시성 리뷰 확인
3. CI PASS와 HIGH/MEDIUM 0 확인 후 merge
4. 다음 독립 기능은 방문 도감/앱 수집품 조회 또는 방문 취소·오입력 처리
5. 프로젝트 포털 원격 호스팅은 별도 Issue/PR로 배포 준비 후 실제 공개만 승인 대기

## 실행 명령

```bash
npm test --prefix apps/api
npm run typecheck --prefix apps/api
npm run build --prefix apps/api
bash scripts/check-secrets.sh
bash tests/bootstrap/check_secrets_test.sh
bash tests/bootstrap/check_pr_korean_test.sh
bash tests/bootstrap/verify_bootstrap_test.sh
```

PostgreSQL 통합은 DB 이름이 `_test`로 끝나는 전용 `TEST_DATABASE_URL`을 지정하고 `npm run test:postgres --prefix apps/api`를 실행합니다.

## 주의사항

- 실제 협약 점포 seed를 만들지 말고 테스트 fixture는 `demo: true`로 유지
- Q01·Q02·Q03·Q05·R01·R03은 실제 PostgreSQL 증거로 PASS이며 Q04·R02는 계속 NOT_RUN
- 정확한 식사 시각은 서비스 DB 감사 자료일 뿐 온체인·IPFS·공개 메타데이터에 넣지 않음
- 방문 취소·도감 조회·Android QR 카메라를 구현 완료로 표시하지 않음
- Phase 1 외부 지갑 실기를 완료로 과장하지 않음
- 개인 private mirror는 사용자가 나중에 요청할 때만 생성
