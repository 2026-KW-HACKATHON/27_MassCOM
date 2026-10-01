# 고객 도감 수집 경험 에뮬레이터 확인 (Issue #283, PR #287)

- 날짜: 2026-10-01 KST
- 환경: Android 에뮬레이터 AVD `MassCOM_Design_QA`(720×1280, 다크 모드, 글자 200%), 개발 앱 `kr.masscom.wolgye.dev`, 로컬 API와 임시 PostgreSQL(시연 시드), 로컬 데모 계정. 운영·시연 서버와 실제 계정은 쓰지 않았다.
- 수집품 그림: 시험용으로 만든 단색 동전·우표 이미지다. 실제 점포 사진이 아니다.

| 파일 | 내용 |
| --- | --- |
| `reveal-coin-opening.png` | 동전 모양 수집품의 획득 연출 시작(건너뛰기 버튼 보임) |
| `reveal-coin-stored.png` | 이름·가게·등급·대사와 "도감에 보관했어요" |
| `reveal-stamp-stored.png` | 우표 모양 수집품의 도장 연출 끝, 마스코트와 "자세히 보기·닫기" |
| `browser-filtered-duplicate.png` | 수집품 모아보기: 가게 거르기, 정렬, 중복 획득 개수 배지 |
| `browser-duplicate-dates.png` | 중복 획득 묶음의 받은 날짜 |
| `browser-favorites.png` | 대표 진열 줄 |
| `detail-coin.png` | 연출 뒤 열리는 수집품 상세 |

## 판정과 한계

- PASS: 획득 연출(동전·우표), 건너뛰기, 모아보기 거르기·정렬, 중복 묶음, 대표 진열, 상세 열기.
- 결함 발견 → 수정: 마스코트 반응 배너가 떠 있는 탭 바 뒤에 깔려 잘렸다. 배너를 탭 바 위(`useTabBarClearance`)로 옮기고 6초 뒤 스스로 닫히게 고쳤다. 고친 뒤 화면 재촬영은 `NOT_RUN`.
- `NOT_RUN`: 라이트 모드·글자 100% 캡처(촬영 중 세션 한도로 QA가 중단됨), 공유 시트 화면, 가게별 시리즈 빈 칸 화면, 동작 줄이기 정적 연출, 실기(Samsung) 확인, 운영·시연 설치본.
