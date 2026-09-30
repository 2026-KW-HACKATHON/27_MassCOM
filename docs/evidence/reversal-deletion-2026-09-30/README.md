# 방문·쿠폰 되돌리기와 계정 삭제 요청 실기기 화면 (2026-09-30)

Samsung SM-S928N, 시연 앱 `kr.masscom.wolgye.demo`, 시연 API `02cb7e7`. 상태 표시줄은 잘라냈고 계정 식별자·접수번호가 보이는 화면은 저장하지 않았다.

| 파일 | 화면 |
|---|---|
| `01-staff-recent-visits.png` | 점주·직원 화면의 "최근 방문 확인" 카드(오늘 확인한 방문 없음) |
| `02-staff-recent-coupons.png` | 같은 화면의 "최근 쿠폰 사용" 카드(최근 24시간 사용 없음, 10분 안 되돌리기 안내) |
| `03-deletion-request-entry.png` | 내 정보의 "계정 삭제 요청"(24시간 취소·7일 처리 안내, 접수번호 조회 칸) |
| `04-deletion-confirm-dialog.png` | 삭제 요청 확인 창 |
| `05-deletion-cancelled.png` | 요청 취소 뒤 "삭제 요청을 취소했습니다. 계정은 그대로입니다." |

01~05는 Preview 11 후보 `02cb7e7` APK에서 찍었다. 이 후보에서 접수번호 마지막 글자가 다음 줄로 넘어가는 결함을 찾아 [PR #249](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/249)로 고쳤고, 고친 `18a8601`로 빌드한 Preview 11에서 접수번호가 한 줄로 보이는 것을 다시 확인했다(접수번호가 보여 화면은 저장하지 않음). 두 APK의 차이는 접수번호 `Text` 속성뿐이라 01~05 화면은 같다.

두 번 접수한 요청은 모두 곧바로 취소했고, 시연 DB 행은 `CANCELLED`·원 계정 ID 지움·접수번호 해시 보존이었다.
