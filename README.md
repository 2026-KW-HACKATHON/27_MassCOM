# 월계 마스코트(가칭)

월계1동의 음식점을 발견하고, 실제 이용 인증으로 마스코트 도감을 채우며, 원하는 수집품을 외부 암호화폐 지갑에 NFT로 발급받는 Android 서비스입니다.

> 현재 단계: **Phase 0 / IN_PROGRESS**. 저장소 기준선과 검증 체계를 만드는 중이며, 동작하는 앱·API·NFT 계약·외부 데모·협약 점포·Google Play 승인은 아직 없습니다.

## 핵심 흐름

`음식점 탐색 → 점주 이용 확인 → QR 인증 → 보상권 → 외부 지갑 앱 연결 → 주소 확인 서명 → 기존 블록체인에 NFT 발행 → 도감 → 다음 음식점 탐색`

지갑은 선택 기능입니다. 지갑이 없어도 음식점 탐색, 방문 인증, 방문 도감을 사용할 수 있어야 합니다. 앱 내부에서만 받은 수집품과 블록체인에 실제 발행된 NFT는 화면과 데이터에서 구분합니다.

## 상태 표기

| 상태 | 의미 |
| --- | --- |
| `PLANNED` | 요구사항은 있으나 구현을 시작하지 않음 |
| `IN_PROGRESS` | 작업 브랜치에서 구현 또는 검증 중 |
| `IMPLEMENTED` | 코드가 있으나 필요한 전체 검증은 끝나지 않음 |
| `VERIFIED` | 지정한 환경과 테스트에서 근거를 남겨 검증 완료 |
| `BLOCKED` | 외부 권한·결정·환경 때문에 진행 불가 |

| 영역 | 상태 | 현재 근거 |
| --- | --- | --- |
| 저장소 부트스트랩 | `IN_PROGRESS` | `chore/project-bootstrap` 브랜치 |
| Android 고객 앱 | `PLANNED` | 기술 선택 승인 대기 |
| 점주·직원 웹 | `PLANNED` | 요구사항만 정리됨 |
| 클라우드 API·PostgreSQL | `PLANNED` | 배포 환경 승인 대기 |
| 외부 지갑 주소 확인 | `PLANNED` | 실제 SDK·기기 검증 전 |
| NFT 계약·발행 Worker | `PLANNED` | 보상·양도 규칙 승인 전 |
| 테스트넷·외부 HTTPS | `BLOCKED` | 계정·비용·배포 승인 필요 |
| Google Play 제출 | `BLOCKED` | 정책 확인·실기·명시 승인 필요 |

## 확정된 제품 경계

- 기존 블록체인을 사용하며 자체 체인을 만들지 않습니다.
- 사용자 지갑을 만들지 않고 개인키·복구 문구를 입력받거나 보관하지 않습니다.
- 외부 지갑에는 주소 통제 확인용 메시지 서명만 요청합니다.
- 자산 송금, `approve`, `permit`, 스왑, 구매, 내장 지갑 기능은 제품 범위에 넣지 않습니다.
- 지갑 연결과 주소 통제 확인을 분리하고, 서버가 계정·주소·도메인·체인·nonce·만료·서명 원문을 검증합니다.
- 보상권 소비와 발행 작업은 같은 DB 트랜잭션으로 저장하고, 발행 수령인은 요청 시점의 검증된 주소로 고정합니다.
- 개인정보·주문번호·정확한 식사 시각은 NFT 메타데이터와 공개 장부에 기록하지 않습니다.

보상값, 첫 NFT의 양도 제한, 방문 진행 규칙, React Native·Base·Reown, AWS 배포는 아직 승인 기록이 없어 [`docs/DECISIONS.md`](docs/DECISIONS.md)에 `PROPOSED`로 남겨 두었습니다.

## 아키텍처와 저장소 구조

```text
Android 앱 ── HTTPS ── API ── PostgreSQL
    │                    │          │
    └─ 외부 지갑 앱      └─ Outbox ─┴─ Worker ── 기존 블록체인
                                       │
점주·직원 웹 ─ HTTPS ──────────────────┘
```

현재 실제 파일 구조는 Phase 0 검증물만 포함합니다. 승인 후 애플리케이션 코드가 생길 때 `apps/mobile`, `apps/merchant-web`, `apps/api`, `apps/worker`, `contracts`, `migrations`, `infra`를 실제 실행물과 함께 추가합니다.

