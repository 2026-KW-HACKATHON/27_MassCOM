# 테스트 보고서

부트스트랩 기능 검증 기준 커밋: `ea9e7b6`.

상태는 `PASS / FAIL / BLOCKED / NOT_RUN`만 사용합니다. 아래 36개 ID는 v3 19.1절에서 그대로 유지했습니다.

| ID | 구분 | 상태 | 시나리오 | 통과 조건 | 증거 |
| --- | --- | --- | --- | --- | --- |
| Q01 | PostgreSQL 동시성 | NOT_RUN | 같은 QR 동시 20요청 | 수령·방문 인정 1회 | 미구현 |
| Q02 | PostgreSQL 동시성 | NOT_RUN | QR 만료와 수령 경쟁 | 하나의 최종 상태 | 미구현 |
| Q03 | API 통합 | NOT_RUN | QR 재발급 후 이전 코드 사용 | 이전 코드는 거절, 권리 추가 없음 | 미구현 |
| Q04 | API 통합 | NOT_RUN | 단체 일부만 수령 | 사람별 결과 독립, 다른 슬롯 유지 | 미구현 |
| Q05 | 권한 통합 | NOT_RUN | 다른 점포 직원·다른 사용자 접근 | 조회·변경 모두 거절 | 미구현 |
| R01 | PostgreSQL 동시성 | NOT_RUN | 한국 날짜 경계·동시 방문 평가 | 정한 일별 규칙대로 최대 1회 | 정책 미승인 |
| R02 | PostgreSQL 동시성 | NOT_RUN | 마지막 캠페인 자리 동시 등록 | 약속한 공급 상한 초과 없음 | 미구현 |
| R03 | 도메인·DB | NOT_RUN | 같은 목표 반복 평가 | 보상권 하나 | 미구현 |
| W01 | 지갑·API | NOT_RUN | 연결만 승인하고 서명 생략 | 미검증 주소, 민팅 불가 | 미구현 |
| W02 | 서명 검증 | NOT_RUN | 다른 계정·도메인·체인의 서명 | 거절 | 미구현 |
| W03 | 서명 검증 | NOT_RUN | 만료·사용한 nonce 재사용 | 거절 | 미구현 |
| W04 | Android·지갑 | NOT_RUN | 서명 도중 지갑 주소 변경 | 기존 원문·확인 상태 무효 | 미구현 |
| W05 | Android·지갑 | NOT_RUN | 지원하지 않는 스마트 지갑 | 무검증 우회 없이 설명·거절 | 미구현 |
| W06 | Android 실기 | NOT_RUN | 지갑 미설치·서명 거절·복귀 실패 | 안내와 재시도, 보상권 유지 | 미구현 |
| W07 | DB·Worker | NOT_RUN | 주소 연결 해제와 전송 경쟁 | 고정 수령인·명확한 작업 상태 | 미구현 |
| W08 | 배포 빌드 검사 | NOT_RUN | SDK 구매·스왑·내장 지갑 기본값 | 배포 빌드에 해당 진입점 없음 | 스택 미승인 |
| W09 | 요청 경계 | NOT_RUN | 예기치 않은 송금·approve 요청 | 앱 요청 경계에서 거절 | 미구현 |
| M01 | Worker·체인 | NOT_RUN | 같은 발급 버튼·Worker 중복 실행 | 온체인 NFT 하나 | 미구현 |
| M02 | Worker·체인 | NOT_RUN | 전송 직후 응답 유실 | 기존 발행 조회, 새 보상 키 금지 | 미구현 |
| M03 | Worker·체인 | NOT_RUN | Worker 재시작·nonce 경합 | 순번 충돌·중복 효과 없음 | 미구현 |
| M04 | 설정 검증 | NOT_RUN | 잘못된 체인·계약 설정 | 전송 전에 차단 | 미구현 |
| M05 | 이벤트 검증 | NOT_RUN | receipt 성공이지만 다른 이벤트 | 완료 처리 거절 | 미구현 |
| M06 | 인덱서·체인 | NOT_RUN | 이벤트 반복 수집·재조직 | 중복 없음, 확정 전 되돌림 가능 | 미구현 |
| M07 | DB·Worker | NOT_RUN | 민팅 도중 프로필 지갑 변경 | 이미 고정한 수령인 유지 | 미구현 |
| M08 | 복원 | NOT_RUN | DB 백업 복원 후 재처리 | 기존 NFT를 다시 발행하지 않음 | 미구현 |
| C01 | Foundry 계약 | NOT_RUN | 비민터 발행·민터 권한 상승 | 계약에서 거절 | 규칙 미승인 |
| C02 | Foundry 속성 | NOT_RUN | 누적 상한 경계·중복 발행 키 | 상한·일회성 유지 | 규칙 미승인 |
| C03 | Foundry 계약 | NOT_RUN | 모든 전송·우회 경로 | 잠긴 NFT는 이전 불가 | 양도 규칙 미승인 |
| C04 | Foundry 계약 | NOT_RUN | 시리즈 활성화 후 조건 변경 | 동결된 값 변경 불가 | 양도 규칙 미승인 |
| D01 | API·Worker | NOT_RUN | 발급 중 탈퇴 | 미전송·제출됨을 구분 | 미구현 |
| D02 | Android·API | NOT_RUN | 계정 전환·캐시 복구 | 이전 사용자 데이터 미노출 | 미구현 |
| D03 | 정적·통합 검사 | NOT_RUN | 로그·분석·메타데이터 검사 | 개인키·QR·개인 식별자 누출 없음 | 미구현 |
| A01 | Android 실기 | NOT_RUN | 카메라 권한 거절·오프라인 | 수동 코드·정확한 상태 표시 | 미구현 |
| A02 | Android 릴리스 | NOT_RUN | 실제 AAB·16KB·앱 링크 | 설치·실행·복귀 정상 | 미구현 |
| O01 | 환경 권한 | NOT_RUN | 시연 권리로 운영 API 접근 | 환경 경계에서 거절 | 미구현 |
| O02 | 장애·복원 | NOT_RUN | RPC·민터 잔액·DB 장애 | 보상권 보존·중지·복구 절차 동작 | 미구현 |

## 실행 기록

| 시각 | 커밋 | 명령 | 환경 | 결과 | 재현 |
| --- | --- | --- | --- | --- | --- |
| 2026-09-18 KST | 작업 트리 | `bash tests/bootstrap/verify_bootstrap_test.sh` | macOS, Bash | 첫 실행 RED: 검증기 없음 | 검증기 추가 전 실행 |
| 2026-09-18 KST | 작업 트리 | `bash tests/bootstrap/verify_bootstrap_test.sh` | macOS, Bash | PASS: 저장소 계약·36 ID·상태·누락 fixture | 같은 명령 재실행 |
| 2026-09-18 KST | 작업 트리 | `bash tests/bootstrap/check_secrets_test.sh` | macOS, Bash | PASS: 안전 fixture 허용·토큰·자격증명 URL·API 키 URL·EVM 키 형태 거절 | 같은 명령 재실행 |
| 2026-09-18 KST | `92d8029` | GitHub Actions `bootstrap-contract` | `ubuntu-latest` | PASS, 4초 | PR #2 Actions run `35282893247` |
