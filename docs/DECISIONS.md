# 결정 기록

상태는 `USER_CONFIRMED`, `PROPOSED`, `EXTERNAL_CHECK_REQUIRED`, `BLOCKED`로 구분합니다.

| ID | 항목 | 권장안 | 현재 상태 | 근거·영향 |
| --- | --- | --- | --- | --- |
| D-001 | 체인·지갑 경계 | 기존 체인 + 외부 지갑, 자체 체인·지갑·키 보관 금지 | `USER_CONFIRMED` | 최신 사용자 계약, 보안 경계 |
| D-002 | 지갑 없는 이용 | 탐색·방문 인증·방문 도감 허용 | `USER_CONFIRMED` | 최신 사용자 계약, 진입 장벽 감소 |
| D-003 | 발행 권한 요청 | 주소 확인 메시지 서명만 허용 | `USER_CONFIRMED` | 최신 사용자 계약, 자산 이동 금지 |
| D-004 | 첫 보상 방식 | 조건을 미리 공개한 고정형 보상 | `USER_CONFIRMED` | 2026-09-18 사용자 ‘ㄱㄱ’, 무작위 보상은 첫 출시 제외 |
| D-005 | 첫 NFT 양도 | ERC-721 + ERC-5192 방식 초기 양도 제한 | `USER_CONFIRMED` | 2026-09-18 사용자 ‘ㄱㄱ’, 계약·마켓 안내·C03/C04 기준 |
| D-006 | 방문·기간 | 첫/3/5회, 한국 날짜당 1회, 달성 60일·신청 90일 | `USER_CONFIRMED` | 2026-09-18 사용자 ‘ㄱㄱ’, 보상·캠페인·R01/R03 기준 |
| D-007 | 앱·체인·연결 | React Native+Expo development build, Base Sepolia→Base, Reown 외부 지갑만 사용 | `USER_CONFIRMED` | 2026-09-18 사용자 ‘ㄱㄱ’, Phase 1 의존성·실기 기준 |
| D-008 | 배포 환경 | AWS 서울 리전 + Docker Compose + Nginx + PostgreSQL | `USER_CONFIRMED` | 2026-09-18 사용자 ‘ㄱㄱ’, 설계만 승인; 유료 자원 생성은 별도 승인 |
| D-009 | 저장소 | `2026-KW-HACKATHON/27_MassCOM`, 기본 브랜치 `main` | `USER_CONFIRMED` | 운영진 조직 저장소와 현재 작업 디렉터리 일치 |
| D-010 | 저장소 공개 | 심사 전 public 전환 | `BLOCKED` | 대회 규칙상 필요하나 가시성 변경은 명시 승인 대상 |
| D-011 | Play·법률·공급업체 | 실제 기능·계정·약관 기준 재확인 | `EXTERNAL_CHECK_REQUIRED` | 개인 계정 승인·사업자 불필요를 보장하지 않음 |
| D-012 | 프로젝트 포털 공개 | GitHub Pages 또는 승인된 정적 호스팅 | `BLOCKED` | private 조직 저장소 지원 확인과 공개 배포 승인이 필요 |
| D-013 | 개인 GitHub 복제 | `choijunhuk` 계정의 private mirror | `USER_CONFIRMED` | 나중에 진행; 조직 저장소 private 코드의 public 복제 금지 |
| D-014 | 이번 실행 범위 | Phase 1 완료까지만 진행 | `USER_CONFIRMED` | Phase 2 점포·QR·보상권 구현은 시작하지 않음 |
| D-015 | 후속 실행 범위 | 현재 저장소에서 다음 미완료 Phase부터 개발 재개 | `USER_CONFIRMED` | 2026-09-18 새 요청이 D-014의 세션 범위만 대체, Phase 2 Issue #13 착수 |
| D-016 | 세션 복원 정본 | `PROJECT_STATE.md`·`TEST_STATUS.md`를 정본으로 유지 | `USER_CONFIRMED` | 새 요청의 명시 파일명, 기존 `STATUS.md`·`TEST_REPORT.md`는 호환 안내만 유지 |
| D-017 | Phase 2 PR 수 | 기능 흐름 기준 최대 3개, 상태 전용 PR 금지 | `USER_CONFIRMED` | 2026-09-19 사용자가 과도한 PR 분할을 피하도록 요청; 탐색, 수령·도감, 추천·최종검증으로 통합 |
| D-018 | 후속 전체 개발 | 승인된 v3 순서대로 Phase 3 이후 로컬 구현·검증 계속 | `USER_CONFIRMED` | 2026-09-19 사용자 ‘페이지 쭉쭉 전부다’; 운영 키·메인넷·유료 자원·공개/Play/제출 승인 경계는 유지 |
| D-019 | SIWE challenge 저장 방식 | `DATABASE_URL`이 있으면 PostgreSQL `wallet_challenges`, 없으면 DEMO 메모리 저장소 | `USER_CONFIRMED` | 2026-09-20 사용자 ‘다 승인할께’; 제안된 PostgreSQL 공유 저장소 범위에 한정하며 운영 키·메인넷·유료 자원·공개/Play/제출 승인 경계는 유지. 같은 응답에서 Codex 미사용을 명시 |
| D-020 | 외부 실행 범위 승인 | 외부 HTTPS·Base Sepolia 배포·release AAB·Google Play 준비 진행 | `USER_CONFIRMED` | 2026-09-20 사용자 ‘전부 동의할께’. 개인키·keystore 생성, faucet, 계정 로그인, Console 약관 동의와 제출은 소유자가 직접 수행. mainnet·사용자 자산 이동·저장소 공개·대회 최종 제출은 포함하지 않음 |
| D-021 | 기기 세션 저장 정책 | WalletConnect 세션은 AsyncStorage 유지, 인증 token 도입 시 SecureStore 전용, 계정 삭제 때 기기 세션 제거 | `USER_CONFIRMED` | 2026-09-20 사용자가 정책 결정을 위임. 기기에 비밀이 없고 세션이 SecureStore 한도를 넘어 새 의존성을 추가하지 않음 |
| D-022 | 운영 package ID | 운영 `kr.masscom.wolgye`, 개발 `kr.masscom.wolgye.dev`, URL scheme은 각각 `masscom`·`masscom-dev` | `USER_CONFIRMED` | 2026-09-20 사용자 지정. Play package 이름 등록과 domain 소유 확인은 소유자가 Console에서 수행 |
| D-023 | 캠페인 참여 자리 반환과 수령 조건 | 삭제·취소로 자리를 반환하지 않음. 방문 수령(redeem)이 참여 등록을 요구할지는 미정 | `PROPOSED` | 2026-09-20 Issue #73 구현 중 제안. 자리 미반환은 v3 6.2절 ‘약속한 상한 초과 금지’를 보수적으로 적용한 구현 기본값이며, 수령 시 등록 요구는 보상 규칙 변경이라 사용자 결정 전에는 적용하지 않음 |
| D-024 | 운영 로그인 방식 | Google 로그인(OIDC ID token을 서버에서 서명·`aud`·`exp` 검증, `sub`를 계정 식별자로) | `USER_CONFIRMED` | 2026-09-21 사용자 ‘다 승인’. `docs/HOSTING_LOGIN_PROPOSAL.md` 후보 1. Google Cloud OAuth client 생성·동의 화면은 소유자가 직접 수행 |
| D-025 | 서버 세션 형태 | 서버 저장 세션 + 불투명 토큰(해시로 저장, 만료·로그아웃·계정 삭제 시 즉시 폐기) | `USER_CONFIRMED` | 2026-09-21 사용자 승인. JWT 단독 방식은 즉시 폐기가 어려워 채택하지 않음 |
| D-026 | 재인증 기준 | 계정 삭제 직전 5분 이내 재로그인 요구 | `USER_CONFIRMED` | 2026-09-21 사용자 승인. DEMO `x-demo-reauthenticated` 경로는 loopback 개발 전용으로 유지 |
| D-027 | 모바일 UI 방향 | 따뜻한 동네 음식 탐험·마스코트 수집, 탐색/방문 인증/도감/내 정보 네 기본 이동과 기존 맥락 화면 보존 | `USER_CONFIRMED` | 2026-09-23 사용자 ‘계속 진행해’로 B안 방향 승인. 상세 명세 검토와 구현·실기 결과는 별도 단계 |
| D-028 | 탐색 보완 | 실제 공개 점포 응답만 검색·참여 가능 상태로 필터하고, 점포 0건에는 허위 콘텐츠 대신 재조회와 이용 순서를 표시 | `USER_CONFIRMED` | 2026-09-23 사용자 UI·기능 개선 위임. 새 협약 점포·마스코트 자산을 만들어 넣지 않음 |
| D-029 | AI 모델 사용 | GPT‑6 Sol medium을 일상 기본값, Luna를 좁은 탐색·문서, Astra를 보안·고위험 독립 검토에 사용 | `USER_CONFIRMED` | 2026-09-23 사용자가 기존 5.6 배분표의 GPT‑6 기준 재조정을 요청. [사용 기준](AI_MODEL_ROUTING.md); 주간 잔량 보장은 하지 않음 |
| D-030 | 공개 서비스·지갑 출처 | 공식 포털 `https://masscom.kr`을 Reown 메타데이터와 README의 대표 웹 주소로 사용. API는 `api.masscom.kr`, private 코드·APK는 GitHub로 분리 | `USER_CONFIRMED` | 2026-09-23 사용자 요청. 기존 Android native 복귀 스킴·SIWE 검증 도메인·체인·허용 메서드는 유지 |

