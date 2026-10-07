# 홈 균형과 모바일 UX/UI 검증 — 2026-10-07

[Issue #388](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/388). 지도 PR #389의 최종 CI37546309486과 병합 main `c0691e8f` 위에서 진행한다. UI 1차 소스 `23cb0dcb`, 실기 보정 소스 `8e8cac41`의 앱 파일은 각 비공개 후보 APK를 만들 때의 파일 해시와 일치한다. [소스 해시](evidence/ui-refresh-2026-10-07/source-hashes.json), [후보 APK](evidence/ui-refresh-2026-10-07/candidate-1-apk.json), [이전 홈](evidence/ui-refresh-2026-10-07/home-before.png), [후보 기본 홈](evidence/ui-refresh-2026-10-07/home-light.png)을 따른다. 공개 배포와 실제 계정/점주 수용은 별도다.

## 변경 범위

- `screens/home/index.tsx`: 머리글과 탭 바를 제외한 남은 높이에서 요약·네 목적 타일을 중앙 배치한다. 기존 48dp 글리프와 준비된 서버 동행 그림80dp, 실제 탐색 링크를 쓴다. 보유/가게권/마일리지의 로딩·실패를 0으로 바꾸지 않는다.
- `screens/real-map/index.tsx`, `styles.ts`: 위치 도구와 지도 모드 검색·필터는 기존 Fold를 재사용한다. 목록은 검색·필터·결과를 바로 보여주고, 선택 체크·현재 탭 높이의 여백·큰 글씨 검색 영역 스크롤을 적용한다. 위치 사용 안내·취소·수동 출발지와 지도 active/viewport·보행 계약은 보존한다.
- `screens/collection/index.tsx`: 압축 머리글, 앨범과 빈 상태의 다음 음식점 찾기를 먼저 보여준다. 기존 방문·배지·NFT 접힘과 소유/확인 상태는 유지한다.
- `screens/play/index.tsx`: 방 그림 최소 높이를104dp로 줄이고 게임 카드의 반경을 일관화한다. 큰 글씨에서 소개가 늘어날 수 있게 고정 높이를 제거했다. 네 게임 규칙·서버 기록·보상 변경은 없다.
- `screens/shop/index.tsx`, `styles.ts`: 압축 머리글과 잔액 카드 안의 기존 마스코트, 잔액→가격/보유/구매 이유→상품→내역의 계층을 쓴다. 기존 구매 잠금·응답 복구·장착 계약과 API 수치를 유지한다.
- `navigation/tab-glyph.tsx`: 장식 SVG의 별도 접근성 초점을 제외한다. `ui/components.test.ts`, `screens/merchant-list/index.test.ts`의 기존 문구/머리글 기대를 새 UI에 맞췄다. `DESIGN.md`의 현재 다섯 탭과 역사적 그림 지도 기록을 구분했다.

새 의존성·글꼴·샘플 실적·추상화는 추가하지 않았다. 이미 있는 펼침·아이콘·색·그림과 탭 높이 계산을 재사용했다. 인증·API·DB·보상·구매 모델은 바꾸지 않았다.

## 검사와 실기

| 검사 | 결과 | 범위 |
|---|---|---|
| 모바일 전체 단위·타입·lint | PASS 1777/1777 | 전체 검사. 집중 결과는 중복 합산하지 않음 |
| 접근성 semantics·소스 비밀/개인정보 | PASS | fresh tracked source snapshot; private QA 파일 제외, checker 변경 없음 |
| 독립 코드 검토 | PASS | 큰 글씨 배너 잘림 지적 수정 후 필수 블로커 없음 |
| 개인 개발 APK | PASS | 실제 app assembleRelease, 기존 dev 인증서·정상 두 공개 ID·서버 Secret 없음·ZIP16KiB. 운영/시연 공개 빌드로 인용하지 않음 |
| 기본 실기 홈 | PASS | SM-S928N/Android16에서 네 진입·요약·탐색 CTA 첫 화면, 큰 하단 공백 감소, 탭 바와 버튼 겹침 없음 |
| 기본 도감·놀이·상점·탐색 | PASS | 빈 앨범 CTA·네 게임·가격/보유/불가 이유·실제 지도/범위 선택·탭 바 위 패널 버튼 확인 |
| 기본 연결 흐름 | 부분 PASS | 홈 탐색 CTA·가게권/뒤로·미션 진입·위치 도구와 자체 안내 취소. OS GPS 요청/측정 없음 |
| 360dp 기본 홈 | PASS | 실제 고객 홈 재진입 후 요약/네 진입/CTA 첫 화면. 시작 화면 사진을 홈 근거로 쓰지 않음 |
| 다크 홈 | PASS | 실제 UI3 고객 홈의 네 타일/CTA/상태 대비 확인 |
| 320/390dp·다른 다크 탭·200% | NOT_RUN | USB 반복 단절로 검사 중단. source/layout/semantics 검사로 실제 화면 수용을 대체하지 않음 |
| 기기 설정 원복 | 진행 중 | 밀도450/nooverride·font1.0·size원본은 복원 확인. 마지막 다크 홈 검사 뒤 USB가 끊겨 night yes가 남았고 재연결 시 night no 원복 확인이 필요함 |

최종 후보 UI3 SHA256 `d7ff35081ab03a1b6e6e2470ddf3310864f9d52dad0c37d0f7a028efec18d3fb`는 [비공개 APK 검사](evidence/ui-refresh-2026-10-07/final-private-apk.json)를 따른다. UI3의32 native libraries는 16KiB를 검증한 지도 APK와 바이트 해시가 동일하며 SDK/probe없음·금지 권한 제외·동일 서명을 확인했다. 개발 overlay 권한은 기존대로 있다.

1차 APK SHA256 `f321c49a4b0b150e0df878a2a1b23148a9e955071befb9329a17e3cd0728bf3c`, 패키지 `kr.masscom.wolgye.dev`, 기존 debug 인증서 SHA256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`다. 설치-r로 사용자 데이터를 유지했다. 비공개 소스/실기 증거와 업데이트된 최종 APK를 분리한다. 첫 미션 화면은 테스트 harness에서 BadgeRewardService를 주입하지 않아 조회 오류가 나타났으며, 그 화면은 오류 상태/뒤로/배치 검증이다. 실제 API의 해당 서비스·엔드포인트 존재와 UI의 데이터 준비 상태 수용을 구분한다.

## 검증 경계

격리된 합성 계정/점포 DB와 로컬 서버를 썼다. 실제 GPS·Google 계정·점주 동의·쿠폰/보상 지급·공개 서버·Play 수용이 아니다. 수정후 NAVER 웹 타일은 브라우저 제어 연결 부재로 NOT_RUN이며 Android 지도는 별도 [지도 QA](TMAP_ANDROID_QA_2026-10-07.md)의 결과다. 이전 소리 청음 PASS·진동 체감 FAIL은 보존하고 UI/코드 검사로 바꾸지 않는다. 실제 TalkBack 낭독·감각·성능 수용을 자동 semantics 검사로 대신하지 않는다.
