네이티브 검증은 Android 16(API 36), arm64 에뮬레이터에서 실행했다. 개발 앱 `kr.masscom.wolgye.dev`, APK `0.1.0-test.2`에 새 Kotlin 영상 모듈을 빌드·설치하고 보정된 개발 번들을 불러왔다. 로컬 합성 데이터만 사용했으며 운영 서버·실제 Google 로그인·실폰의 검증을 의미하지 않는다.

APK SHA-256: `7d64c700227dd99eb32af021f22d4b779f439d84c3461fb758c7d398ad76f339`.

| 검사 | 실제 증거와 결과 |
| --- | --- |
| 네 동행의 착용·공간 합성 | 냥이·토끼·부엉이·호랑이의 `final-*-home.png`, `final-*-studio.png`. 보정된 모자 아래 눈이 보이며 소품 옆 조각이 제거됨 |
| PNG 저장 | [피드](final-feed.png) 1080×1350, [스토리](final-story.png) 1080×1920 |
| H.264 저장·디코딩 | [피드 영상](final-feed.mp4) 1,374,915바이트, [스토리 영상](final-story.mp4) 1,407,623바이트. 두 규격 모두 4초, AVC(`avc1`), 서로 다른 시점의 3프레임 디코딩·변화 확인. 각 `*.metadata.json`과 `*.mp4-frame*.png` 참조 |
| 갤러리 표시 | [보정된 스토리 영상 표시](final-story-gallery-loaded.png) |
| 최초·반복 PNG | [반복 피드 이미지](final-feed-cached.png)와 최초 피드의 바이트가 동일. SHA-256 `82287c46ab82c3f3edb2d528a16c85a0b28f473f98f37be7484f753529726c37` |
| 공유 취소·재진입 | 최종 공간→홈→공간 흐름 전후 MassCOM 저장 영상 11→11개. [취소 검증](cancel-refocus-proof.json). 별도 녹화는 공유 수명 수정 직후 1차 화면이며 최종 모자 위치의 증거로 사용하지 않음 |
| 글자 배율 2.0 | [다크 홈](a11y-home-dark-font2.png), [상점 버튼](a11y-shop-button-font2.png), [꾸미기](a11y-wardrobe-badges-font2.png), [게임 준비](a11y-game-prep-buttons-font2.png), [결과 버튼](a11y-game-result-buttons-font2.png): 주요 문구·컨트롤이 읽히고 스크롤로 접근 가능 |
| 라이트·짧은 화면 | 720×1000에서 [게임 결과 컨트롤](a11y-game-results-short-scroll.png), [홈 제목·계정](a11y-home-light-short-font2.png), [지도·꾸미기 링크](a11y-home-light-short-scroll.png) 확인. ‘다른 놀이’ 버튼의 실제 이동도 확인 |

집계는 [미디어 검증 JSON](final-capture-proof.json), [접근성 검증 JSON](a11y-final-proof.json)에 복사본 상대 경로로 기록했다. 글자 배율 2.0, 원래 다크 모드, 화면 720×1280을 복원했고 담당 Metro와 임시 환경 변경을 정리했다.

실제 보유 데이터를 사용한 네이티브 미디어는 원형만 검증했다. 우표·톱니의 실제 네이티브 저장, 새 네이티브 획득 결과(구매 금지), 다른 장르의 네이티브 결과, TalkBack, 실폰, Instagram 게시 수용은 `NOT_RUN`이다. 0점 결과 화면은 실제 쌓기 시간 만료로 확인했으며 완주·배지 획득으로 기록하지 않았다. 이후 장식·모달 수정의 최종 실행 증거는 별도 화면 검증 범위다.
