# TMAP 실연결과 NAVER 대체 검증 — 2026-10-07

[Issue #383](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/383), 브랜치 `fix/tmap-completion`, 기준 main fcbf4fbe. [설정 절차](../../TMAP_NAVER_SETUP.md). 소스 파일 해시는 [source-hashes.json](source-hashes.json), 정해진 값만 남긴 실제 호출/브라우저 관측은 [live-checks.json](live-checks.json), 개인 APK 정보는 [private-apk.json](private-apk.json)에 있다. 키·전체 SDK 응답·사용자 위치·브라우저 인증 정보를 저장하지 않는다.

| 검증 | 결과 | 범위 |
|---|---|---|
| API 전체·타입·build | PASS 546/546 | 새 제공자·HTTP 경계 포함; 집중 검사는 중복 합산하지 않음 |
| 모바일 전체·타입·lint | PASS 1775/1775 | SDK 순서·실패/재시도·늦은 콜백과 variant 설정 |
| 운영/시연 설정+웹 관련 | PASS 131/131 | compose 검증과 해당 web regression; 공개 배포 아님 |
| 소스 비밀/개인정보 gate | PASS | git 관리/신규 소스만 담은 fresh snapshot. 전체 로컬 폴더의 기존 private QA 번들/fixture가 raw secret scan에 잡혀 source snapshot으로 분리해 검사. checker 수정/비활성 없음 |
| 실제 TMAP REST | PASS | 공개 덕수궁 대한문 POI1, 서울시청 도로명 주소1, 도보379m/299초/5 LineStrings. DB/사용자 GPS 없음 |
| 실제 TMAP 웹 | PASS | localhost 개발 export + 합성 점포 DB. 실제 타일/출처 표시와 로딩 종료, SDK 마커 click으로 200m→50m·범위 패널, 앱 보행639m/약9분+머무름15분 |
| Native SDK/Kotlin | PASS | 공식 NAVER3.24.0+기존 TMAP3.7, Expo prebuild plugin/autolink |
| 개인 개발 APK | PASS | app assembleRelease48초, kr.masscom.wolgye.dev;128 native libraries/4ABIs, arm64/x86_64 LOAD·ZIP16KiB, 금지 권한0. 기존 debug 서명·미설치·미공개. 32bit4KiB를 64bit16KiB 실패로 집계하지 않음 |
| 독립 검토 | PASS | API/web/native와 실제 bootstrap 수정 재검토, 필수 수정0. 타입 검사·검색 기반, 전용 LSP/AST 도구 미제공 |
| NAVER 실제 호출/타일 | NOT_RUN | 신규 Maps+별도 지역 검색 자격 증명 부재 |
| 실제 Samsung·GPS·진동 등 | NOT_RUN | 지정 R3CX10PCWCW 미연결, emulator는 사용하지 않음. 과거 haptic 체감 FAIL 유지 |
| 운영/시연 공개 반영·Play | NOT_RUN | 공개 서버/설치본 변경 없음 |

수정 전 실제 도로명 요청은 지번 전용 F01 때문에 HTTP400[A2C500]이었다. F00 회귀 RED→GREEN과 실제 응답을 확인했다. 웹은 HTTP200 bootstrap 안의 document.write 때문에 기존 동적 로더가 실패했다. bootstrap을 실행하지 않고 auth/data로 읽고 allowlist의 공식 CSS/JS를 비동기로 로드해 실제 타일까지 확인했다.

초기 전체 Gradle assembleRelease는 library AAR 생성 단계에서 직접 local AAR 의존성을 거절했다. 앱을 패키징하는 :app:assembleRelease로 바로잡아 성공했다. test.10/Preview19 공개 APK나 PR382의 이전 운영/시연 빌드를 이번 개발 APK로 교체해 기록하지 않는다. 사용자 실제 영업점/로그인/동의/방문·쿠폰·보상 수용과 합성 QA를 구분한다.


## 원격 CI의 보안 검사 복구

첫 CI [37524867384](https://github.com/2026-KW-HACKATHON/27_MassCOM/actions/runs/37524867384)는 테스트와 운영/시연/웹 export를 모두 통과하고 마지막 audit에서 기존 DevTools의 shell-quote1.10.0 권고로 실패했다. [공식 권고](https://github.com/ljharb/shell-quote/security/advisories/GHSA-pqg4-j6r4-53mv)의 수정 버전1.11.0으로 package-lock의 버전·배포 URL·검증값 세 줄만 바꿨다. 새 패키지/override/예외 추가는 없다. 새로운 parse 문법이 추가된 최신1.12.0은 선택하지 않았다.

npm ci와 기존 patch-package postinstall, npm ls 1.11.0, audit:ci, 네 줄 종료자 위험 입력의 TypeError 거부 및 정상 CLI 인자 parse/quote 왕복, 모바일1775/타입/lint가 통과했다. 위 private APK와 실제 지도 기록의 핵심 소스 해시는 동일하다. 이 기록을 최신 HEAD 원격 CI 완료로 대신하지 않는다.

두 번째 CI [37528688262](https://github.com/2026-KW-HACKATHON/27_MassCOM/actions/runs/37528688262)는 e1ff5b3b에서 전체 PASS다. 콘솔에서 확인한 신규 서비스 메뉴는 웹/Android 공통 Dynamic Map과 Geocoding이다. URL 입력의 대표 도메인 규칙과 [추가] 버튼, 실제 로컬4422 출처를 설정 문서에 반영했다. 이후 문서 HEAD의 원격 검사와 병합은 별도로 확인한다.
