# Android·Google Play 출시 준비 체크리스트

마지막 공식 근거 확인: 2026-09-19 KST

| 항목 | 현재 상태 | 완료 조건 |
| --- | --- | --- |
| 운영 package ID | `DECIDED` D-022 | `kr.masscom.wolgye` 적용(`APP_VARIANT=production`). 2026-09-30 이후 Console package 등록 상태는 소유자가 확인 |
| 서명 AAB | `VERIFIED` 자동 gate·실기 | commit `f13a283` 운영 AAB의 승인 인증서·package·source marker·W08·hash PASS. Samsung 4KB와 Android 36 16KB AVD에서 설치·콜드 실행·foreground·FATAL 0 PASS |
| upload key | `VERIFIED` 로컬 서명 | 저장소 밖 PKCS12 권한 `0600`, 별칭·승인 SHA-256 대조와 실제 AAB 서명 PASS. 비밀번호·keystore는 저장소와 provenance에 없으며 Play App Signing 인증서와는 다름 |
| 16KB page size | `VERIFIED` 정적·runtime | 64비트 각 29개 라이브러리/87 LOAD 최소 `0x4000`, 미달 0. Android 36 ps16k arm64 AVD에서 page size `16384`, 설치·cold 2345ms·FATAL 0 PASS |
| App Links | `VERIFIED` 직접 설치본 | `masscom.kr/open`만 autoVerify, upload 인증서 assetlinks HTTPS 200·무리디렉션. Samsung 4KB·Android 36 16KB에서 domain `verified`와 앱 cold 복귀 PASS; `/privacy`는 앱 미매칭. Play App Signing 인증서는 Play 단계에서 추가 |
| 지갑 승인 화면 출처 | `IN_PROGRESS` | PR #134 메타데이터와 공개 HTTPS 아이콘 URL은 검증. 개발 앱 MetaMask 재연결은 기기 지갑 잠금으로 `BLOCKED`; 운영 package의 새 APK·실제 승인 화면과 자동 복귀는 `NOT_RUN`. 기존 test.2 APK에는 변경 전 메타데이터가 남음([증거](evidence/domain-wallet-origin-2026-09-23.json)) |
| 계정 삭제 앱 경로 | `VERIFIED` Local DEMO | 운영 재인증·실제 계정으로 동일 처리 검증 |
| 외부 삭제 웹 경로 | `VERIFIED` | `https://masscom.kr/account-deletion` HTTPS 200과 삭제·보존·지갑 비밀 경고 확인. 현재 웹 경로는 수동 요청 접수이며 자동 삭제로 표현하지 않음 |
| Console 제출 초안 | `DRAFT` | `docs/PLAY_CONSOLE_DRAFT.md`의 초안을 소유자가 Console 문항과 대조해 확정 |
| Data safety | `IN_PROGRESS` | 실제 로그인·Reown relay·RPC·서버·분석 전송과 일치하게 Console 제출 |
| 금융 기능 선언 | `NOT_RUN` | 실제 NFT 보상 기능 기준으로 Console 항목 확인, 자동으로 “없음” 선택 금지 |
| 콘텐츠 등급·연령 | `NOT_RUN` | 실제 디자인·NFT·지역 상권 기능 기준 응답 |
| 심사 접근 | `PLANNED` | 실제 구매 없이 재현 가능한 시연 계정·DEMO 점포·안전한 QR·테스트넷 표기 |
| 폐쇄 테스트 | `NOT_RUN` | 계정 적용 여부 확인, 필요한 경우 실제 12명 연속 14일과 피드백 기록 |
| Play 업로드·공개 | `BLOCKED` | 사용자 명시 승인과 모든 사전 조건 충족 |

## Release artifact와 provenance

`scripts/build-release-aab.sh [--restore-dev]`는 기본 `apps/mobile/release-artifacts/` 또는 운영자가 지정한 `RELEASE_ARTIFACT_DIR`에 `app-release-<short-sha>.aab`와 `app-release-<short-sha>.provenance.json`을 한 쌍으로 보존합니다. provenance에는 다음 공개 증거만 들어갑니다.

- artifact basename·SHA-256·byte 크기
- source commit·모바일 경로 dirty 여부 (`source.mobileDirty`); 전체 Git worktree clean은 production 생성 조건으로 별도 강제
- signed AAB manifest의 `kr.masscom.BUILD_SOURCE_COMMIT` 값과 source commit 일치 여부
- source가 기대한 Android package/version과 W08이 AAB에서 확인한 package
- signature와 W08의 `PASS`/`FAIL`, exit code, upload 인증서 공개 SHA-256
- `releaseReadiness.status`와 남은 A02 설치·App Links·Play upload/review gate
- 생성 시각

