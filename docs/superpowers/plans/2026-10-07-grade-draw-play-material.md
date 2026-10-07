# 등급 통합 뽑기·놀이·재질 개선 Implementation Plan

**Goal:** 등급 전체 풀에서 한 보상만 지급하고 놀이/코인 표현을 기존 수집 경험에 맞게 완성한다.
**Spec:** ../specs/2026-10-07-grade-draw-play-material-design.md
**Architecture:** 기존 원장·발행본·소유/장착·기계/재질/게임/요청 수명 패턴을 재사용한다. 사용자 자율 실행 지시에 따라 승인 대기 없이 실행한다.

## 전역 조건과 검토 초점

- 사용자 확정: 전체 아이템 동일 확률·계속 구현. 기존100/200/400P, 한번한보상, 중복가능, 추가마일리지/의상 없음.
- 기존 보유/발행된 가게권/미완료 이전 구매·게임 서버 판정/쿠폰 비용 한도 유지. 새 의존성/가짜 운영 기록 없음.
- 동시 차감·응답 유실·풀 변동·미디어 철회·삭제·계정 전환·배경/모션 감소·앞뒤 윤곽/회전 경계를 검증한다.

## 작업

- [x] API grade-draw.ts 계약, grade-draw-rules.ts 균등 선택, postgres/grade-draw.ts 한 번 원장/0061. 전용PG에서 문자/테마/코인·중복·동시 차감·장착/시리즈·미디어 철회를 검사.
- [x] 기존 mileage-shop 잔액·collection-experience 테마 장착·coin-economy 코인 수량을 합류. server.ts GET /shop/draw-pools POST /shop/draws 로그인/동의/본문/제한/에러와 계정 삭제에 합류.
- [x] 모바일 grade-draw-api/pending와 GradeDrawMachine, 상점 3등급/풀 구성/최근20내역. 기존 Svg 머신/효과와 이전 /shop/rerolls 대기 구매 복구 유지.
- [x] collection 렌더 앞뒤/스프라이트 동일 shape ClipPath, 넓은 회전 센서와 고정 광원 반사/프레넬·자동 glint 제한. 타깃40 테스트로 기하/필터/반사 경계 검사.
- [x] play 네 게임 준비/입력 목표/진행/결과/프로젝트 동선과 기본 달수 표현. 서버 규칙/점수 유지, 목표수량·수명 테스트.
- [x] 루트 전체 타입/lint/build·API/모바일/PG·접근성/소스 검사와 독립 검토 마무리. 현재 기록: 모바일1803·API558 PASS, PG508 PASS+3 SKIP(총511) 최종 전체 재실행 PASS.
- [x] 비공개APK 최종 동일서명/키제외/16KiB 검사. 사용자가 실폰 연결이 어렵다고 알려 실제 폰의 개봉/놀이/센서·진동 확인은 `NOT_RUN`; 브라우저 시각92/100 PASS, 실물 검증과 분리.
- [x] QA 보고서와 README/DESIGN/AI_USAGE/HANDOFF 갱신. 한국어PR검사·commit/push/attach·최종HEAD CI·merge·primary ff-only는 아직 대기.