## 2026-09-23 UI 기초 작업 범위 (Issue #136)

당시 요청은 `누구세요?` 역할 선택, 점주 DEMO·사용자 진입, 선택적인 기존 외부지갑 안내와 내용 없는 다섯 공간의 스와이프·하단 바였습니다. PR #138의 최초 버전은 이를 첫 화면으로 대체했지만 CI 지갑 경계 검사에 실패했고 실제 탐색·방문 인증·도감으로 갈 수 없는 빈 화면이 됐습니다. 이후 사용자가 PR 답글과 수정을 요청해, 시안은 **개발용 미리보기**로 격리하고 D-027의 실제 네 탭/기본 경로를 유지하는 것으로 범위를 갱신했습니다. 시안은 점주 권한을 부여하지 않으며 운영·시연 환경 분리는 Issue #137에서 별도로 다룹니다. Toss 수준의 정돈은 참고이며 TDS는 최종 스타일이 아닙니다. 외부 배포·Play 공개는 이 수정에 포함되지 않습니다.

## 2026-09-18 승인 범위

사용자가 이전 묶음 결정 요청에 `ㄱㄱ`로 응답해 D-004~D-008의 v3 권장안을 전체 승인했습니다. 이 승인은 로컬 구현·테스트·배포 설계 채택 범위이며, 유료 자원 생성·저장소/포털 공개·테스트넷 외부 전송·메인넷·Play 배포·대회 제출 승인은 포함하지 않습니다.

## 2026-09-18 Phase 2 재개

최신 요청은 GitHub와 HANDOFF에서 다음 미완료 작업을 이어서 실제 구현하도록 명시했습니다. 따라서 D-014는 당시 세션의 종료 범위로 보존하고, D-015가 현재 실행 범위에 우선합니다. 제품 정책·보안 경계·공개/과금 승인 조건은 변경하지 않습니다.
