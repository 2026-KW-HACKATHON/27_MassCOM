# 2026-10-06 홈 요약·상세 분리 QA

## 변경 범위

홈은 서버에서 받은 가게권 수·마일리지 잔액·보유 동행 수와 현재 동행, `방문 QR`·`받은 가게권`·`미션`·`나의 전시` 진입을 한 화면에 둔다. 긴 가게권 목록과 개봉 연출은 `/home/tickets`, 기존 미션 상자는 `/home/missions`, 캐릭터·대표 코인·상점·방문 목표·알림 링크가 있는 전시는 `/home/exhibit`로 옮겼다. 세 상세 화면은 뒤로 버튼으로 홈에 돌아간다. 인증 필요·API 설정 필요 상태와 계정 전환 시 화면 재생성은 각 경로에서 유지한다.

가게권 상세는 서버의 모든 entitlement ID를 목록에 사용한다. 누른 뒤 카드가 실제 표시되었다는 `onCardShown`을 받을 때만 개봉 확인을 요청하며, 중복 ACK 차단·실패 후 재시도·최신 응답 검사·개봉 연출 및 음악 흐름을 보존했다. 홈 요약의 수치는 별도 서버 조회가 완료되기 전 `확인 중`, 실패 시 `조회 실패`로 표시한다.

## 검증 상태

| 항목 | 상태 | 근거·한계 |
| --- | --- | --- |
| 모바일 전체 자동 시험 | PASS | `apps/mobile`의 `npm test` 1,677/1,677. 홈·헤더·경로·개봉 ACK를 포함한 관련 시험 52/52. 자동 시험은 화면 배치를 증명하지 않는다. |
| 타입·정적 검사 | PASS | `npm run typecheck`, 변경 파일 ESLint 0 오류·0 경고, `git diff --check`. |
| 독립 검토 | PASS | 별도 CodeReviewer APPROVE, P1/P2 없음. 경로/API 50개·개봉 lifecycle 39개 PASS 및 변경 TS/TSX 11개 진단 0건. |
| 웹 384×832 다크 홈 요약 | PASS | 실제 API 기반 수치와 네 목적별 진입을 첫 화면에서 확인. 상세 경로와 큰 글씨 검증은 별도다. |
| Samsung SM-S928N 기본 글씨 홈 요약 | PASS | 실제 기기에서 수치·동행·네 진입을 첫 화면에서 확인. 합성 QA 계정의 데이터만 사용했다. |
| 실기 상세 경로·뒤로 | PASS | 가게권 6장 목록, 미션 8/9와 상자, 전시의 꾸미기·보유 동행·팩·위시리스트·알림을 확인. 가게권·미션·전시에서 홈 복귀 확인. 이번 분리 뒤 실기 카드 개봉 ACK는 NOT_RUN. |
| 웹 가게권 개봉·취소·홈 갱신 | PASS | 실제 UI에서 카드 표시 후 목록 6→5장, 닫기·홈 복귀 후 5장 반영. 다른 봉투는 개봉 전 건너뛰어 5장 유지. 미션·전시·QR 진입과 홈 복귀 확인. QR 발급·방문 인증은 이번 검사 범위가 아니다. |
| 실기 200% 글씨 | PASS | 홈 헤더·수치·네 진입이 줄바꿈되고 스크롤 뒤 전시 타일 전체에 접근. 전시의 제목·꾸미기·팩·위시리스트·알림을 겹침 없이 확인. font_scale 1.0 복원. 가게권·미션 상세의 200%와 TalkBack은 NOT_RUN. |
| 테마 | PASS / NOT_RUN | 브라우저 다크와 실기 라이트를 확인. 실기 다크 전환은 NOT_RUN; 시스템 테마는 바꾸지 않았다. |
| 운영/시연 Android export | PASS | 소스 `4ee5dd1aca6ab5edfacfe0552739fcf40625245f`를 지정해 두 variant export와 자산 경계 검사 통과. 기존 환경 파일 제외, 시연 OAuth는 CI placeholder. 서명 APK·공개 배포는 별도다. |

브라우저 화면은 모바일 실기 판정으로 대체하지 않는다. 실기 스크린샷·계정 식별 정보가 포함된 로그는 공개 증거로 올리기 전에 합성 데이터와 민감 내용 여부를 확인한다. 오디오 청음과 진동 체감은 [실기 QA 문서](PHYSICAL_QA_2026-10-06.md)의 별도 결과를 따른다.

## 재현 환경과 화면

기준 main은 `c7ac94af85de12a5f5cb4520838d911168b8cc96`이며, 화면은 이 기준의 `fix/home-overview` 변경 소스를 사용했다. APK 파일 해시와 JavaScript 소스 커밋을 혼동하지 않는다. 설치된 개발 클라이언트에서 `--no-dev`, eager bundle로 로컬 QA API를 연결했다. 실기 계정은 가게권 6장·219P·동행 6명, 브라우저 계정은 개봉 전 6장·246P·동행 6명으로 별도 합성 데이터다. 브라우저 로그인은 loopback 전용 합성 세션 adapter를 통한 UI 진입이므로 실제 Google/게스트 인증 검증을 주장하지 않는다.

화면은 [기본 홈](evidence/home-overview-2026-10-06/home-phone.png), [가게권](evidence/home-overview-2026-10-06/tickets-phone.png), [미션](evidence/home-overview-2026-10-06/missions-phone.png), [전시](evidence/home-overview-2026-10-06/exhibit-phone.png), [200% 홈 하단](evidence/home-overview-2026-10-06/home-font2-phone.png), [200% 전시](evidence/home-overview-2026-10-06/exhibit-font2-phone.png), [384×832 다크 웹](evidence/home-overview-2026-10-06/home-dark-browser.png)에 남긴다. 회색 Tools overlay는 검증 환경에 나타나며 제품 UI로 승인하지 않는다.

API·보상·인증·의존성 변경은 없고 공개 설치 안내가 달라지지 않아 README 수정은 없다. 긴 본문을 홈에서 없애 목적별 상세에 재사용했으며 새 탭 상태 관리나 데이터 계층은 추가하지 않았다.

## 통합 기록

[PR #379](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/379), 브랜치 `fix/home-overview`. 로컬 source-only `tools/gate.sh`는 Git 이력과 staged tree를 보존한 별도 검사본에서 PASS다. 개발 서버의 private 합성 세션 파일을 커밋하거나 검사 대상 소스에 섞지 않았다. 원격 CI는 최신 head에서 확인하고 병합한다.
