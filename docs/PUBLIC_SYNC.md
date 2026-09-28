# 개인 개발 이력의 대회 조직 저장소 통합

2026-09-29 확인: [대회 조직 저장소](https://github.com/2026-KW-HACKATHON/27_MassCOM)는 `PUBLIC`·활성 상태다. 한때 보관된 기간에는 [개인 비공개 저장소](https://github.com/choijunhuk/MassCOM)에서 개발했다. 아래 조직 PR은 원래 Git 커밋·작성자·순서를 보존하면서 관련 작업을 묶어 통합한 것이며, 새로운 개발 날짜나 팀원 기여를 꾸민 이력이 아니다.

| 원래 작업 | 조직 PR | 병합 커밋 | 조직 `main` CI |
| --- | --- | --- | --- |
| 보관 때문에 중단됐던 도감 다음 목표 | [#207](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/207) | `b0a1333` | PASS |
| 개인 PR #2·#4: 고객 식별 QR·첫 방문 흐름 | [#208](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/208) | `ac0e417` | [PASS](https://github.com/2026-KW-HACKATHON/27_MassCOM/actions/runs/36455380759) |
| 개인 PR #5·#7–#10: 운영 관리자·직원·삭제 접수 | [#209](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/209) | `6ae7ede` | [PASS](https://github.com/2026-KW-HACKATHON/27_MassCOM/actions/runs/36457365304) |
| 개인 PR #11–#15: 점포 정보·QR 발급/재발급·현황·캠페인 초안 | [#210](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/210) | `1cce579` | [PASS](https://github.com/2026-KW-HACKATHON/27_MassCOM/actions/runs/36459385401) |
| 개인 PR #16: Preview 5·캠페인 배포 기록 | 이 문서가 포함된 조직 문서 PR | 병합·CI 별도 확인 | 별도 확인 |

[시연 Preview 5 APK](https://github.com/2026-KW-HACKATHON/27_MassCOM/releases/tag/showcase-android-v0.1.0-preview.5)는 개인 비공개 Release와 같은 소스 `88932cb` 및 [같은 SHA-256](evidence/showcase-preview5-public-release-2026-09-29.json)으로 조직에 공개했다. 공개 게시와 실제 휴대전화 설치·신규 QR 흐름 검증은 서로 다른 상태이며, 후자는 `NOT_RUN`이다. 운영 test.3과 시연 앱은 서로 다른 package·API·데이터를 사용한다.

운영 점포 등록·실제 계정 삭제·두 휴대전화 신규 QR 수령·Play 제출·현장 점포 검증은 이 Git 이력 통합으로 완료되지 않는다. 최신 미완료 항목은 [BLOCKERS](BLOCKERS.md)와 [TEST_STATUS](TEST_STATUS.md)를 따른다.
