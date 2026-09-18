# HANDOFF

마지막 갱신 시각: 2026-09-18 KST

기준 브랜치: `test/25-wallet-device`

통합 기준 커밋 SHA: `main@f85234f9d7d69d920fb5e942a5706b6d1611945f`, main CI run `35309692169` PASS

## 이번 세션에서 완료한 것

- PR #24 merge `f85234f`, Issue #23 종료, main CI run `35309692169` PASS 확인
- Issue #25와 `test/25-wallet-device` 생성
- Reown project ID와 사용자가 준비·잠금 해제한 MetaMask로 WalletConnect 연결 승인
- 승인된 Mainnet 세션을 `CONNECTED / CHECK_REQUIRED`로 표시하고 Base Sepolia 전환 경로 복구
- MetaMask에 사용자 승인으로 Base Sepolia 공개 네트워크를 추가하고 체인 승인
- 읽을 수 있는 `personal_sign`만 요청해 서버 주소 확인 `VERIFIED`
- 프로세스 종료 후 세션은 복원되고 주소 확인은 `UNVERIFIED`로 초기화됨을 확인
- UniversalProvider 2.21.10 초기 체인 이벤트 경쟁을 재현하고 2.23.5 override 회귀 테스트 추가
- WalletConnect JSON 문자열형 code 4001 사용자 거절 정규화 자동화 추가
- 코드 커밋 `ecba181` 생성

## 생성한 Issue

- #25 `test: 실제 MetaMask 연결과 주소 확인 서명을 검증한다`

## 생성한 브랜치

- `test/25-wallet-device`

## 현재 열린 PR

- 없음(문서 커밋·검증 후 생성)

## merge된 PR

- #14, merge commit `a27d0d0`
- #16, merge commit `240dad2`
- #18, merge commit `e242c99`
- #20, merge commit `c2f3076`
- #22, merge commit `158067c`
- #24, merge commit `f85234f`

## 실행한 테스트

- 모바일 테스트 18/18, typecheck, lint `PASS`
- Expo doctor 21/21, Android export 2,216 modules `PASS`
- npm audit high 기준 `PASS`; 기존 moderate 14·low 1 유지
- MetaMask 8.11.0 WalletConnect 연결 `PASS`
- Base Sepolia 네트워크 추가·승인·앱 복귀 `PASS`
- 읽을 수 있는 `personal_sign`과 서버 주소 확인 `VERIFIED` `PASS`
- 프로세스 종료 뒤 WalletConnect 세션 복원 `PASS`
- 서명 거절 실제 응답 code 4001 관측, 수정 회귀 자동화 `PASS`; 수정 후 실기 재확인은 MetaMask 자동 잠금으로 대기

## 현재 작업 중인 기능

- Issue #25 실기 증거·상태 문서 반영과 수정 후 거절 안내 재확인

## BLOCKER

- 외부 HTTPS·유료 AWS·공개 배포는 별도 승인 필요
- GitHub Pages는 현재 꺼져 있고 private 저장소의 조직 요금제·공개 정책 확인 및 공개 승인 필요
- 수정 후 MetaMask 거절 안내 재확인에는 사용자의 지갑 잠금 해제가 필요

## 사용자 승인이 필요한 사항

- 현재 Phase 1 코드·증거 PR 범위에는 없음
- 저장소/포털 공개·유료 자원·테스트넷 전송·Play 배포·대회 제출은 계속 승인 필요

## 다음 세션이 가장 먼저 해야 할 작업

1. 사용자가 MetaMask를 잠금 해제하면 수정 후 서명 거절 안내를 실제 기기에서 한 번 재확인
2. 전체 검증과 비밀 검사를 실행하고 문서 커밋·push
3. 한국어 PR을 생성해 CI·리뷰를 확인한 뒤 merge하고 Issue #25 종료
4. Phase 1 잔여 W04 주소 변경·W05 미지원 지갑·W06 미설치/복귀 실패는 실행 환경을 갖춘 별도 증거로 남김

## 실행 명령

```bash
npm test --prefix apps/api
npm run typecheck --prefix apps/api
npm run build --prefix apps/api
npm test --prefix apps/mobile
npm run typecheck --prefix apps/mobile
npm run lint --prefix apps/mobile
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
- Phase 1 핵심 외부 지갑 흐름과 잔여 W04·W05·W06 예외를 구분함
- 실제 Android 기기 일련번호·개인 앱 목록·지갑 비밀은 저장소에 기록하지 않음
- 개인 private mirror는 사용자가 나중에 요청할 때만 생성
