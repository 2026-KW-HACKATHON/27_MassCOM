# 자료 목록과 적용 범위

확인일: 2026-09-18 KST

원본은 저장소 상위 작업 디렉터리에서 읽었으며 공개 허가가 확인되지 않아 이 저장소에 복사하지 않았습니다. 아래에는 식별 정보와 비밀을 제거한 요약만 남깁니다.

| 자료 | 식별 정보 | SHA-256 | 적용 범위 |
| --- | --- | --- | --- |
| GitHub 자율개발 마스터 프롬프트 | `월계_NFT_GitHub_자율개발_마스터프롬프트(1).md`, 2026-09-18, 0~18절 | `81c36e476c43700866644b6ad706ec59c5f8399b94472707c3cabac8a7cc52f1` | 실행 방식, 승인 경계, Phase, GitHub·README·검증 계약 |
| 최종 실행계획 | `월계_마스코트_최종실행계획_v3(2).md`, 제목 `최종 실행계획 v3.0 · 외부 암호화폐 지갑 앱 연동형`, 2026-09-17, 1~24절·부록 A~C | `0e5662f4b551e9232f4476d11e02136250e1885caf428358a144e8710e6f4579` | 제품 방향, 제안값, 기술·보안·API·DB·36개 시험 |
| 개회식 자료 ZIP | `개회식_최종 (1).zip`, 내부 18쪽 이미지형 PDF | `5dbcc07e31b1c715117b11a70cea20b42befc4bf1607e69d54b737237d91ef4e` | 7~8쪽 규칙, 9~10쪽 일정·발표, 11~12쪽 평가표 |
| 실제 저장소 | `2026-KW-HACKATHON/27_MassCOM` | 초기 HEAD `304d860aa218fe53627b65b90c8b5c935c381f1c` | 코드·Issue·PR·검증 상태의 기준 |

## 근거 해석

- 대회 규칙은 운영진 자료를 따릅니다.
- 제품 결정은 최신 사용자 승인 기록을 따릅니다.
- v3의 고정 보상·양도 제한·RN·Base·Reown·AWS는 2026-09-18 D-004~D-008로 `USER_CONFIRMED`됐습니다.
- 구현 완료는 문서가 아니라 실제 코드와 실행 결과로만 판정합니다.

## Phase 1 공식 기술 근거

| 근거 | 확인일 | 적용 내용 |
| --- | --- | --- |
| [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) | 2026-09-18 | Expo 57·React Native 0.86, development build |
| [Reown AppKit RN 설치](https://docs.reown.com/appkit/react-native/core/installation) | 2026-09-18 | 필수 패키지·polyfill 순서·Ethers adapter |
| [Reown 옵션](https://docs.reown.com/appkit/react-native/core/options) | 2026-09-18 | socials·swaps·onramp 비활성화 |
| [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) | 2026-09-18 | SIWE 메시지 필드·nonce·만료·ASCII statement |
| [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) | 2026-09-18 | provider 요청·오류·계정/체인 변경 |
| [Base 연결 정보](https://docs.base.org/get-started/connect-to-base) | 2026-09-18 | Base Sepolia chain ID 84532·RPC·explorer |

## Phase 2 PostgreSQL 근거

| 근거 | 확인일 | 적용 내용 |
| --- | --- | --- |
| [PostgreSQL 18 문서](https://www.postgresql.org/docs/18/) | 2026-09-18 | 제약·부분 인덱스·트랜잭션 migration·통합 시험 |
| [node-postgres](https://node-postgres.com/) | 2026-09-18 | Pool·parameterized query·환경 기반 연결 |
