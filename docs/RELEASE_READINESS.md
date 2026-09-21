# Android·Google Play 출시 준비 체크리스트

마지막 공식 근거 확인: 2026-09-19 KST

| 항목 | 현재 상태 | 완료 조건 |
| --- | --- | --- |
| 운영 package ID | `DECIDED` D-022 | `kr.masscom.wolgye` 적용(`APP_VARIANT=production`). 2026-09-30 이후 Console package 등록 상태는 소유자가 확인 |
| 서명 AAB | `IN_PROGRESS` | `scripts/build-release-aab.sh`로 운영 variant AAB와 provenance를 생성하고 assessor의 서명·W08 자동 gate를 통과. upload key는 소유자가 저장소 밖에 만들고 `~/.gradle/gradle.properties`의 `android.injected.signing.*`로 주입. debug 서명 AAB는 업로드 금지. 자동 gate PASS는 기기·App Links·Play 준비 완료가 아님 |
| upload key | `IN_PROGRESS` | 2026-09-21 소유자가 저장소 밖 `~/.android/masscom-upload.jks`를 생성했고 권한 `0600`, 별칭·공개 인증서 지문 대조를 완료했다. 승인 SHA-256은 `apps/mobile/upload-certificate.sha256`에 고정했으며 비밀번호·keystore는 저장소에 없다. `android.injected.signing.*` 로컬 주입과 실제 upload-key AAB는 아직 `NOT_RUN`. 주입 경로 자체는 일회용 키로 PASS(`docs/evidence/release-signing-injection.json`). 검증기는 서명 무결성 → 인증서 존재 → debug 키 거절 → 승인 지문 대조를 수행한다 |
| 16KB page size | `IN_PROGRESS` | 2026-09-20 로컬 debug 서명 release AAB의 arm64-v8a·x86_64 네이티브 라이브러리 48개 모두 LOAD 정렬 `0x4000` PASS(`docs/evidence/release-aab-16kb-alignment.json`). upload key 서명 AAB와 16KB 기기 설치 검사는 `NOT_RUN` |
| App Links | `BLOCKED` | 소유 HTTPS domain, 운영 package ID, 배포 서명 SHA-256, `assetlinks.json` 준비 |
| 계정 삭제 앱 경로 | `VERIFIED` Local DEMO | 운영 재인증·실제 계정으로 동일 처리 검증 |
| 외부 삭제 웹 경로 | `BLOCKED` | 인증된 외부 HTTPS 페이지가 같은 API를 호출하고 오류 없이 열림 |
| Console 제출 초안 | `DRAFT` | `docs/PLAY_CONSOLE_DRAFT.md`의 초안을 소유자가 Console 문항과 대조해 확정 |
| Data safety | `IN_PROGRESS` | 실제 로그인·Reown relay·RPC·서버·분석 전송과 일치하게 Console 제출 |
| 금융 기능 선언 | `NOT_RUN` | 실제 NFT 보상 기능 기준으로 Console 항목 확인, 자동으로 “없음” 선택 금지 |
| 콘텐츠 등급·연령 | `NOT_RUN` | 실제 디자인·NFT·지역 상권 기능 기준 응답 |
| 심사 접근 | `PLANNED` | 실제 구매 없이 재현 가능한 시연 계정·DEMO 점포·안전한 QR·테스트넷 표기 |
| 폐쇄 테스트 | `NOT_RUN` | 계정 적용 여부 확인, 필요한 경우 실제 12명 연속 14일과 피드백 기록 |
| Play 업로드·공개 | `BLOCKED` | 사용자 명시 승인과 모든 사전 조건 충족 |

## Release artifact와 provenance

`scripts/build-release-aab.sh [--restore-dev]`는 `apps/mobile/release-artifacts/` 또는 `RELEASE_ARTIFACT_DIR`에 `app-release-<short-sha>.aab`와 `app-release-<short-sha>.provenance.json`을 한 쌍으로 보존합니다. provenance에는 다음 공개 증거만 들어갑니다.

- artifact basename·SHA-256·byte 크기
- source commit·`apps/mobile` dirty 여부
- source가 기대한 Android package/version과 W08이 AAB에서 확인한 package
- signature와 W08의 `PASS`/`FAIL`, exit code, upload 인증서 공개 SHA-256
- `releaseReadiness.status`와 남은 A02 설치·App Links·Play upload/review gate
- 생성 시각

keystore 경로·비밀번호·개인키는 provenance 대상이 아닙니다. 현재 schema는 artifact 절대 경로가 아닌 basename만 저장합니다. provenance에 개인 로컬 filesystem 경로가 드러나면 그 파일을 커밋하지 말고 생성 경로를 점검합니다. release artifact 디렉터리는 gitignored이며, 공개·커밋 여부는 내용 검토 뒤 별도로 결정합니다.

자동 gate가 exit `N`으로 실패하면 두 파일은 삭제되지 않고 `app-release-<short-sha>.NOT-RELEASE-READY-exitN.aab`와 같은 basename의 `.provenance.json`으로 함께 이동합니다. 이 이름은 자동 판단 실패를 뜻할 뿐 Play의 최종 심사 판단이 아닙니다.

증거 단계는 다음처럼 구분합니다.

1. Gradle build 성공은 AAB가 생성됐다는 증거다.
2. `signature.status: PASS`는 AAB 무결성과 승인 upload 인증서 일치 증거다.
3. `Automated gates: PASS`는 signature와 W08을 모두 통과했다는 증거다.
4. A02 기기 설치와 App Links는 별도 기기·HTTPS domain 증거가 필요하다.
5. Play upload와 Play review는 별도 Console 실행·심사 결과가 필요하다.

1~3이 통과해도 4~5를 실행하지 않았다면 `releaseReadiness.status`는 `NOT_RUN`이다. 따라서 build 출력·서명 PASS·자동 gate PASS를 “uploadable” 또는 “ready”로 표기하지 않습니다.

## 공식 확인 결과

- Google Play 계정 삭제 경로는 앱 안과 외부 웹에서 제공해야 하며, 관련 계정 데이터 삭제와 합법적 보존 범위를 설명해야 합니다. 현재 외부 URL은 없습니다.
- 2023-11-13 이후 생성된 개인 개발자 계정에는 공식 도움말 기준 최소 12명이 연속 14일 opt-in 상태인 폐쇄 테스트가 적용됩니다. 실제 계정 생성일·Console 적용 여부를 확인하기 전에는 이 프로젝트의 확정 요건으로 단정하지 않습니다.
- Android 공식 문서는 Android 15/API 35 이상을 대상으로 하는 64비트 Play 앱의 16KB page size 지원을 요구하며, 2027-02-01 이후 비호환 업데이트 제한을 안내합니다. debug/JS export만으로 release AAB 호환을 완료 처리하지 않습니다.
- App Links는 HTTPS domain의 `/.well-known/assetlinks.json`과 배포 서명·package ID가 일치해야 합니다. domain과 운영 서명이 없어 현재 검증할 수 없습니다.
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
