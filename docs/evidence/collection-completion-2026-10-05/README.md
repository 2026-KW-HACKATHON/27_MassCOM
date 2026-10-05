# 수집·게임·점주 운영 전체 검증

대상 [Issue #371](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/371), `feat/collection-merchant-completion`, 기준 main `aae64d88`, 2026-10-05 KST. [기능과 설정](../../COLLECTION_MERCHANT_COMPLETION.md)을 함께 읽는다. 아래 실행은 격리된 로컬 DB·개발 앱·에뮬레이터이며 실제 고객 실적이나 공개 배포가 아니다.

## 구현과 연결

| 범위 | 실제 연결 |
| --- | --- |
| 홈·팩 | 대표 동행/배지/코인, 가능한 테마 팩·원하는 목표·알림함, 기존 방문/탐색/놀이 경로 |
| 보상 | 기존 가격과 미보유 캐릭터 보장 + 원장에 고정한 미보유 꾸미기, 3회 테마 완성·동시 요청/재시도 |
| 배지·동행 | 방문/게임 조건·다음 행동, 모자/가방/소품/포즈/장식 실제 장착, 같은 움직임·서버 복원·취소 재검사 |
| 네 게임 | 입력→서버 재계산→최고 기록/실력 배지→꾸미기/공간→재도전, 로그 30일 정리 뒤 성취 유지 |
| 공간·친구 | 현재 관계/동의/소유권, 공개 그림과 장착 상태, 가게 정보/내 방문 목표, 비공개 식별자 제외 |
| 코인·제작 | 기존 센서/끌기/금속/앞뒷면/점주 제작 재사용, 진열 대표 확대와 등급 팔레트·영상 반사 일치 |
| 공유 | 실제 PNG/MP4/WebM 파일, 피드/스토리, Android Photos 저장/재생·중단·공유 창 취소 |
| 알림 | OS 권한 독립 알림함, 종류별 설정, 세션 토큰 수명/계정 전환, 소스 상태/대상/중복/재시도/딥링크 |
| 점주 | 자기 가게 캠페인 연장, 직원 등록 코드 승인·업무 권한·회수, 기간별 인정 방문 CSV |
| 운영 | 기존 가게 조회/인정 방문/첫 방문·재방문/쿠폰 정의 유지. 공유 창·저장과 외부 게시·매출을 구분 |

## 실행 근거

- API 단위 `npm test --prefix apps/api`, 모바일 단위 `npm test --prefix apps/mobile`, 각각 타입 검사와 모바일 lint, API build.
- 실제 PostgreSQL 16: 별도 `masscom_371_full_test`의 `npm run test:postgres --prefix apps/api`, 동시 연장·직원/삭제 경합·CSV·기기/세션·알림 소스 변경·친구 해제·취소·영구 성취·미보유 보너스/과거 원장/구 API INSERT 포함. 최종 수치는 summary.json을 따른다.
- `node --test 'tests/site/*.mjs'`507/507, 웹 Blob CSV 다운로드와 범위/응답·공개 정책/동의 판독 포함.
- 실제 Chrome 390×844 로컬 웹: 개봉→대표 설정→장착, 네 게임 각각 완주(타이밍88, 기억600, 배달630, 주문1125점)→기억/주문 배지와 노을 방 해금→배지/소품 장착→공간 저장. 자동 조작 기반이며 사람의 실력을 증명하지 않는다. 기억의 시간 초과 0점은 완주/배지로 올리지 않는 것도 확인했다.
- Android 개발 앱 arm64 APK 실제 빌드/설치, 에뮬레이터(실제 API 수준은 summary.json), MediaCodec H.264 + MediaMuxer, MediaStore/Photos. 외부 게시·전송은 공유 대화상자에서 실행하지 않았다.
- 스토리 자체 설계: 상단270px/하단384px 비워 중앙에 필수 문구 배치, 확대 대표 코인·동행·배지. 실제 PNG와 디코딩 영상 OCR7개 모두 Y270–1536 안, 관측 범위 Y320.93–1487.44. 공식 플랫폼 승인/실제 Instagram 게시 검증은 아니다.
- 인코딩 성능: 에뮬레이터 스토리 탭→저장 11.02초, 다른 부하 조건에서17.76초. 최적화 전 관측 약1분, 직접 수치 비교의 전후 기준은 다르므로 배수 향상을 주장하지 않는다. bulk YUV row/재사용 Canvas, 독립 MAIN 취소, 이동 중단 시 캐시 삭제·새 MediaStore0개를 확인했다. 최종 피드 warm 실행은 탭→저장5.54초이며 동일 조건의 전후 비교 수치는 아니다. 물리 기기 성능은 NOT_RUN.
- 등급: 실제 C의 브론즈 데이터와 브론즈 팔레트를 이미지/영상에 사용한다. 앞선 무조건 금색 테두리는 수정 전 재현이며 최종 근거로 쓰지 않는다.

## 결과물

[최종 피드 PNG](native-feed-final.png), [피드 H.264](native-feed-final.mp4), [피드 Photos](native-feed-final-gallery.png), [최종 스토리 PNG](native-story-safe-saved-image.png), [4초 H.264](native-story-safe.mp4), [영상 프레임](native-story-safe.mp4-1.png), [Photos 재생](story-safe-native-playback.png), [Photos 이미지](story-safe-image-gallery.png), [문구 위치](story-safe-text-bounds.json), [영상 메타데이터](native-story-safe.metadata.txt), [파일 SHA256](files.json).

피드·스토리 크기 PNG와 MP4, 실제 Chrome MP4 및 MP4 지원을 가린 WebM fallback도 인코딩·디코딩과 올바른 확장자를 확인했다. 코드 기반 Chrome 검증은 실제 인코더와 캡처한 레이어를 사용하며 인코더 성공을 UI 버튼/외부 게시 성공으로 바꾸지 않는다.

## 실패 수정과 보존

첫 CI의 웹 동의 안내 불일치를 기존 시험으로 재현해 HTML 두 줄을 고쳤다. 최초 로컬 시험의 `.test.mjs` 범위에서 빠진 `_test.mjs`도 함께 실행해 전체 웹507/507 PASS했다. 첫 실패를 최종 성공으로 덮어 쓰지 않고 PR 검사 이력과 함께 기록한다.

기존 .env.local이 Expo57 virtual env에 합쳐져 옛 주소·로그인 조건을 덮어쓰는 것을 실제 네트워크/단말로 확인했다. 빌드/QA 동안만 분리하고 SHA256·0644·mtime 원상 복구했다. 글꼴 배율2.0 복원, QA Metro 종료, 다른 운영/시연 설치본과 이전 미추적 export는 보존했다. 에뮬레이터 공간 부족은 QA dev package 데이터 보존과 arm64 APK로 복구했다.

단위 helper의 1×1 PNG를 사용한 과거 QA A 자료가 실제 Android 디코딩에 실패했다. 기존 스냅샷을 덮어쓰지 않고 격리 DB에서 실제 제작 서비스로 포함된 C 그림을 게시·방문해 새 정상 수집품을 얻었다. 잘못된 자산 때 공유를 성공으로 표시하지 않는다.

## 확인하지 않은 항목

- FCM 실제 수신·탭 이동: 일치하는 google-services.json/프로젝트/서비스 계정 미설정. 모의 HTTP v1 성공과 실제 수신을 구분한다. 구현 안내의 정확한4개 설정을 적용하고 최신 dev/release 앱으로 확인한다.
- 공개 운영/시연 DB migration·API/웹·공개 APK·Google Play: NOT_RUN. 코드 통합/CI로 배포를 대신 주장하지 않는다.
- 실제 점포 QR·점주 Google 세션, 물리 기울임·효과음/진동 체감·TalkBack: NOT_RUN. 자동·에뮬레이터 확인과 구분한다.
- 기존 hosted seed3건: 55435의 새 전용 컨테이너 조건이 없어 전체 DB 시험에서 SKIP. 별도 환경 요구이며 이번 기능 시험 실패가 아니다.
- 설치된 Excel/Numbers에서 CSV 열기: NOT_RUN. 한글 UTF-8 BOM·정상 CSV 파싱·필터 수치·수식 방어·웹 Blob 다운로드는 실제 파일 바이트/시험으로 확인했다.
- 작업 디렉터리 전체 빠른 검사: 기존 사용자 환경/ignored QA 산출물의 비밀 탐지 경고. 검사를 끄거나 사용자 파일을 지우지 않고 실제 스테이징 소스·원래 Git 이력을 가진 깨끗한 복사본에서 검사한다.

실행 수치·명령 출력은 [summary.json](summary.json)·[checks.txt](checks.txt), 실제 네 게임 기록과 저장한 공간은 [games-and-space.json](games-and-space.json)·[실제 웹 저장 화면](web-games-saved.png)을 따른다. 구현 커밋은 `e70699a8`, [통합 PR #372](https://github.com/2026-KW-HACKATHON/27_MassCOM/pull/372)의 최신 검사·병합 기록이 CI와 코드 통합 상태의 근거다. 공개 배포와는 별도다.