```text
.github/                 CI, Issue·PR 형식
docs/                    근거, 규칙, 요구사항, 결정, 상태, 시험 기록
packages/domain/spec/    기술에 독립적인 핵심 불변조건
scripts/                 저장소 검증 명령
tests/bootstrap/         부트스트랩 회귀 테스트
tests/catalog/           v3 19절의 36개 테스트 ID
```

## 설치·검증

Phase 0 검증은 추가 패키지를 설치하지 않습니다. macOS 또는 Linux에서 Bash로 실행합니다.

```bash
git clone https://github.com/2026-KW-HACKATHON/27_MassCOM.git
cd 27_MassCOM
bash tests/bootstrap/verify_bootstrap_test.sh
bash tests/bootstrap/check_secrets_test.sh
```

앱·API·DB 마이그레이션·Android 빌드 명령은 해당 코드와 lockfile이 실제로 추가된 뒤 이 문서에 기록합니다. 아직 존재하지 않는 명령을 예시로 꾸미지 않습니다.

## 환경 변수

비밀값 없이 변수의 역할만 [`.env.example`](.env.example)에 기록합니다. 실제 키, 운영 QR, 개인정보, 복구 문구는 커밋하지 않습니다. 현재는 외부 서비스가 연결되지 않아 모든 외부 연동 변수가 비어 있습니다.

## 테스트와 CI

- 로컬: `bash tests/bootstrap/verify_bootstrap_test.sh`
- 비밀 검사: `bash tests/bootstrap/check_secrets_test.sh`
- CI: `.github/workflows/ci.yml`
- 필수 36개 시험: [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md), [`tests/catalog/required-tests.tsv`](tests/catalog/required-tests.tsv)

모든 기능 시험은 `PASS / FAIL / BLOCKED / NOT_RUN`으로 기록합니다. 모킹한 지갑·DB 시험을 실제 Android·외부 지갑·PostgreSQL 검증으로 표시하지 않습니다.

## 데모·배포 상태

| 산출물 | 상태 |
| --- | --- |
| 외부 HTTPS 데모 | 준비 전 |
| Android APK/AAB | 준비 전 |
| Base Sepolia 계약 | 체인 승인·자격증명 확인 전 |
| 메인넷 계약 | 명시 승인 전, 실행 금지 |
| Google Play 트랙 | 명시 승인 전, 실행 금지 |

## 대회 대응

- 공식 규칙 요약: [`docs/COMPETITION.md`](docs/COMPETITION.md)
- 중간·최종 평가 증거 연결: [`docs/EVALUATION_MAP.md`](docs/EVALUATION_MAP.md)
- 자료와 SHA-256: [`docs/SOURCE_INDEX.md`](docs/SOURCE_INDEX.md)
- 요구사항: [`docs/PRD.md`](docs/PRD.md)
- 현재 상태와 장애물: [`docs/STATUS.md`](docs/STATUS.md)

저장소는 현재 `PRIVATE`입니다. 심사 시점 `public` 요구가 있으나, 공개 전환은 별도 승인 대상입니다.

## 알려진 한계와 출시 확인

- 고정형 보상·양도 제한·방문 횟수/기간·기술 스택·배포 환경이 미승인입니다.
- 실제 휴대전화, 외부 지갑, PostgreSQL 동시성, 계약, 복원 시험은 모두 `NOT_RUN`입니다.
- 개인 Google Play 계정 적격성, 사업자·법률·개인정보·금융 기능 신고는 공식 근거와 실제 Console에서 다시 확인해야 합니다.
- 목표 점포·사용자 수는 실적이 아니며, NFT 발행 수를 매출 증가로 표현하지 않습니다.

용어는 [`docs/GLOSSARY.md`](docs/GLOSSARY.md)를 참고하십시오.

## 팀 기여·AI 사용·오픈소스

현재 확인된 Git 작성자는 최준혁이며, 실제 사람별 역할·리뷰·현장 검증은 아직 등록되지 않았습니다. AI는 자료 대조, 저장소 부트스트랩, 문서와 검증 스크립트 작성에 사용되었으며 결과는 PR에서 사람이 검토해야 합니다. 상세 범위는 [`docs/AI_USAGE.md`](docs/AI_USAGE.md)에 기록합니다. 존재하지 않는 팀원 기여나 리뷰를 기록하지 않습니다.

직접 포함한 외부 코드와 자산은 아직 없습니다. 사용 라이브러리·폰트·이미지가 생기면 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 버전, 라이선스, 출처, 수정 범위를 기록합니다.
