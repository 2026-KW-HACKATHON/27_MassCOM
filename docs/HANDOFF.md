# HANDOFF

마지막 갱신 시각: 2026-09-18 KST

기준 브랜치: `test/23-android-device`

통합 기준 커밋 SHA: `main@158067cf349d69bf7e1fdb3fa11e2dbcff8d7c0c`, main CI run `35306108718` PASS

## 이번 세션에서 완료한 것

- PR #22 merge `158067c`, Issue #21 종료, main CI run `35306108718` PASS 확인
- Issue #23과 `test/23-android-device` 생성
- Samsung SM-S928N / Android 16 실기기에서 현재 main 기반 debug APK 새 빌드·설치
- `adb reverse`로 로컬 Metro·API만 연결하고 설정 필요 화면 렌더링
- 홈 전환·앱 복귀와 프로세스 종료 후 development-client URL 콜드 스타트 검증
- 공식 Play 패키지 `io.metamask` 8.11.0 설치·첫 화면 실행
- 지갑 생성·가져오기·이용약관 동의·개인키·복구 문구 처리는 수행하지 않음
- W06을 실기 시도 근거에 따라 `BLOCKED`로 갱신하고 증거 JSON·스크린샷 저장

## 생성한 Issue

- #23 `test: 실제 Android 기기에서 Phase 1 앱을 검증한다`

## 생성한 브랜치

- `test/23-android-device`

## 현재 열린 PR

- #24 `test: 실제 Android 기기 Phase 1 검증 증거를 기록한다`

## merge된 PR

- #14, merge commit `a27d0d0`
- #16, merge commit `240dad2`
- #18, merge commit `e242c99`
- #20, merge commit `c2f3076`
- #22, merge commit `158067c`

## 실행한 테스트

- Android Gradle `assembleDebug`: 816 tasks, `BUILD SUCCESSFUL`
- Samsung SM-S928N streamed APK install `PASS`
- Metro Android bundle 2,185 modules `PASS`
- 설정 필요 화면 렌더링·fatal error 없음 `PASS`
- 홈 전환·같은 프로세스 복귀 `PASS`
- 프로세스 종료·정상 development-client URL 콜드 스타트 `PASS`
- MetaMask 8.11.0 설치·첫 화면 실행 `PASS`
- WalletConnect 연결·서명·지갑 복귀: Reown project ID와 초기화된 사용자 지갑 부재로 `BLOCKED`

## 현재 작업 중인 기능

- Issue #23 실제 Android 기기 검증 증거·상태 문서 반영

## BLOCKER

- MetaMask 앱은 설치됐지만 실제 Reown 연결·서명은 project ID와 사용자가 초기화·잠금 해제한 지갑이 없어 BLOCKED
- 외부 HTTPS·유료 AWS·공개 배포는 별도 승인 필요
- GitHub Pages는 현재 꺼져 있고 private 저장소의 조직 요금제·공개 정책 확인 및 공개 승인 필요
- Issue #23의 설치·실행 증거 반영에는 blocker 없음

## 사용자 승인이 필요한 사항

- 현재 증거 PR 범위에는 없음
- Reown project ID 발급·계정 연결과 사용자 지갑 초기화는 자격증명·사용자 자산 경계라 자동 수행하지 않음
- 저장소/포털 공개·유료 자원·테스트넷 전송·Play 배포·대회 제출은 계속 승인 필요

## 다음 세션이 가장 먼저 해야 할 작업

1. PR #24 CI와 증거 문서 리뷰를 확인하고 PASS 후 merge
2. Reown project ID가 준비되면 MetaMask에서 사용자가 직접 지갑을 초기화·잠금 해제한 뒤 W01·W04·W06 실기
3. 다음 독립 기능은 방문 도감/앱 수집품 조회 또는 방문 취소·오입력 처리
4. 프로젝트 포털 원격 호스팅은 별도 Issue/PR로 배포 준비 후 실제 공개만 승인 대기

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
- Phase 1 외부 지갑 실기를 완료로 과장하지 않음
- 실제 Android 기기 일련번호·개인 앱 목록·지갑 비밀은 저장소에 기록하지 않음
- 개인 private mirror는 사용자가 나중에 요청할 때만 생성
