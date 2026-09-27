# BLOCKERS

| ID | 원인 | 영향 | 해소 조건 | 상태 |
| --- | --- | --- | --- | --- |
| B-001 | D-004~D-008 승인 기록 없음 | 앱·계약·보상·배포 스캐폴드 확정 불가 | 2026-09-18 사용자 승인 기록 | `RESOLVED` |
| B-002 | 저장소가 private | 심사 public 규칙 미충족 | 2026-09-27 사용자 공개 전환 후 GitHub API에서 PUBLIC 확인 | `RESOLVED` |
| B-003 | 외부 계정·비용 승인 없음 | 외부 HTTPS·테스트넷 실증 불가 | 2026-09-22 사용자 승인 뒤 AWS Free Plan Lightsail 2GB 생성·API/DB/Caddy 배포 | `RESOLVED` |
| B-004 | Play·국내 분류 미확인 | 일반 공개 적격성 확정 불가 | 공식 근거·Console·필요 시 전문가 검토 | `BLOCKED` |
| B-005 | 당시 private 조직 저장소의 Pages 지원·공개 승인 미확정 | 프로젝트 포털 공개 URL 없음 | 기존 Lightsail의 `https://www.masscom.kr` 정적 포털·법적 페이지 HTTPS 200 확인. 이후 저장소도 PUBLIC 전환; GitHub Pages는 사용하지 않음 | `RESOLVED` |
| B-006 | Reown Dashboard project ID·초기화된 사용자 지갑 없음 | AppKit modal·WalletConnect 연결·서명·지갑 복귀 실기 불가 | 2026-09-18 사용자 제공 project ID와 사용자가 준비·잠금 해제한 MetaMask로 실기 | `RESOLVED` |
| B-007 | Android release package ID 미확정 | release AAB·App Link·Play 준비 불가 | 2026-09-20 사용자가 `kr.masscom.wolgye`로 결정(D-022). 개발 variant는 `kr.masscom.wolgye.dev` | `RESOLVED` |
| B-008 | Expo Router/config-plugin 전이 의존성 moderate advisory 15건(2026-09-27 재평가) | release 보안 검토 미완료 | 같은 SDK 57 권장 패치·`tsx`/`esbuild` 갱신 뒤에도 모바일 `npm audit` 중간 등급 15건이 남음. `decode-uri-component`의 패치판은 상위 CommonJS와 호환되지 않아 강제 override 금지; 호환 upstream 수정·악성 링크 회귀 뒤 재평가 | `BLOCKED` |
| B-009 | Reown 2.0.6 미설치 지갑 연결 제안을 취소하는 공개 API 부재 | 스토어 복귀 뒤 pending proposal 만료가 미처리 Promise 발생 | 승인된 patch-package 최소 패치와 PR #38 실기 회귀 | `RESOLVED` |
| B-010 | MetaMask 8.11.0 WalletConnect 세션 계정 편집 경로 부재 | W04 정확한 서명 중 주소 변경 Android 실기 불가 | 같은 세션의 계정 변경을 지원하는 지갑 또는 MetaMask 지원 추가 | `BLOCKED` |
| B-011 | 복구 문구 없이 준비된 실제 미지원 스마트 지갑 없음 | W05 Android 실기 불가 | 자산·비밀정보가 없는 테스트 전용 스마트 지갑 제공 | `BLOCKED` |
| B-012 | Base Sepolia 배포자·민터 잔액 0 | 로컬 Anvil 외 계약 배포 증거 없음 | 2026-09-22 두 주소 모두 faucet ETH 수령 확인. 실제 계약 broadcast는 별도 `NOT_RUN` | `RESOLVED` |
| B-013 | 운영 로그인의 모바일 연결·소유 HTTPS 삭제 URL 미구현(서버 측 로그인·세션·`auth_time` 재인증·요청 제한·세션 정리는 Issue #106·#110으로 구현) | Google Play 계정 삭제 운영 경로 완료 불가 | Web·개발/upload Android OAuth client, `https://api.masscom.kr`, Android 첫 로그인·SecureStore 복원·logout revoke, `https://masscom.kr/account-deletion`을 실제 확인. 삭제 fresh reauthentication 실기는 별도 `NOT_RUN` | `RESOLVED` |
| B-014 | Reown 프로젝트 허용 목록에 새 package 미등록 | 2026-09-21 `kr.masscom.wolgye.dev`의 `origin not allowed`를 허용 목록 추가로 해소. 개발 package 지갑 복귀 PASS, 운영 release의 HTTPS App Link A02 PASS. 운영 release Reown 지갑 복귀 E02는 별도 `NOT_RUN` | Reown dashboard 등록과 개발 package 재실기 완료(Issue #116) | `RESOLVED` |
| B-015 | 가비아 DNS 수정 재로그인 필요 | Lightsail Caddy는 healthy지만 `api.masscom.kr` TLS·외부 `/health` 검증 불가 | 2026-09-22 `A api 43.200.56.97 TTL 600` 저장, 공용 DNS·Let’s Encrypt·외부 `/health` 200 확인 | `RESOLVED` |
| B-016 | Issue #126 새 UI의 Android 내부 화면 실기 환경 미확보 | 자동 시험·APK 설치는 PASS지만 네 탭·큰 글씨·TalkBack·딥링크 시각 결과를 판정할 수 없음 | 2026-09-23 Samsung Android 16에서 네 탭·360dp·200%·실시간 다크·뒤로 가기·개발 scheme를 확인. TalkBack 앱 콘텐츠 낭독, 현재 코드 production App Link와 데이터·지갑이 다른 D02는 별도 `NOT_RUN` | `RESOLVED` |
| B-017 | RQ-001의 ‘로그인 없이 음식점 탐색’ `VERIFIED` 표기와 현재 앱 루트 로그인 게이트가 충돌 | 공개 API 조회와 실제 앱 사용 가능 범위를 혼동할 수 있음 | 사용자가 로그인 없는 탐색 유지/요구사항 변경 중 방향을 결정하고, 별도 인증·보안 검증 후 PRD와 앱을 일치시킴. 현재 PRD 상태는 `IN_PROGRESS` | `BLOCKED` |
| B-018 | [시연 APK·두 계정 폰 로그인·점주 발급→고객 직접 코드 수령·중복 거절·도감 분리](evidence/showcase-two-account-phone-2026-09-27.json)는 완료. 카메라 QR 촬영→수령과 `demo.masscom.kr` App Link·전용 Reown 지갑은 미검증 | 직접 입력 흐름과 QR 촬영·지갑 흐름을 같은 완료 상태로 발표할 수 없음 | 실제 Android 카메라로 다른 화면의 유효 QR을 촬영해 수령하고, App Link/지갑은 별도 환경에서 실증 | `BLOCKED` |
| B-019 | [PR #192](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/192) 병합 `7455791`, PR/main CI PASS 후 시연 API 이미지만 배포했다([실측](evidence/showcase-open-login-api-deployment-2026-09-27.json)). Preview 2 APK는 이전 설치본이고 초대 밖 실제 Google 계정 로그인이 아직 미검증 | 코드·서버 배포를 모든 계정의 Android 로그인 실증으로 표현할 수 없음 | 새 시연 서명 APK 설치→초대 밖 계정의 로그인·본인 도감·점주 403·운영 audience 거절·기존 기록 보존을 실제 기기에서 확인 | `BLOCKED` |
| B-020 | 운영·시연 앱의 자동 계정 삭제는 Google `auth_time` 최근성 조건을 현재 SDK로 강제할 수 없고, 이메일 삭제 요청에는 검증된 Google `sub`와 대상 계정을 연결하는 접수 절차가 없음 | 웹 링크와 이메일 수신만으로 실제 계정 삭제·Play 정책 충족을 판정할 수 없음 | 기존 www OAuth 세션에 연결된 안전한 접수·지원 처리·결과 통지와 폐기용 계정으로 실제 삭제를 검증하거나 동등한 본인 확인 수단을 별도 승인·검증 | `BLOCKED` |
