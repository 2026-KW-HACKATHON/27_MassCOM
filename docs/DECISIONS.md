# 결정 기록

상태는 `USER_CONFIRMED`, `PROPOSED`, `EXTERNAL_CHECK_REQUIRED`, `BLOCKED`로 구분합니다. 이 표의 `PROPOSED` 행이 최초 묶음 결정 요청입니다.

| ID | 항목 | 권장안 | 현재 상태 | 근거·영향 |
| --- | --- | --- | --- | --- |
| D-001 | 체인·지갑 경계 | 기존 체인 + 외부 지갑, 자체 체인·지갑·키 보관 금지 | `USER_CONFIRMED` | 최신 사용자 계약, 보안 경계 |
| D-002 | 지갑 없는 이용 | 탐색·방문 인증·방문 도감 허용 | `USER_CONFIRMED` | 최신 사용자 계약, 진입 장벽 감소 |
| D-003 | 발행 권한 요청 | 주소 확인 메시지 서명만 허용 | `USER_CONFIRMED` | 최신 사용자 계약, 자산 이동 금지 |
| D-004 | 첫 보상 방식 | 조건을 미리 공개한 고정형 보상 | `PROPOSED` | 무작위 보상 정책 위험 감소, 앱 문구·도메인 규칙 결정 |
| D-005 | 첫 NFT 양도 | ERC-721 + ERC-5192 방식 초기 양도 제한 | `PROPOSED` | 계약·마켓 안내·테스트 C03/C04에 영향 |
| D-006 | 방문·기간 | 첫/3/5회, 한국 날짜당 1회, 달성 60일·신청 90일 | `PROPOSED` | 보상·캠페인·R01/R03 데이터 모델에 영향 |
| D-007 | 앱·체인·연결 | React Native+Expo development build, Base Sepolia→Base, Reown 외부 지갑만 사용 | `PROPOSED` | Phase 1 의존성·딥링크·실기 대상 결정 |
| D-008 | 배포 환경 | AWS 서울 리전 + Docker Compose + Nginx + PostgreSQL | `PROPOSED` | 유료 자원 생성 전 별도 비용 승인 필요 |
| D-009 | 저장소 | `2026-KW-HACKATHON/27_MassCOM`, 기본 브랜치 `main` | `USER_CONFIRMED` | 운영진 조직 저장소와 현재 작업 디렉터리 일치 |
| D-010 | 저장소 공개 | 심사 전 public 전환 | `BLOCKED` | 대회 규칙상 필요하나 가시성 변경은 명시 승인 대상 |
| D-011 | Play·법률·공급업체 | 실제 기능·계정·약관 기준 재확인 | `EXTERNAL_CHECK_REQUIRED` | 개인 계정 승인·사업자 불필요를 보장하지 않음 |

## 승인 응답 형식

`D-004~D-008 권장안 전체 승인` 또는 변경할 ID와 원하는 값을 적습니다. D-008 승인은 배포 설계 채택이며 실제 유료 자원 생성 승인과는 별개입니다.
