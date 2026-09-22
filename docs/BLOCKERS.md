# BLOCKERS

| ID | 원인 | 영향 | 해소 조건 | 상태 |
| --- | --- | --- | --- | --- |
| B-001 | D-004~D-008 승인 기록 없음 | 앱·계약·보상·배포 스캐폴드 확정 불가 | 2026-09-18 사용자 승인 기록 | `RESOLVED` |
| B-002 | 저장소가 private | 심사 public 규칙 미충족 | 명시적 공개 승인 후 전환 | `BLOCKED` |
| B-003 | 외부 계정·비용 승인 없음 | 외부 HTTPS·테스트넷 실증 불가 | 2026-09-22 사용자 승인 뒤 AWS Free Plan Lightsail 2GB 생성·API/DB/Caddy 배포 | `RESOLVED` |
| B-004 | Play·국내 분류 미확인 | 일반 공개 적격성 확정 불가 | 공식 근거·Console·필요 시 전문가 검토 | `BLOCKED` |
| B-005 | private 조직 저장소의 Pages 지원·공개 승인 미확정 | 프로젝트 포털 공개 URL 없음 | private 저장소는 유지하고 Vercel 정적 포털 `https://masscom.kr` 배포, 법적 페이지 포함 HTTPS 200 확인 | `RESOLVED` |
| B-006 | Reown Dashboard project ID·초기화된 사용자 지갑 없음 | AppKit modal·WalletConnect 연결·서명·지갑 복귀 실기 불가 | 2026-09-18 사용자 제공 project ID와 사용자가 준비·잠금 해제한 MetaMask로 실기 | `RESOLVED` |
| B-007 | Android release package ID 미확정 | release AAB·App Link·Play 준비 불가 | 2026-09-20 사용자가 `kr.masscom.wolgye`로 결정(D-022). 개발 variant는 `kr.masscom.wolgye.dev` | `RESOLVED` |
| B-008 | Expo Router/config-plugin 전이 의존성 moderate advisory 14건 | release 보안 검토 미완료 | Expo 호환 비파괴 upstream 수정 확인·업그레이드 | `BLOCKED` |
| B-009 | Reown 2.0.6 미설치 지갑 연결 제안을 취소하는 공개 API 부재 | 스토어 복귀 뒤 pending proposal 만료가 미처리 Promise 발생 | 승인된 patch-package 최소 패치와 PR #38 실기 회귀 | `RESOLVED` |
| B-010 | MetaMask 8.11.0 WalletConnect 세션 계정 편집 경로 부재 | W04 정확한 서명 중 주소 변경 Android 실기 불가 | 같은 세션의 계정 변경을 지원하는 지갑 또는 MetaMask 지원 추가 | `BLOCKED` |
| B-011 | 복구 문구 없이 준비된 실제 미지원 스마트 지갑 없음 | W05 Android 실기 불가 | 자산·비밀정보가 없는 테스트 전용 스마트 지갑 제공 | `BLOCKED` |
| B-012 | Base Sepolia 배포자·민터 잔액 0 | 로컬 Anvil 외 계약 배포 증거 없음 | 2026-09-22 두 주소 모두 faucet ETH 수령 확인. 실제 계약 broadcast는 별도 `NOT_RUN` | `RESOLVED` |
| B-013 | 운영 로그인의 모바일 연결·소유 HTTPS 삭제 URL 미구현(서버 측 로그인·세션·`auth_time` 재인증·요청 제한·세션 정리는 Issue #106·#110으로 구현) | Google Play 계정 삭제 운영 경로 완료 불가 | Web·개발/upload Android OAuth client, `https://api.masscom.kr`, Android 첫 로그인·SecureStore 복원·logout revoke, `https://masscom.kr/account-deletion`을 실제 확인. 삭제 fresh reauthentication 실기는 별도 `NOT_RUN` | `RESOLVED` |
| B-014 | Reown 프로젝트 허용 목록에 새 package 미등록 | 2026-09-21 `kr.masscom.wolgye.dev`의 `origin not allowed`를 허용 목록 추가로 해소. 개발 package 지갑 복귀 PASS, 운영 release의 HTTPS App Link A02 PASS. 운영 release Reown 지갑 복귀 E02는 별도 `NOT_RUN` | Reown dashboard 등록과 개발 package 재실기 완료(Issue #116) | `RESOLVED` |
| B-015 | 가비아 DNS 수정 재로그인 필요 | Lightsail Caddy는 healthy지만 `api.masscom.kr` TLS·외부 `/health` 검증 불가 | 2026-09-22 `A api 43.200.56.97 TTL 600` 저장, 공용 DNS·Let’s Encrypt·외부 `/health` 200 확인 | `RESOLVED` |