keystore 경로·비밀번호·개인키는 provenance 대상이 아닙니다. 현재 schema는 artifact 절대 경로가 아닌 basename만 저장합니다. provenance에 개인 로컬 filesystem 경로가 드러나면 그 파일을 커밋하지 말고 생성 경로를 점검합니다. 기본 `apps/mobile/release-artifacts/`만 저장소에서 gitignored입니다. 사용자 지정 `RELEASE_ARTIFACT_DIR`는 자동으로 ignore되지 않으므로 운영자가 접근 권한·ignore·보존 정책을 책임집니다.

production build는 시작 전, Gradle 직후, 자동 gate 직후, publish 직전에 같은 HEAD와 clean worktree를 요구합니다. 캡처한 공개 Git SHA는 local Expo config plugin이 AAB manifest에 기록하며, assessor는 Google 공식 bundletool로 artifact marker를 읽어 현재 HEAD·provenance source commit과 같지 않으면 자동 gate를 실패시킵니다. development build에는 marker가 필요하지 않습니다.

자동 gate가 exit `N`으로 실패하면 두 파일은 삭제되지 않고 `app-release-<short-sha>.NOT-RELEASE-READY-exitN.aab`와 같은 basename의 `.provenance.json`으로 함께 이동합니다. 이 이름은 자동 판단 실패를 뜻할 뿐 Play의 최종 심사 판단이 아닙니다.

동일 commit의 accepted/rejected 최종 파일이 이미 있으면 script는 기존 증거를 덮지 않고 prebuild 전에 중단합니다. 기존 파일을 검토·보관하거나 비어 있는 별도 artifact 디렉터리를 지정한 뒤 다시 실행합니다.

증거 단계는 다음처럼 구분합니다.

1. Gradle build 성공은 AAB가 생성됐다는 증거다.
2. `signature.status: PASS`는 AAB 무결성과 승인 upload 인증서 일치 증거다.
3. `Automated gates: PASS`는 signature와 W08을 모두 통과했다는 증거다.
4. A02 기기 설치와 App Links는 별도 기기·HTTPS domain 증거가 필요하다.
5. Play upload와 Play review는 별도 Console 실행·심사 결과가 필요하다.

1~3이 통과해도 4~5를 실행하지 않았다면 `releaseReadiness.status`는 `NOT_RUN`이다. 따라서 build 출력·서명 PASS·자동 gate PASS를 “uploadable” 또는 “ready”로 표기하지 않습니다.

## 공식 확인 결과

- Google Play 계정 삭제 경로는 앱 안과 외부 웹에서 제공해야 하며, 관련 계정 데이터 삭제와 합법적 보존 범위를 설명해야 합니다. 외부 URL은 `https://masscom.kr/account-deletion`이며 실제 제출은 하지 않았습니다.
- 2023-11-13 이후 생성된 개인 개발자 계정에는 공식 도움말 기준 최소 12명이 연속 14일 opt-in 상태인 폐쇄 테스트가 적용됩니다. 실제 계정 생성일·Console 적용 여부를 확인하기 전에는 이 프로젝트의 확정 요건으로 단정하지 않습니다.
- Android 공식 문서는 Android 15/API 35 이상을 대상으로 하는 64비트 Play 앱의 16KB page size 지원을 요구하며, 2027-02-01 이후 비호환 업데이트 제한을 안내합니다. debug/JS export만으로 release AAB 호환을 완료 처리하지 않습니다.
- App Links는 HTTPS domain의 `/.well-known/assetlinks.json`과 설치본 서명·package ID가 일치해야 합니다. 직접 설치본은 upload 인증서로 검증하고, Play 배포 전에는 Play App Signing 인증서를 assetlinks와 OAuth client에 별도로 추가합니다.
- Play package 이름 등록 요구는 2026-09-30 시행으로 안내되어 실제 제출 직전 Console에서 자동 등록 여부를 확인합니다.

## 공식 근거

- [계정 삭제 요구사항](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [새 개인 계정 테스트 요구사항](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
- [16KB page size 지원](https://developer.android.com/guide/practices/page-sizes)
- [Android App Links 검증](https://developer.android.com/training/app-links/verify-applinks)
- [Play package 이름 등록](https://support.google.com/googleplay/android-developer/answer/16984799?hl=en)

## 심사 메모에 넣지 않을 것

- 개인키·복구 문구·지갑 비밀번호
- 실제 고객 QR·주문번호·정확한 식사 시각
- 공개되지 않은 운영 키·DB 접속 정보
- 존재하지 않는 협약 점포·테스터·Play 승인·매출 성과
