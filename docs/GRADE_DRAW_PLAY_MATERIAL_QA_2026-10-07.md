# 등급 뽑기·놀이·코인 재질 QA — 2026-10-07

[Issue #395](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/395). 구현은 [설계](superpowers/specs/2026-10-07-grade-draw-play-material-design.md)와 [계획](superpowers/plans/2026-10-07-grade-draw-play-material.md)을 따른다. 구현 소스 `9606258d`의 로컬 검증을 기록한다. [PR #397](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/397)의 실제 최신 HEAD CI·병합 상태를 별도로 따른다. 운영 반영은 하지 않았다.

## 변경 범위

- 브론즈·실버·골드 풀에서 코인·테마·캐릭터 **개별 아이템**을 각각 동일 확률 `1/N`로 뽑는다. 기존 등급 가격 100/200/400P를 유지하고 1회에 보상 하나만 준다. 중복 보유 아이템도 다시 뽑힐 수 있고 수량/원장에 반영한다. 추가 마일리지나 의상 보너스는 없다.
- 새 뽑기는 풀 버전과 요청 ID로 변경된 풀·재전송을 다루며, 예전 `/shop/rerolls`의 미완료 요청은 먼저 복구한다. Migration `0061_grade_draws.sql`은 차감·보상·중복 이력, 잔액, 테마 소유/장착, 코인 수량/시리즈, 탈퇴 정리를 기존 저장소 흐름에 합친다.
- 놀이는 기존 네 게임과 서버 규칙을 유지하며 준비·목표·진행·결과와 방/코인/탐험 동선을 읽기 쉽게 연결한다.
- 코인 상세·목록·스프라이트가 앞/뒤 같은 윤곽을 쓴다. 센서 각도 ±30도 제한을 제거하고 금속 하이라이트의 specular/Fresnel 계산을 적용한다. 웹에서는 CSS 윤곽으로 재질층을 자르고 사진/스프라이트 투명도는 보존하며, 네이티브 SVG 클립은 유지한다.

## 격리 브라우저 QA

로컬 가상 API와 전용 합성 고객 계정/DB를 사용했다. 실제 점포·Google 사용자·점주 권한·쿠폰 지급은 아니다.

| 흐름 | 결과 | 확인한 범위 |
|---|---|---|
| 등급 뽑기 | PASS | 코인·테마·캐릭터 각각 1회 결과, 각각 100P 차감, 중복 코인 수량 반영; 테마 모자와 캐릭터 장착 상태 저장 |
| 쌓기 | 부분 PASS | 74점 기록, 미완주 |
| 짝 찾기 | 부분 PASS | 두 장 공개·불일치 상태 기록, 미완주 |
| 배달 | PASS | 12/12 완주, 790점 저장 |
| 주문 순서 | 부분 PASS | 810점 기록, 3/4 주문, 미완주 |

합성 계정에 저장된 기록은 실제 고객의 성취나 운영 데이터로 취급하지 않는다. 브라우저 화면 캡처와 테스트 원시 자료는 비공개 `.tmp/grade-finish/`에만 두며 저장소에 포함하지 않는다.

## 자동 검증과 미완료

| 검사 | 결과 | 비고 |
|---|---|---|
| 모바일 전체 | PASS 1803/1803 | 현 소스 기준 기록 |
| API 전체 | PASS 558/558 | 현 소스 기준 기록 |
| PostgreSQL 전체 | PASS 508 + SKIP 3 / 총 511 | 새 격리 DB에서 전체 재실행, 단일보상·재전송·차감·탈퇴 정리 포함. hosted seed 3개는 별도 disposable host 환경 필요 |
| 타입·빌드·린트·접근성·비밀/개인정보 검사 | PASS | API 타입/build, 모바일 타입/lint, 접근성 semantics, 최종 소스 스냅샷의 비밀·개인정보 검사 |
| 독립 검토 | PASS | 웹 투명도 누락 수정 후 남은 소스 finding 없음, 관련 회귀 32/32 |
| 비공개 Android APK | PASS 빌드/서명/정렬 | 최신 APK SHA-256 `3da75d5fdd37b06cd09a809c000ebc8d70ec4cf9a5da25af9cc1fa8f708dd2a1`, 기존 dev 서명 일치·native32·ZIP16KiB. 설치 NOT_RUN |
| 실물 휴대폰·센서·진동 | NOT_RUN | 사용자가 현재 휴대폰 연결이 어렵다고 알림. 연결된 에뮬레이터는 조작하지 않음 |
| PR·CI·병합 | [PR #397](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/397) | 정확한 최신 HEAD의 CI·병합 상태는 실제 PR을 확인한다 |
| 운영 반영·공개 배포 | NOT_RUN | migration/API/공개 APK/Play 변경 없음 |

다음 전달 단계는 정확한 소스 HEAD의 PR CI를 확인하고 병합하는 것이다. 실물 센서 반응과 진동 체감은 별도 휴대폰 수용이 필요하다.


## 재질 검증과 반복 실행

- 브라우저에서 골드 0° 반사띠·45° 반사 감쇠/측면·180° 기본 뒷면의 같은 원형 윤곽을 확인했다. 프리즘은 투명 PNG 12프레임 합성 fixture의 0°/45°에서 빛이 그림 부분만 따르며 빈 영역을 칠하지 않는 것을 확인한 뒤 fixture를 원복했다. 게시 사진 뒷면은 fixture의 JPEG 제한으로 기본 뒷면을 확인했으므로, 실제 게시 PNG 뒷면의 기기 수용은 별도다.
- 시각 판정 92/100 PASS는 합성 브라우저 범위다. 임시 UI 실험을 원복했고 APK는 아직 설치하지 않았다.
- APK에 의도된 공개 TMAP 지도 키와 NAVER 지도 ID가 포함되며 NAVER 서버 Secret은 없다. 현재 TMAP REST와 공개 지도 설정은 같은 발급 키 값이므로 그 바이트의 완전 제외를 주장하지 않는다. 빌드 환경에서 서버 변수는 제외했다.
- 재현: `npm test --prefix apps/mobile`, `npm run typecheck --prefix apps/mobile`, `npm run lint --prefix apps/mobile`, `npm test --prefix apps/api`, `npm run typecheck --prefix apps/api`, `npm run build --prefix apps/api`, 격리 `_test` DB의 `npm run test:postgres --prefix apps/api`, `node scripts/check-accessibility-semantics.mjs apps/mobile/src`. 소스 검사 대상은 tracked/new 소스만 복사한 snapshot이다. APK·공급자 자격 증명·원시 로그는 Git 밖에 둔다.
- API/앱 배포 전 migration 0061을 먼저 적용해야 한다. 운영 마이그레이션·공개 APK·Play 배포는 NOT_RUN이다.


## 2026-10-07 PR 검토 후 방문 취소 잔액 복구

추가 독립 검토에서 기존 방문 취소 계약의 음수 잔액을 새 모바일 parser가 거부하는 P2를 확인했다. 잔액만 signed safe integer로 허용하며 가격·수량·개수 제약은 유지한다. 음수 잔액 조회/재전송 회귀 2건이 수정 전 실패했고 수정 후 parser 5/5, 모바일 전체1805/1805·타입/lint를 통과했다. 별도 구조 재검토 CLEAR, 코드 결함0. 새 서버 동작·보상 확률·가격은 바꾸지 않았다. 최신 CI는 PR HEAD를 따른다.

배포는 migration 0061 → 모든 API 인스턴스 교체 → 새 앱 제공 순서로 진행한다. `grade_draws`에 첫 거래가 기록된 이후에는 해당 지출을 합산하지 않는 구 API로 단순 rollback하지 않는다. rollback이 필요하면 쓰기를 먼저 중지하고 grade_draws 잔액 합산을 유지하는 호환 버전으로 복구한다. 이번 작업에서는 운영 배포를 실행하지 않는다.
