# 가게 코인과 커뮤니티 보상 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 사용자 자율 실행 지시에 따라 승인 대기 없이 범위별 실행하고 통합 검증한다.

**Goal:** 가게별 소비권, 중복 코인과 실제 시리즈 쿠폰 목표, 동의 기반 공개 방 탐험을 연결한다.

**Architecture:** 기존 발행 수집품과 마일리지/계정 잠금/고객 신원/직원 권한을 재사용한다. 별도 티켓 원장은 캐릭터 뽑기와 분리하고 공개 방은 기존 방 장면을 공유한다.

**Tech Stack:** 기존 TypeScript, PostgreSQL, Expo Router/React Native, Node crypto.

**Spec:** ../specs/2026-10-07-coin-community-loop-design.md

## Global Constraints

- 기존 권리 삭제 없음; 새 의존성 없음; 운영 seed/공개 배포/실제 점주 혜택 생성 없음.
- 결과는 사용자 입력으로만 진행; 구매/사용/쿠폰/마일리지는 서버 권한과 원장으로 결정.
- 0059 가게 코인·시리즈, 0060 방 탐험. 공유 파일 server.ts/account-deletion.ts는 통합 담당자가 소유.
- 공개 방 기본 비공개; 반복 보상 없음; 첫 5개 다른 방 × 2P/한국 날짜, 집계되는 실제 방문 이력 조건.

## Review Focus

- 응답 유실 뒤 같은 요청 재전송: 티켓/코인/차감/쿠폰 한 번.
- 마지막 구매/쿠폰 한도 동시 경쟁: 상한 넘지 않고 다른 고객 상태 노출 없음.
- 발급 뒤 풀 판매 중지와 티켓 만료: 판매 중지 권리 보존, 만료 사용 차단.
- 공개 취소/차단/삭제 경합: 읽기와 보상 모두 재검사, 공개 ID 외 개인정보 미노출.
- 계정 변경/백그라운드/모션 감소: 오래된 구매·공개 방 응답 폐기, 결과 자동 이동 없음.

### Task 1: 보상 수동 진행

**Files:** screens/shop/gacha-machine.tsx, gacha-rules.ts와 두 기존 시험.
**Interfaces:** 기존 Next/Skip 이벤트만 reward phase를 이동시킨다.
- [x] 자동 reward timer를 검출하는 회귀 시험을 실패시킨 뒤 제거한다. 개봉 stage timer는 유지.
- [x] 기존 phase/구매 복구 시험, 모바일 타입/lint를 통과한다.

### Task 2: 가게 소비권·코인·시리즈

**Files:** API coin-economy.ts, postgres/coin-economy.ts, migrations/0059_coin_economy.sql, mileage-shop 잔액 helper, badge-rewards 직원 쿠폰 합류, 해당 시험.
**Interfaces:** PostgresCoinEconomyService(pool,{accountLifecycle,showcaseBonusMileage?})의 getShop(accountId), purchase({accountId,poolId,requestId}), useTicket({accountId,ticketId}), getCollection(accountId), claimSeries({accountId,seriesId}), publishPool({actorAccountId,...}), publishSeries({actorAccountId,...}), pausePool({actorAccountId,poolId}), grantTicket({actorAccountId,accountId,poolId,requestId}). 고객 응답과 관리자 입력 타입은 coin-economy.ts에 고정한다.
- [x] 가게 교차/가중치/기한/상한/동시 구매/재전송/중복 코인/기존 수집품 진척/최고 티어 한 번/점주 동의 시험을 만든다.
- [x] 명시적인 원장과 DB 제약, lifecycle 계정 잠금, cryptoRandomInt를 사용해 최소 구현한다.
- [x] 기존 캐릭터 상점 잔액에 티켓 지출을 반영하고 직원 쿠폰 조회/사용 흐름을 확장한다.
- [x] 단위·PG 통합·API 타입/build 검사를 통과한다.

### Task 3: 공개 방·탐험·칭찬 방명록

**Files:** API room-community.ts, postgres/room-community.ts, migrations/0060_room_community.sql, play의 공개 snapshot 재사용, 해당 시험.
**Interfaces:** PostgresRoomCommunityService(pool,{accountLifecycle,play})의 getSettings(accountId), setVisibility({accountId,visible}), randomRoom({accountId,excludeRoomId?}), getRoom({accountId,roomId}), visit({accountId,roomId}), stamp({accountId,roomId,kind}), removeStamp({accountId,stampId}), reportStamp({accountId,stampId}), blockRoom({accountId,roomId}). 응답 타입은 room-community.ts에 고정한다.
- [x] 비공개/양방향 차단/약관/삭제/자기 방/중복/KST 일일 상한/방명록 권한 시험을 만든다.
- [x] 공개 UUID와 기존 방 snapshot 장면, 개인정보 제외, 정해진 도장과 원장/유일 제약으로 구현한다.
- [x] 단위·PG 통합·타입/build 검사를 통과한다.

### Task 4: 모바일 흐름 연결

**Files:** coin 전용 API/화면/라우트와 상점·도감·가게권 연결; room 전용 API/화면/라우트와 놀이·내 방 연결.
**Interfaces:** Task2/3 응답 타입을 그대로 검증한다. 기존 요청/계정 generation/cancel 패턴을 재사용한다.
- [x] 계약 파서·응답 유실 복구·계정 전환·빈/로딩/실패 시험 후 구현한다.
- [x] 가게/이벤트/등급/정확한 확률·기한/제한을 확인하고 구매는 권리 발급, 사용은 코인 결과를 보여준다.
- [x] 시리즈 수량/기본·프리즘 진척과 쿠폰 조건, 공개 동의/철회·탐험·도장/삭제/신고/차단을 연결한다.
- [x] 모바일 전체·타입/lint·접근성·실기 기본 화면과 visual verdict를 기록한다.

### Task 5: 통합·삭제·운영·전달

**Files:** server.ts, postgres/account-deletion.ts, 서버 계약/계정 삭제 회귀시험, README/DESIGN/AI_USAGE/HANDOFF/QA.
- [x] ExperienceServices에 새 서비스 연결, 동의/권한/본문 검증/쓰기 제한과 오류 응답을 추가한다.
- [x] 계정 삭제를 새 개인정보 원장/공개 방/도장/쿠폰에 적용하고 기존 쿠폰 사용 검증을 재검사한다.
- [x] 격리 QA DB에서 migration과 실제 HTTP 연결을 검사한다. 생산 데이터/동의는 만들지 않는다.
- [ ] 전달: 독립 검토와 구현/전체 검증은 완료. 한국어 PR 검증→commit/push/attach→최종 HEAD CI→병합·primary ff-only는 해당 PR의 실제 상태를 따른다.

## 진행 기록

- 기반 UI PR #390 source1943556d, 지도 PR #389 mainc0691e8f. UI 병합 뒤 신규 작업만 최신 main으로 재배치한다.
- 휴대폰 재연결 후 night no, density450/nooverride, size1080×2340/nooverride, font1.0 원복 확인.

- 후속 점주 닫기 피드백: 시연/개발 앱의 고객 내 정보에서 역할 선택, 점주 모든 조회 상태의 마지막 뒤로에서 역할 선택으로 돌아간다. 내부 화면 종료와 서버 권한은 보존.
- 실기 발견: 오류 상태 뒤로 앱 종료와 새 세 라우트 기본 영문 헤더 중복을 수정한 후 비공개APK d0a8b58d로 다시 검사했다. QA 문서의 부분 수용/NOT_RUN 범위를 따른다.
