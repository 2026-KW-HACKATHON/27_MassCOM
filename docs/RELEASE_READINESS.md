# Android·Google Play 출시 준비 체크리스트

마지막 공식 근거 확인: 2026-09-19 KST

| 항목 | 현재 상태 | 완료 조건 |
| --- | --- | --- |
| 운영 package ID | `DECIDED` D-022 | `kr.masscom.wolgye` 적용(`APP_VARIANT=production`). 2026-09-30 이후 Console package 등록 상태는 소유자가 확인 |
| 서명 AAB | `IN_PROGRESS` | `scripts/build-release-aab.sh`로 운영 variant AAB 생성 후 `scripts/check-release-wallet-surface.sh <aab>`로 구매·스왑·내장 지갑·송금 진입점 부재(W08)를 확인. upload key는 소유자가 저장소 밖에 만들고 `~/.gradle/gradle.properties`의 `android.injected.signing.*`로 주입. debug 서명 AAB는 업로드 금지 |
| upload key | `NOT_RUN` | 2026-09-20 기준 이 장비에 upload keystore·`android.injected.signing.*` 설정 없음. 생성은 소유자 승인·직접 입력 사항이며 기존 키를 다시 만들거나 덮어쓰지 않는다. 주입 경로 자체는 일회용 키로 PASS(`docs/evidence/release-signing-injection.json`). 빌드 스크립트는 AAB를 `apps/mobile/release-artifacts/`(gitignore)로 복사한 뒤 `scripts/verify-aab-signature.sh`로 판정한다: 서명 무결성(jarsigner) → 인증서 존재 → debug 키 거절 → 승인된 upload 인증서 SHA-256(`UPLOAD_CERT_SHA256` 또는 `apps/mobile/upload-certificate.sha256`) 대조. 종료 코드 0 업로드 가능, 3 debug, 4 미서명, 5 서명 손상, 6 다른 키, 7 승인 지문 미설정. 자체서명이라는 이유로 거절하지 않는다 |
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
