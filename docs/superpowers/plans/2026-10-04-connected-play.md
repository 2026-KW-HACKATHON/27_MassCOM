# 방문과 놀이 연결 구현 계획

> 실행 방식: 사용자가 승인한 자율 구현과 Codex native subagents. 독립 파일 소유권을 지정하고 리더가 통합·검증한다.

**Goal:** 요청한 수집·동행·꾸미기·게임 4종·지속 목표·공유·가게·점주 경험을 연결한다.

**Architecture:** 기존 방문/마일리지/소유권 API를 유지한다. 순수 게임 규칙, 실행 기록과 공간 설정을 additive API로 추가하고 Expo 공통 화면에서 사용한다.

**Tech Stack:** 기존 Expo 57 / React Native / SVG / Reanimated / PostgreSQL / Node.

**Spec:** `docs/superpowers/specs/2026-10-04-connected-play-design.md`

## 전역 제약

- 새 의존성·유료 서비스 없음. 운영 데이터에 시연 기록 복사 금지.
- 게임은 방문 보상·마일리지·쿠폰 권리를 변경하지 않는다.
- 계정 소유권·친구 권한·삭제를 모든 새 API에서 검증한다.
- 기존 사용자 보유 내역과 등급별 미보유 뽑기 보장을 유지한다.
- 코드·배포·설치·실기 확인을 구분해서 보고한다.

## 검토 초점

- 늦은 응답이 다른 계정의 공간이나 게임 결과를 덮어쓰지 않는다.
- 완료 응답 유실 뒤 재시도는 기록·해금을 두 번 늘리지 않는다.
- 불가능한 입력·미래 시각·만료 실행·타인 실행·미보유 진열을 거절한다.
- 실제 방문할 수 없는 비공개/종료 가게를 목표로 제안하지 않는다.
- 작은 화면·긴 이름·그림 없는 초기 계정·오류/로딩·소리/모션 감소를 처리한다.

## 병렬 작업과 소유권

- [x] 서버: `apps/api/src/play*.ts`, `src/postgres/play*.ts`, 새 migration, server route/wiring, 계정 삭제. 실행 발급→입력 재검증→기록/해금, 공간 소유권과 친구 열람, 익명 흐름 집계. 단위와 DB 통합 시험.
- [x] 게임: `apps/mobile/src/play/`, `src/screens/play/`, `src/app/play.tsx`. 네 조작을 실제 플레이와 결과/재도전/기록/장식 해금으로 연결. 서버 규칙을 재사용.
- [x] 공간: `apps/mobile/src/studio/`, `src/screens/studio/`, `src/app/studio.tsx`, `src/app/friends/[friendshipId]/studio.tsx`. 실제 보유 그림·동행·배경·배치·색·진열 편집, 목표 선택, 피드/스토리 capture/share.
- [x] 점주: 제작기/점주/운영자 web asset 및 해당 사이트 시험. 실제 메뉴와 사진으로 시작, 방문 단계별 시각 템플릿, 체크리스트 후속 동작과 측정 정의.
- [x] 리더: 계약 통합, 실제 자산 제작/검사, 홈·도감·친구·뽑기·방문 결과 연결, 개인/서비스 공유 결과물, 최종 QA와 문서·PR.

완료 근거: [통합 검증과 실제 결과물](../../evidence/connected-play-2026-10-04/README.md), [PR #364](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/364). 구현 커밋은 `779d15d7`, 환경 복구 기록은 `3604be5b`다. 공개 배포와 실제 기기·점포에서 확인하지 못한 항목은 검증 문서의 `NOT_RUN`으로 구분한다.

## 검증 순서

1. 게임 규칙·보유 검증·재시도 시험을 먼저 실행하고 구현 후 통과를 확인한다.
2. 각 소유자가 좁은 시험·typecheck를 수행한다. API migration은 전용 `_test` DB에만 적용한다.
3. 리더가 API/DB/mobile/site 전체 관련 시험, lint/typecheck/gate와 production/showcase Android·web export를 실행한다.
4. 로컬 서버와 웹에서 네 게임과 공간/공유/방문 연결을 실제 조작한다. Desktop/mobile 캡처를 확인하고 visual-verdict를 남긴다.
5. 독립 리뷰 결과를 수정하고 통과 근거를 문서화한다. 일반 공개·유료 도입·사용자 자산 이동이 필요하면 독립 준비를 마친 뒤 결정 사항만 요청한다.

## 회복과 인수인계

동일 환경 오류를 반복 검사로 숨기지 않는다. 로그·최소 재현·대체 검증을 남긴다. 중단 시 실제 branch/SHA/실행 세션/남은 수용 조건을 HANDOFF에 기록한다.
