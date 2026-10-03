# 사장님 사진 수집품 제작기

## 근거와 작업 범위

2026-09-30 사용자가 전달한 `월계_마스코트_개발전달_최종기획노트.docx`를 저장소 기준 커밋 `4081999eb2e7741eb2dac455e9f751ef7b795ea4`의 실제 코드와 대조했다. 사용자의 실제 코드 반영 요청에 따라 점주 웹의 제작기, 비공개 초안·게시 버전, 기존 방문 보상과 연결되는 외형, 고객 웹과 운영·시연 Android 공통 코드의 획득품 상세 경로를 추가한다. 문서의 예시 수치·제안·정책을 과거의 사용자 승인으로 바꾸지 않는다.

이 문서의 수용 기준은 구현을 확인할 기준이다. 표에 경로를 적었다는 사실만으로 실기기·운영 배포·메모리 측정이 통과했다는 의미는 아니다. 명령별 실행 결과와 `PASS / FAIL / BLOCKED / NOT_RUN`은 [TEST_STATUS.md](TEST_STATUS.md), 현재 후속 작업은 [HANDOFF.md](HANDOFF.md)에 기록한다.

사장님 얼굴 사진은 필수가 아니다. 가게·메뉴·간판 사진을 사용할 수 있다. 기존 이름·메뉴 기반 AI 그림 기능은 그대로 유지하며, 새 사진·녹음 경로는 OpenAI에 자료를 보내지 않는다. 사진 편집과 수집품 렌더링은 브라우저에서 실행하고, 저장 자료는 권한 있는 점주 API와 보유자 전용 상세 API를 통해서만 읽는다. 공개 미디어 URL·자동 공유·GPS 상시 추적을 추가하지 않는다.

## 기존 구현과 새 기준의 관계

| 기존 근거·코드 | 이번 변경과의 관계 |
| --- | --- |
| D-036·D-045·D-048의 실제 점포 사진 제한 | 새 사진 제작기에서는 점주가 직접 올린 얼굴·가게·메뉴·간판을 사용한다. 이전 일러스트 기능의 금지 프롬프트는 사진 제작기의 제약으로 재사용하지 않는다. 가짜 점포 실적, 보유하지 않은 수집품, 실제 NFT 증거처럼 보이는 표시는 계속 금지한다. 과거 확인 기록 자체는 당시 기록으로 보존한다. |
| `apps/api/src/ai-art-rules.ts`, `apps/mobile/src/screens/merchant-art/` | 이름·메뉴로 AI 시안 4장을 받는 기존 기능이다. AI 시안 4장은 제작기의 기본 등급 4종과 별개다. 새 제작기의 사진·스티커·대사를 기존 AI 프롬프트로 몰래 전송하지 않는다. |
| `apps/api/migrations/0029_merchant_art.sql` | 가게당 현재 대표 그림 한 장과 생성 라운드다. 여러 제작 프로젝트·재편집 원본·획득 당시 외형 버전을 이 표의 대표 그림 교체로 처리하지 않는다. 새 제작기 저장 구조를 추가한다. |
| 탐험 메달의 `MedalTier`, `gamification/medallion.tsx` | 방문 실적으로 서버가 계산하는 기존 메달이다. 제작기의 브론즈·실버·골드·프리즘·특수등급은 외형 목록이며 메달 계산을 변경하지 않는다. 기존 메달의 둥근 테두리를 새 톱니 모양의 구현으로 간주하지 않는다. |
| D-004·D-005·D-006, 기존 방문·보상·NFT | 조건 공개형 보상, 기존 방문 목표, 양도 제한, 선택적 NFT를 유지한다. 제작 등급을 무작위 뽑기·새 방문 보상·NFT 등급으로 자동 연결하지 않는다. |
| D-038·D-039, 점주 권한 | 운영 Android는 고객 화면을 유지한다. 제작은 별도 점주 웹 채널에서 제공하며 서버 점포 권한을 검사한다. URL·역할 선택·제작 등급 생성만으로 점주 권한을 주지 않는다. 가상 점포·체험 데이터는 운영 DB로 복사하지 않는다. |

## 제작과 획득 흐름

1. 권한 있는 점주가 내 점포의 수집품 프로젝트를 만들거나 저장한 초안을 연다.
2. 대표 사진 한 장을 고르고 원형·우표·뾰족한 톱니를 선택한다. 사진을 실시간으로 이동·확대하여 자른다.
3. 원본 색·음각·양각을 비교한다. 고급 패널에서 보정·스티커·효과·등급·동작·두께·대사·음성·가게 이야기를 선택한다.
4. 현재 미리보기 등급 한 개와 효과·동작을 적용할 복수 등급을 각각 조작한다. 고급 입력을 하지 않아도 기본 결과를 만들 수 있다.
5. 초안으로 저장한다. 게시할 때 같은 점포의 기존 캠페인과 기존 목표에 표시할 외형을 명시적으로 연결한다.
6. 이후 기존 방문 인증·보상권 생성이 정상 완료되면 해당 보상에 연결된 게시 버전의 외형을 보관한다. 애니메이션·음성·장면은 보상 생성의 성공 조건이 아니다.
7. 고객은 도감의 정적 썸네일에서 보유자 전용 상세를 열어 회전·대사·음성·가게 이야기를 다시 본다. 장면을 건너뛰거나 소리를 끄더라도 획득 기록은 남는다.

기존 캠페인의 1·3·5회는 새로 만든 요구 수치가 아니다. `rewardGrades`는 이 기존 목표에 **외형만** 연결하는 항목이다. 초기값은 빈 객체이며, 점주가 선택하기 전 자동 연결하지 않는다. 이미 획득한 보상에 새 게시물을 소급해서 붙이거나, 등급 추가·시즌 변경으로 보상 횟수·확률·NFT를 변경하지 않는다.

## 요구사항과 수용 기준

| 원문 범위 | 확인해야 할 동작 | 구현 연결 |
| --- | --- | --- |
| 1·3·4·21.1: 사진과 모양 | 얼굴·가게 사진 모두 사용 가능. 원형, 직사각 우표의 안쪽 구멍, 하나로 이어진 24개 뾰족한 톱니를 구분. 원본과 편집 좌표를 별도 저장. 자르기·완성품·테두리의 외곽이 일치. | `collectible-model.mjs`의 모양·자르기 정의, `collectible-editor.mjs`, `collectible-renderer.mjs` |
| 4·21.1: 자르기 | 틀 바깥만 반투명하게 어둡고 안쪽은 선명. 이동·확대 조작 즉시 반영. 외곽과 안전 영역 구분. 모양 변경 후 사진·위치 유지. 반복 편집으로 원본을 다시 압축하지 않음. | 편집기의 자르기 캔버스, 렌더러의 같은 외곽·원본 좌표 |
| 5·21.1: 보정 | 잡티 붓, 투명 지우기·복원, 영역 색 정리, 비슷한 색 합치기, 단순화, 만화 필터, 밝기·대비. 붓 크기·경로가 즉시 보임. 체크무늬와 원본 비교, 되돌리기·다시 실행 제공. | `photoEdits`와 원본 기준 붓 좌표, 렌더러 픽셀 처리, 편집기 이력 |
| 6·21.1: 스티커 | 텍스트·이모티콘을 별도 요소로 추가. 선택·이동·크기·회전·앞뒤 순서. 등급을 바꿔도 위치 유지. 개별 요소의 효과와 전체 표면 효과 구분. 최종 모양으로 외부 요소를 자름. | 안정적인 스티커 ID, `target` 참조, 편집기와 렌더러 |
| 7·8·21.2: 등급과 테마 | 기본 4종과 특수등급의 데이터 목록. 미리보기 한 개와 효과 복수 적용을 분리. 비활성 회색, 활성 색·체크. 모두 끄면 효과를 삭제하지 않고 미적용 안내. 테마 변경으로 등급·효과·보상 연결을 자동 변경하지 않음. | `grades`, `effects[].gradeIds`, `motion[].gradeIds`, 독립 `theme`, 모델 등급 토글 |
| 9.1~9.5·21.2: 요청한 재질 | 원본 색 반영·단색 기본색·대비·깊이 조절. 음각·양각의 명암 방향을 구분하며 단순 회색 필터로 끝내지 않음. 메탈릭 강도·거칠기·사진색 반영. 홀로그램은 회전에 반응하고 어느 등급에도 적용 가능. | 렌더러의 색·명암·방향성 반사, 효과별 대상·등급 |
| 9.6~9.10·21.2: 제공한 추가 선택지 | 펄·무광·에나멜·유리·발광은 이번 구현의 선택 기능. 서로 읽기 어려운 조합은 강도와 대상 변경으로 조절. 투명 사진 지우기와 유리 재질을 구분. | 추가 효과 렌더링과 UI 설명. 이 목록을 모든 향후 효과의 고정 제한으로 사용하지 않음. |
| 10·12·21.3: 동작·회전·두께 | 공통 기본 동전의 정적 템플릿 목록, 선택 항목만 재생. 정지·재생·다시 보기. 선택된 완성품만 회전. 각도·두께 값은 drag 중 즉시, 완성 결과는 release 후 갱신. 최신 결과만 적용. 측면 두께와 모양·기본 뒷면 확인. | 공통 템플릿과 렌더러, 편집기 렌더 요청 순서 관리 |
| 11·21.4: 가게 이야기 | 사진 한 장으로 확대. 넓은 사진, 추적할 장면, 시작·행동·결과 자료가 필요한 유형을 구분. 사진 밖 공간이 자동 복원된다고 설명하지 않음. 만화 스타일 적용과 건너뛰기·다시 보기. 추적 유형은 마스코트 이동과 카메라 이동이 있음. | `story`, 렌더러의 기본 확대·넓은 장면·추적·단계 장면, 고객 상세 |
| 13·21.4: 대사·음성 | 텍스트만으로 제작 완료. MP3 업로드·브라우저 직접 녹음. 시작·정지·미리 듣기·다시 녹음·삭제. 권한 거절·처리 실패에도 텍스트로 계속. 획득 성공과 음성 재생 분리. | `greeting`, 선택 `audio`, 편집기 미디어 조작과 고객 상세 |
| 14·15·18·21.5: 프로젝트 | 여러 프로젝트, 초안 복원·명시 저장·복사. 시즌 테마 독립. 게시 결과를 원본/편집과 분리. 새 게시 버전 때문에 기존 보유품이 바뀌지 않음. 미완료 고급 패널 때문에 기본 게시를 막지 않음. | API 프로젝트·게시·획득 스냅샷, 점주 제작 목록 |
| 16·19·21.5: 도감·오류·성능 | 도감 목록 정적·상세에서 재생. 텍스트 정보 유지, 음소거·동작 줄이기. 업로드·녹음·렌더·저장 실패 안내와 입력 보존·재시도. 선택 한 등급 렌더, 공통 자원 재사용, 교체 자원 정리. | `collectible-viewer.mjs`, 고객 도감, 렌더 캐시·수명 관리 |

획득 순서의 포장·도장·수집품·대사·장면은 원문의 서비스 연결 제안이다. 실제 보유 기록을 확인한 뒤 상세 연출을 제공하며, 별도 연출을 새로운 보상 성공 조건으로 넣지 않는다. Android는 방문 수령이 끝난 뒤 도감을 읽어 받은 보상 중 제작 외형(`artwork`)이 실제로 붙은 것이 하나라도 있으면 성공 화면에 `받은 수집품 보기`를 보이고(1·3·5회가 함께 지급돼 여럿이면 외형 붙은 것 전부를 목표 순서대로, 도감 조회가 실패하거나 외형 붙은 것이 없으면 버튼만 생략), 그 보상권 전부를 봉투 열기 연출(Issue #297, `apps/mobile/README.md#봉투-열기-연출-issue-297`)로 연다 — 봉투를 열면 카드가 한 장씩 뒤집히고, 끝 카드의 "자세히 보기"가 첫 보상권을 인증된 도감 상세로 연다. 새 제작 외형이 없는 기존 보상은 버튼 없이 보관 성공을 유지한다.

Android 고객 구현은 `apps/mobile/src/commerce/collectible-artwork.ts`, `commerce-api.ts`, `screens/collection/index.tsx`, `screens/collection/collectible-detail.tsx`, `screens/collection/collectible-motion.ts`, `screens/claim-redeem/index.tsx`에 있다. 목록은 정적 썸네일이며 상세를 열 때만 보유자 API로 전체 자료를 읽는다. 회전·측면 두께·각도 release 갱신·대사·수동 음성 재생·음소거·장면 다시 보기·건너뛰기·마스코트 추적을 제공한다. 저장된 정지·회전·떠오름·빛 지나감·도장·반짝임·맥박·짧은 축하 동작을 재생하며, 다시 보기마다 동작과 장면의 시간을 처음부터 시작한다. 닫기·탭 이탈·계정 변경·백그라운드 진입에는 재생을 멈추고 늦게 도착한 상세 응답을 버린다. `expo-audio`는 재생만 사용하며 마이크·백그라운드 재생 권한을 추가하지 않는다.

웹 렌더러는 대상별 재질을 각도에 맞춰 다시 합성한다. Android는 원본을 내려받지 않고 게시된 완성 정면 이미지를 회전·측면으로 합성하므로 홀로그램·메탈릭의 빛이 각도마다 다시 계산되지 않는다. Android의 빛 지나감·반짝임 동작은 완성 이미지의 투명 영역을 피하는 별도 빛 합성이며, 개별 재질 마스크의 재계산을 대신하지 않는다. Android 장면도 이미 게시한 이미지·프레임을 이동하며 만화 필터를 다시 계산하지 않는다. 웹과 같은 재질/스타일 재계산은 남은 확장이다. 이 차이를 실기기 검증 완료나 원문 수용 기준 전체 충족으로 기록하지 않는다.

**Android v2 표현(WP4, Issue #284, 2026-10-01):** 보유자 응답의 `backImageDataUrl`/`angleFrames`/`living`/`motions`는 전부 선택이며, 한 필드가 유효하지 않으면(`collectible-artwork.ts`) 그 필드만 버리고 나머지는 그대로 보여준다(상세 전체를 거절하지 않는다) — 웹 편집기가 아직 뒷면·프레임·living을 만들지 않는 수집품은 v1 그대로의 모습이 폴백이다. 있으면: 뒷면은 `backImageDataUrl`, 정면은 각도 프레임 스프라이트의 가장 가까운 두 칸을 섞어 보여주고(`angleFrameBlend`, 공유 벡터는 `particleAt`과 함께 `collectible-motion.ts`), living picture는 `box` 안에 잘린 스프라이트 칸을 주기적으로 바꾸며(`livingCell`), confetti 계열 모션은 `motion.particle` 종류(confetti/snow/petals/sparkles)로 입자 모양을 고른다. 회전 애니메이션·장면 재생·living 칸 갱신은 60ms 티커 하나로 돈다(예전엔 인터벌이 둘이었다). 모션 자동재생은 방문 수령 직후 상세를 열었을 때만(`intro` prop) once 모션을 순서대로 보여준 뒤 첫 loop 모션으로 넘어가고, 나중에 도감에서 열면 loop 모션만 자동재생하며 "획득 장면 다시 보기" 버튼으로 once 모션을 다시 재생한다(`motionAutoplaySequence`). "기울여 보기" 토글은 새 `collectible-tilt.tsx`의 `<TiltSensor>`가 이미 설치된 Reanimated `useAnimatedSensor(GRAVITY, {interval:50})`를 쓰고(새 의존성·새 권한 없음) 토글이 켜져 있고 동작이 허용되고 앱이 foreground일 때만 마운트하며, atan2·2° 데드존·저역통과·±30° clamp는 `collectible-tilt-math.ts`의 순수 함수다. 동작 줄이기에서는 자동재생·기울임이 꺼지고 living은 0번 칸에 고정되며 파티클은 없고, 수동 각도 슬라이더만 여전히 프레임을 바꾼다. 실기기·에뮬레이터 검증은 이제 WP3(웹의 프레임·living 생성)가 끝나 산출물이 생기지만, 이번 WP3 세션에서는 아직 실행하지 않았다(`NOT_RUN`, 다음 담당자 몫).

## 저장 계약

서버 래퍼는 `{ id, merchantId, version, status, publicationId, createdAt, updatedAt, project }`다. 서버 식별자·작성자 권한·수정 버전을 클라이언트 편집 데이터에 섞지 않는다. `project`의 `schemaVersion`은 2([Issue #284](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/284) WP1부터, 추가 전용이며 v1은 서버가 자동으로 올린다)이며 다음 의미를 저장한다.

| 필드 | 의미·단위 |
| --- | --- |
| `name`, `theme.name`, `campaignId` | 수집품 이름, 독립 시즌 이름, 선택한 기존 캠페인 ID. 초안의 캠페인은 비어 있을 수 있음. |
| `photo.originalDataUrl`, `width`, `height` | 선택한 원본 자료와 크기. 자른 결과를 다음 편집의 원본으로 덮어쓰지 않음. 사진 없는 초안은 빈 문자열·0×0. |
| `shape`, `crop` | `circle / stamp / serrated`. 원본 fit-cover 기준 이동 `x/y`는 -1~1, `zoom`은 1~8. |
| `photoEdits` | 밝기·대비 -100~100, 합치기·단순화·만화 강도 0~100. 붓 도구·원본 0~1 좌표·크기·색. |
| `style`, `baseColor`, `photoColor`, `relief` | 원본·음각·양각, 단색 바탕, 사진색 반영과 명암 깊이 0~100. |
| `stickers` | ID·텍스트/이모티콘·내용·0~1 위치·512px 기준 크기·회전·색·순서. ID는 표시 내용과 독립. |
| `grades` | ID·표시 이름·`basic / special`·사용 여부. 이름을 바꿔도 참조 ID 유지. 기본 ID는 `bronze / silver / gold / prism`. |
| `effects` | ID·종류·대상·복수 등급 ID·강도·색·거칠기. 대상은 `surface / photo / border` 또는 스티커 ID. 빈 등급 목록 허용. |
| `motion` | ID·템플릿·복수 등급 ID. 미리보기 UI가 고른 등급을 바꿔도 적용 목록 유지. |
| `thickness`, `angle` | 이번 2차원 측면 합성의 두께 1~24, 수동 각도 -180~180. 물리적 제작 단위가 아님. |
| `greeting`, `audio` | 공통 대사, 선택 음성 data URL·MIME·길이. 음성이 없어도 정상 프로젝트. |
| `story` | 없음·확대·넓은 장면·추적·사건 유형, 추가 프레임과 크기, 만화 스타일·강도. |
| `derived` | 등급 ID별 완성 정면 이미지와 정적 썸네일. 웹의 대상별 재질 재생에 쓰는 바탕·대상 마스크 같은 파생 자료도 원본·편집 상태와 별도. |
| `rewardGrades` | 기존 목표 문자열 `1 / 3 / 5` 중 명시적으로 선택한 목표와 제작 등급 ID. 빈 초안 초기값. |

### v2 추가 필드 (Issue #284 WP1, 2026-10-01)

기존 필드는 그대로 두고 다음만 더했다. v1 프로젝트를 열거나 저장하면 서버(`upgradeCollectibleProject`)와 편집기(`upgradeProject`)가 아래 기본값으로 자동으로 채운다(멱등, 같은 값을 다시 올려도 그대로).

| 필드 | 의미·단위·상한 | v1→v2 기본값 |
| --- | --- | --- |
| `stickers[].align`, `stickers[].layouts` | 텍스트 정렬 `left / center / right`. `layouts`는 등급 ID별 `{x,y,size,rotation}` 재배치(최대 16, 키는 등급 ID만). `kind`에 `mascot`이 늘어 `text`가 승인된 포즈 이름(`MASCOT_POSES`)이 됨. 텍스트는 80자·4줄(`\n`)까지, `\r`·`\t` 금지. | `align:'center'`, `layouts:{}`, 개행/탭은 공백 하나로 합침 |
| `back` | `{mode:'default'|'custom', color, stickers}`. 기본은 바탕색·가게 이름·수집품 이름·등급·마스코트 도장을, 커스텀은 뒷면 전용 스티커(최대 10, 앞뒤 통틀어 ID 유일, 등급별 배치 없음)를 쓴다. | `{mode:'default', color:baseColor, stickers:[]}` |
| `motion[].playback`, `motion[].particle` | 재생 방식 `once / loop`. `particle`은 `confetti / snow / petals / sparkles`이며 `type==='confetti'`일 때만 값을 가질 수 있다(다른 종류에 값이 있으면 거절). | `playback:'loop'`, confetti면 `particle:'confetti'` |
| `greetingOverrides` | `{id, gradeIds, themeName, text}` 목록(최대 16). 등급+테마가 모두 맞는 항목 > 등급만 > 테마만 > 기본 `greeting` 순으로 고르고, 동점은 배열에서 먼저 온 항목이 이긴다. `gradeIds`가 비고 `themeName`도 빈 항목은 저장하지 않는다. | `[]`(기본 인사말만 씀) |
| `parallax` | `{strength:0~100, strokes}`. 획은 `fg/bg` 도구·굵기 0.01~0.2·점(최대 100개 획, 획당 점 1,000개, 사진 0~1 좌표). | `{strength:0, strokes:[]}` |
| `living` | `{periodMs:1000~4000, items}`(항목 최대 4). 항목은 `sway/bob/steam/blink` 종류, 대상은 `region`(획 1~20점) 또는 앞면 스티커 ID(획 없음), 등급 목록, 진폭 0~100, 중심점. `blink`는 오직 `MASCOT_BLINK`에 있는 포즈의 mascot 스티커만 대상으로 삼을 수 있다(지금은 그림이 없어 빈 목록이라 항상 거절됨). | `{periodMs:2400, items:[]}` |
| `derived[g].backImageDataUrl` | 뒷면 완성 이미지, 512px 이하·256 KiB 이하. PNG/WebP만(JPEG 금지, 아래 스프라이트 형식 제한 참고). | 없음. **지금 게시를 막지 않는다**(아래 게시 준비 참고) |
| `derived[g].angleFrames` | `{dataUrl, side:256~512, count:12, columns:4, stepDegrees:15}`. 스프라이트는 정확히 가로 4칸×세로 3칸(`4·side × 3·side`), 1 MiB 이하. 칸 i의 각도는 `−82.5°+15·i`. `dataUrl`은 PNG/WebP만. | 없음. **지금 게시를 막지 않는다** |
| `derived[g].living` | `{dataUrl, count:8~24, columns:1~8, cellWidth/cellHeight:16~512, periodMs, box:{x,y,w,h}(0~1, x+w≤1, y+h≤1)}`. 스프라이트 크기는 `columns·cellWidth × ⌈count/columns⌉·cellHeight`, 4096px·512 KiB 이하. `dataUrl`은 PNG/WebP만. | 없음 |

패럴랙스·living 획의 점 합계는 프로젝트 전체 20,000개를 넘을 수 없다. 파티클·각도 프레임 배합의 순수 계산(`resolveSticker`·`resolveGreeting`·`particleAt`·`angleFrameIndex`)은 `collectible-model.mjs`에 있고, 서버 `collectible-project-rules.ts`가 같은 값을 내는지 공유 벡터 픽스처(`tests/fixtures/collectible-vectors.json`)로 맞춘다.

**스프라이트 형식 제한(`backImageDataUrl`·`angleFrames.dataUrl`·`living.dataUrl`만):** 이 셋은 PNG·WebP만 받고 JPEG는 거절한다(다른 이미지 필드는 여전히 PNG/JPEG/WebP 모두 허용). JPEG의 EXIF `Orientation` 태그는 브라우저가 표시할 때 픽셀을 돌려 보여 주는데, 이 세 필드는 픽셀 좌표로 그대로 자르고 배치하는 스프라이트라 그 회전이 반영되지 않는다(가로 1024×세로 768로 선언한 스프라이트가 Orientation=6이면 실제로는 세로로 찍혀 있을 수 있음). 편집기도 이 셋은 WebP/PNG로만 만든다.

**게시 준비(등급별, 캠페인 목표에 실제로 연결된 등급만, PR #293 리뷰로 2026-10-01 재확정):** `living`은 어떤 living 항목이든 그 등급을 목록에 넣었으면 필요하고, 없으면 게시가 409 `COLLECTIBLE_NOT_READY`다. **`backImageDataUrl`은 선택으로 남긴다** — 새 편집기의 `serializeDerived`는 연결된 등급마다 항상 뒷면 이미지를 만들지만, 배포 스큐 동안 이미 열려 있던 구 편집기 탭이나 v1에서 올라온 기존 프로젝트는 이 필드 없이 게시를 시도할 수 있어 필수로 두면 그 순간 게시가 전부 막힌다. 클라이언트는 없을 때 기존 모습으로 대체한다. **`angleFrames`는 영구히 선택으로 남긴다(WP3 완료 뒤에도)**: 편집기(`serializeDerived`)는 WP3부터 metallic/hologram/pearl 효과가 있거나 패럴랙스가 켜진 등급에 실제로 각도 프레임을 만들지만, 배포 스큐 동안의 구 편집기 탭·v1 프로젝트가 이 필드 없이 게시를 시도할 수 있어 `backImageDataUrl`과 같은 이유로 필수로 좁히지 않는다. 클라이언트는 없을 때 정면 이미지를 그대로 회전해 보여 준다.

**의도적 완화:** `stickers[].align/layouts`와 `motion[].playback`은 서버에서 여전히 선택 항목이다(없으면 위 기본값을 채운다) — WP2 편집기는 항상 이 필드를 채워 보내지만, 과거에 저장된 v1 프로젝트를 올리는 옛 탭이나 API를 직접 쓰는 호출도 계속 받아야 하기 때문이다.

공통 브라우저 모델은 `apps/production-web/assets/collectible-model.mjs`에 둔다. `createProject`, `createGrade`, `toggleEffectGrade`, `effectsForGrade`, `motionForGrade`, `shapePoints`, `shapePath`, `cropTransform`, `upgradeProject`, `resolveSticker`, `resolveGreeting`, `particleAt`, `angleFrameIndex`, `strokeAlpha`, `parallaxOffset`, `livingPhaseAt`, `livingFrameAt`, `livingSpriteCount`, `livingSpriteGrid`, `livingBoundingBox`는 DOM·네트워크 없이 호출할 수 있다. 미리보기 선택 상태는 프로젝트 효과 토글을 대신하지 않는다.

보유자 응답은 게시/프로젝트 식별자·수집품 이름·모양·시즌·획득 등급 이름·완성 이미지·두께·각도·동작(`animation`: 기존 v1 8종 enum 그대로, 등급의 첫 `loop` 모션이 없으면 `still`)·전체 모션 목록(`motions`)·뒷면 이미지·각도/움직임 스프라이트·대사·선택 음성·선택 장면 등 재생에 필요한 결과만 포함한다. `photo.originalDataUrl`, 붓 이력, `parallax`·`living`의 편집용 획, 다른 등급의 결과, 점주 계정, 캠페인 내부 관리 정보는 포함하지 않는다. 편집 자료와 보유품 미디어는 공개 NFT 메타데이터·IPFS로 보내지 않는다.

### WP2 웹 A 구현 결과 (Issue #284, 2026-10-01)

- **스티커:** `stickerLayer`(렌더러)가 `resolveSticker`로 등급별 배치(`layouts`)를 적용하고, 텍스트는 `stickerLines`·`stickerLineOffsets`(모델의 순수 함수, 1.2줄 간격 중앙 정렬)로 최대 4줄을 그린다. `kind:'mascot'` 스티커는 `MASCOT_POSES`의 포즈 이름을 받아 `/app/assets/mascot/<pose>.png`를 그린다. 편집기는 종류(텍스트/이모티콘/마스코트)·정렬·"이 등급만 따로 배치" 토글("공통으로 되돌리기" 포함)을 제공한다. 등급을 끄면 그 등급의 `layouts`·동작 참조·인사말 규칙 참조를 지운다(참조가 전부 사라진 인사말 규칙은 함께 지운다).
- **마스코트 자산:** `apps/mobile/assets/images/mascot/v2`의 승인된 포즈 12장과 눈 깜빡임 프레임 9장(`MASCOT_BLINK`에 있는 포즈만)을 `apps/production-web/assets/mascot/`로 복사하고 `apps/production-web/server.mjs`(그리고 로컬 QA 전용 `tests/fixtures/collectible-qa-server.mjs`)의 정적 허용 목록에 등록했다. `MASCOT_BLINK`는 `collectible-model.mjs`와 `collectible-project-rules.ts`에서 같은 값을 유지해야 하며(전용 동치 시험 있음), 다르면 living의 blink 항목이 서버·브라우저에서 다르게 검증된다.
- **뒷면:** `backFor(project, gradeId, size, merchantName)`가 기본(바탕색·안쪽 테두리·가게 이름·수집품 이름·등급·마스코트 도장)과 커스텀(뒷면색 + 뒷면 스티커, 효과 대상 아님) 뒷면을 굽는다. `drawVolume`의 뒷면 분기가 이를 그리며, 없으면(v1 발행본 등) 바탕색+이름의 예전 모습으로 대체한다. 편집기는 "꾸밀 면"(앞/뒤) select로 같은 스티커 컨트롤을 재사용한다.
- **모션 재생:** 템플릿마다 재생 방식(`once`/`loop`) 라디오와, confetti 템플릿일 때만 보이는 파티클(`confetti`/`snow`/`petals`/`sparkles`) select가 있다. `drawVolume`은 `once`면 `ONCE_MS`(모델)만큼 진행한 뒤 멈추고, confetti는 `particleAt(kind,i,phase)`로 위치·색을 낸다. 뷰어(`collectible-viewer.mjs`)는 loop 모션이 있으면 열자마자 자동재생하고(움직임 줄이기면 정지 화면 유지), once 모션이 있으면 "획득 장면 다시 보기" 버튼을 따로 둔다.
- **인사말 개별화:** 등급·시즌 테마별 규칙 목록(등급 체크는 `gradeChecks` 재사용) 추가·삭제 UI가 있고, 미리보기는 `resolveGreeting`으로 지금 보는 등급·테마에 맞는 가장 구체적인 규칙을 보여 준다.
- **파생 이미지 범위 축소:** `serializeDerived(project, {extraGradeId, merchantName})`는 `rewardGrades`로 연결된 등급과(선택) 지금 보는 등급만 굽는다. `base`(각도별 질감 재합성용 비효과 정면)와 `effectMasks`는 그 연결된 등급에 한해 다시 만든다(PR #293 P2: 웹 뷰어가 각도별로 효과를 재합성하는 데 여전히 필요해 WP2에서 한 번 뺐다가 되살렸다). 각도별 효과 재합성을 WP3의 `angleFrames`가 대신하기 시작하면 그 등급·효과는 다시 뺄 수 있다.

### WP3 웹 B 구현 결과 (Issue #284, 2026-10-02) — 네 WP 전부 완료

- **패럴랙스:** 모델의 순수 `strokeAlpha(strokes, w, h)`(전경 255/배경 0 마스크, `processPhotoPixels`와 같은 원 찍기 수식)와 `parallaxOffset(angleDeg, strength, size)`(`s = sin(angle)·strength/100·0.04·size`)를 렌더러 `frontFor`가 쓴다: 배경 레이어는 `1+.08·strength/100`배로 확대하고 `-s/2` 이동, 전경(사진∩마스크)은 `+s` 이동, 스티커는 `+1.2s`, 테두리는 고정이다. 편집기 "사진 세부 조정"에 붓 대상(사진/패럴랙스) select·강도 슬라이더·fg/bg 붓을 더해 기존 자르기 캔버스 포인터 코드를 재사용했고, 붓 대상이 사진이 아니면 `strokeAlpha`로 지금까지 칠한 자리를 색 오버레이로 보여 준다.
- **living picture:** 모델의 순수 `livingPhaseAt`/`livingFrameAt`(주기성, t=0과 t=periodMs가 같은 칸)·`livingSpriteCount`(periodMs/100을 8..24로 clamp)·`livingSpriteGrid`(count칸을 columns 1..8·4096px 안에 배치)·`livingBoundingBox`(등급별 합집합 박스, 패딩)를 렌더러의 `livingOverlayFor`/`paintLivingItem`이 쓴다: `region` 대상은 (사진∩영역 마스크)를 sway(회전, 6° 상한)·bob(이동, 3% 상한)·steam(올라가는 반투명 점)으로, 스티커 대상은 그 스티커 레이어를 같은 방식으로 변형하거나 blink(마스코트 포즈를 `<pose>-blink`로 교체, 주기당 160ms)로 그린다. 편집기에 "살아 있는 그림" 섹션(항목 추가·삭제, 등급 토글, 움직임 크기, region 대상의 붓 칠하기(점 20개 상한))을 새로 만들었다.
- **각도 프레임·living 스프라이트·크기 사다리:** `serializeDerived`가 metallic/hologram/pearl 효과가 있거나(패럴랙스 강도>0이고 획이 있는) 등급에 `angleFrames`(12칸, 4×3, −82.5°+15°·i, living 대상 스티커는 뺀다)를, living 항목이 있는 등급에 `living` 스프라이트(count·columns·cellWidth/cellHeight·box)를 굽는다. 편집기 게시 경로가 크기 사다리(`SPRITE_SIZE_LADDER`: 448→384→320→256px, 화질 .85→.7)로 `publishSizeProblem`을 통과할 때까지 다시 시도하고, 끝까지 넘으면 가장 작은 단계로 기존 초과 안내를 보인다.
- **뷰어:** `angleFrames`가 있으면 `angleFrameIndex`로 가장 가까운 두 칸을 크로스페이드하고(없으면 기존 base+mask 재합성 폴백), `living`이 있으면 시간에 맞는 칸을 정면 위 `box` 자리에 얹는다. "기울여서 보기" 토글이 `deviceorientation` 감마(켤 때 잡은 값을 0점, 저역통과 .2, ±30°)로 각도를 돌리고, iOS는 토글 클릭에서 `requestPermission()`을 부르며, 미지원·동작 줄이기면 토글을 만들지 않고 탭이 숨겨지면 멈춘다. 편집기 미리보기에는 기울임을 넣지 않았다.
- **PR #293 후속 P2 3건:** (a) `maskFor`가 `gradeId`를 받아 `resolveSticker`를 거쳐, 등급별로 재배치된 스티커 효과도 그 자리에 맞는 마스크를 만든다. (b) 모션을 once→loop로 바꿀 때도 반복끼리 등급당 하나 배타 규칙을 다시 적용해, 겹치는 등급만 다른 loop 모션에서 뗀다. (c) `applyDraftEdits`가 v1 시절 스티커(align·layouts 없음)를 병합할 때 직접 두 필드를 채워, "이 등급만 따로 배치" 토글이 던지지 않게 한다.
- **알려진 한계(설계 문서 "위험" 그대로):** living 스티커 오버레이는 패럴랙스를 받지 않고 항상 각도 0 재질을 쓴다. mini-dom 시험은 canvas 호출을 전부 no-op으로 흉내 내 실제 픽셀 합성은 검증하지 못해(모양·치수·DOM 상태만 확인), 실제 브라우저 확인은 `NOT_RUN`이다.

## 제안 상태인 구현 기본값

아래는 원문 22장의 미정 정책에 대해 이번 코드를 실행 가능하게 만든 엔지니어링 기본값이다. **사용자가 과거에 승인한 고정 정책으로 기록하지 않는다.**

| 항목 | 이번 기본값과 이유 |
| --- | --- |
| 시작 재질 | 원본 색 유지, 바탕 `#bf8149`, 사진색 100, 음각/양각 깊이 45. 등급 이름이 재질을 강제하지 않으며 효과·동작 목록은 비어 있음. 골드 고정 효과 없음. |
| 등급·스티커·편집 상한 | 동적 등급 1~16, 스티커 30(앞면), 효과 64, 동작 10, 붓 경로 100개·경로당 점 1,000개. 네 등급 고정 슬롯을 피하면서 초안 크기와 작업량을 제한함. **v2:** 뒷면 스티커 10, 스티커 등급별 배치(`layouts`) 16, 인사말 개별화(`greetingOverrides`) 16, 패럴랙스 획 100개·경로당 점 1,000개, living 항목 4개(획 1~20점), 패럴랙스+living 점 합계 20,000개. |
| 파일·요청 상한 | (게시용 완성 정면·바탕·썸네일·장면 미리보기는 편집기가 WebP 품질 0.9로 만들고, 미지원 브라우저는 PNG, 효과 마스크는 알파 때문에 PNG다.) JSON 본문 8MiB, 원본 사진 3MiB·가로/세로 4,096px 이하, 등급 완성 이미지·바탕·마스크 512px(완성·바탕 1MiB, 마스크 256KiB)·썸네일 160px·128KiB, 장면 원본 512KiB·최대 5장과 미리보기 512px, 음성 1MiB·30초(MP3는 프레임으로 계산). 점포별 미디어 쓰기 1분 20번. 입력 화면에서 제한과 재시도 경로를 안내. 최종 지원 기기 측정 후 조정 대상. |
| 이미지·음성 형식 | 사진 PNG/JPEG/WebP. 파일 업로드 MP3. 직접 녹음은 브라우저가 지원하는 WebM/Ogg 등을 사용하고 MIME·미디어 바이트 형식을 서버에서 검사. MP3 변환을 했다고 주장하지 않음. |
| 추가 장면 자료 | 확대는 추가 프레임 불필요, 넓은 장면 1장, 추적 2장, 사건 3장. 기본 사진이 장면 입구이며 실제 사진 밖 공간을 재구성하지 않음. |
| 효과 합성 | 사진 보정/명암 → 사진 대상 효과 → 표면 효과 → 순서대로 스티커와 개별 효과 → 테두리 효과. 강도 0도 저장하며 선택 효과를 삭제하지 않음. |
| 동작 적용 | 한 등급에 실제 재생하는 템플릿을 구분하고, 공통 템플릿 목록은 선택 항목만 재생. 저성능·동작 줄이기에서 정적 결과 사용. 실제 지원 기기 성능 보증은 별도 측정. |
| 게시 후 편집 | 게시 버전을 보존하고 수정은 새 초안 복사로 진행. 기존 획득의 게시 버전은 유지. 초안 저장은 명시적 동작과 버전 충돌 안내를 제공. 기기 안 자동 저장(Issue #282, 아래 절)은 브라우저 로컬 저장일 뿐 서버 자동 저장이 아니며, 명시적 초안 저장·게시와 구분해 기록한다. |
| 획득 외형 | 기존 캠페인 목표에 점주가 직접 연결한 등급만 이후 보상권에 적용. 최소 하나의 명시 연결 후 게시. 고급 입력·특수등급·음성·장면은 선택 사항. |

미디어 서명 검사·파일 크기·유한 수치·허용 필드·안정 ID·참조 관계를 서버에서 확인한다. 저장할 때 원본 사진·장면 원본·완성 이미지 모두에서 EXIF/XMP/ICC 등 메타데이터를 제거하고(JPEG 방향값만 유지), MP3의 ID3·APE 태그를 제거한다. **미디어 헤더(매직 바이트·PNG IHDR/WebP VP8X 같은 치수 필드) 확인은 모든 디코딩 오류·전체 파일 안전성을 보증하지 않는다** — 헤더가 유효한 PNG/WebP/JPEG를 선언해도 그 안의 픽셀 데이터(IDAT 등)까지 실제로 디코드해 내용을 확인하지는 않는다(전체 디코드에는 새 이미지 디코딩 의존성이 필요해 별도 승인 없이 추가하지 않는다). 이 한계는 v1부터 있던 모든 이미지 필드(`photo.originalDataUrl`, `derived[g].imageDataUrl` 등)와 v2에서 추가한 스프라이트 필드(`derived[g].backImageDataUrl`·`angleFrames.dataUrl`·`living.dataUrl`) 모두에 똑같이 적용된다. 공개 원본 저장소나 임의 외부 URL을 허용하는 근거가 아니다.

## 서버 계약 (PR #257 인수 후속, 2026-09-30)

웹 제작기·Android 후속 작업은 아래 계약을 기준으로 한다. 모든 점주 경로는 `/api/web/merchant/merchants/:merchantId/…` 웹 세션(호스트에 묶인 `web_session` 쿠키)이고, 쓰기는 같은 Origin·`content-type: application/json`이어야 한다. 권한은 그 점포의 활성 멤버 `MANAGE_ART`(기본 OWNER, `AI_ART_STAFF_MAY_MANAGE=true`면 STAFF도)이며 서버가 요청 시작과 거래 안에서 다시 확인한다. 응답은 `cache-control: no-store`다. 운영 도메인에서 이 경로는 Caddy가 API로 바로 넘기므로 `production-web` 프록시를 거치지 않는다(`/merchants` 공개 목록은 `id`·`campaign`을 지우므로 제작기가 쓰면 안 된다).

### 게시할 캠페인 목록

`GET /api/web/merchant/merchants/:merchantId/collectible-campaigns` → `200`

```json
{ "campaigns": [ { "id": "campaign-a", "title": "가상 캠페인", "status": "ACTIVE",
  "startsAt": "2026-09-01T00:00:00.000Z", "endsAt": "2026-12-01T00:00:00.000Z",
  "goals": [1, 3, 5], "publication": { "publicationId": "…uuid…", "projectId": "…uuid…" } } ] }
```

- 이 점포의 `status='ACTIVE'`·공개·기간 안(`startsAt ≤ 지금 < endsAt`) 캠페인만, `startsAt` 최신순. 게시 API가 받는 조건과 같다.
- `goals`는 그 캠페인에 실제로 있는 기존 목표 중 1·3·5만 오름차순. `rewardGrades`의 키는 이 안에서만 고른다(없는 목표는 게시가 409 `COLLECTIBLE_CAMPAIGN_UNAVAILABLE`).
- `publication`은 지금 그 캠페인에 연결돼 새 방문 고객에게 나가는 발행본(없으면 `null`).
- 오류: 세션 없음·만료 401(`WEB_SESSION_*`), 다른 호스트 403, 권한 없음 403 `MERCHANT_ACCESS_DENIED`, 삭제된 계정 410 `ACCOUNT_DELETED`.

### 프로젝트 경로 (`…/collectible-projects`)

| 경로 | 본문 | 성공 응답 |
| --- | --- | --- |
| `GET` | — | `{ projects: [{ id, merchantId, version, status, publicationId, createdAt, updatedAt, name, schemaVersion: 2, distributingCampaignId }] }` (`distributingCampaignId`: 이 게시 버전이 지금 나가는 캠페인, 아니면 `null`) |
| `POST` | `{ project }` | 201 프로젝트 래퍼 |
| `GET /:projectId` | — | 래퍼 `{ id, merchantId, version, status, publicationId, createdAt, updatedAt, project }` |
| `PUT /:projectId` | `{ expectedVersion, project }` | 200 래퍼 |
| `POST /:projectId/copy` | `{ expectedVersion }` | 201 새 초안 래퍼 |
| `POST /:projectId/publish` | `{ expectedVersion, campaignId }` | 200 `{ project, publicationId, campaignId }` |
| `POST /:projectId/unpublish` | `{ expectedVersion }` | 200 `{ projectId, publicationId, unlinkedCampaignId }` (이미 교체·중지됐으면 `null`) |
| `POST /:projectId/delete` | `{ expectedVersion }` | 200 `{ projectId, deleted: true, unlinkedCampaignId }` (초안은 행 삭제, 게시본은 게시 중지 + 비공개 원본 비움) |

- 저장·생성·복사 응답의 `project`는 서버가 정리한 값이다: 모든 이미지의 메타데이터 제거(바이트가 달라짐), MP3는 태그 제거와 프레임 기준 `durationSeconds`. 편집기는 응답의 `project`를 새 기준값으로 삼아야 "저장하지 않은 변경" 비교가 어긋나지 않는다.
- 본문 상한 8 MiB(413 `BODY_TOO_LARGE`). 점포당 미디어가 남은 발행본은 100개까지다(409 `COLLECTIBLE_PUBLICATION_LIMIT`; 게시본은 이미 받은 고객을 위해 남아 삭제·게시 중지로 줄지 않고, 운영자 미디어 제거만 자리를 비운다). 생성·저장·복사·게시는 점포마다 1분 20번(429 `COLLECTIBLE_RATE_LIMITED`, `Retry-After` 초).
- 이미지: PNG/JPEG/WebP data URL만. 원본 사진 3 MiB·4096 px, 장면 원본 512 KiB·4096 px(최대 5장), 완성 `imageDataUrl`·`baseDataUrl` 1 MiB·512 px, `effectMasks` 256 KiB·512 px, `thumbnailDataUrl` 128 KiB·160 px, 장면 `previewDataUrl` 512 KiB·512 px. 애니메이션 WebP 거절. 음성: MP3(ID3/APE 태그 뒤 MPEG Layer III 프레임만, 30.5초 초과 413 `COLLECTIBLE_MEDIA_TOO_LARGE`), WebM/Ogg(브라우저 녹음의 Opus만, 서버가 길이를 다시 계산해 30.5초 초과 413. Ogg는 태그를 비우고, WebM은 Tags·Attachments·Chapters·제목이 있으면 400).
- 오류 코드 전체(상태): `INVALID_REQUEST`(400, 본문 키), `COLLECTIBLE_INVALID_PROJECT`(400), `COLLECTIBLE_MEDIA_TOO_LARGE`(413), `BODY_TOO_LARGE`(413), `COLLECTIBLE_PROJECT_NOT_FOUND`(404), `COLLECTIBLE_VERSION_CONFLICT`·`COLLECTIBLE_PUBLISHED_IMMUTABLE`·`COLLECTIBLE_CAMPAIGN_UNAVAILABLE`·`COLLECTIBLE_NOT_READY`·`COLLECTIBLE_PROJECT_LIMIT`·`COLLECTIBLE_PUBLICATION_LIMIT`·`COLLECTIBLE_NOT_PUBLISHED`(409), `COLLECTIBLE_RATE_LIMITED`(429), `MERCHANT_ACCESS_DENIED`(403), `ACCOUNT_DELETED`(410), `COLLECTIBLE_PROJECTS_NOT_CONFIGURED`(503).

### 웹 제작기의 연결 (PR #257 인수 후속, 2026-10-01)

- **캠페인:** 제작기는 공개 `/merchants`를 읽지 않고 위 `collectible-campaigns`만 쓴다(열 때·저장 목록 새로 보기·게시 직전에 다시 읽는다). 선택한 캠페인의 `goals`에 없는 방문 목표는 보이지 않고, 캠페인을 바꾸면 그 목표의 연결은 풀린다. 게시 직전 목록에 없는 캠페인은 서버에 보내기 전에 막는다. 목록 읽기에 실패하면 권한·세션 이유를 알리고 게시만 막는다.
- **기준값:** 저장·생성·게시 응답의 `project`(이미지 바이트·MP3 길이를 서버가 정리한 값, 게시 때 만든 파생 이미지 포함)를 새 기준으로 삼아, 저장 중 새로 편집한 내용이 없으면 "저장하지 않은 변경"이 남지 않는다. 있으면 편집 내용을 지키고 버전만 이어 한 번 더 저장하게 한다. 시즌 복사는 서버의 새 초안을 저장 대상으로 삼고 이름·캠페인·보상 연결만 바꿔 저장 전까지 변경으로 본다.
- **게시 중지·삭제:** 게시 옆 `게시 중지`(`POST …/unpublish`)와 `삭제`(`POST …/delete`)는 확인 대화상자 뒤 `expectedVersion`으로 요청한다. 게시 중지는 새 손님에게 나가는 것만 멈추고, 게시 프로젝트 삭제는 원본·편집 자료가 지워지며 이미 받은 손님의 수집품은 남는다고 알린다. 목록·카드·상태 줄은 `distributingCampaignId`로 지금 나가는 캠페인 이름을 보여 준다.
- **오류 문구:** 위 오류 코드마다 `collectible-errors.mjs`의 고유한 한국어 문구가 있고(계약 문서·서버 코드 목록과 어긋나면 시험이 실패한다), 429는 `Retry-After` 초를, 413은 본문·미디어 상한을 알린다. "인터넷 연결 확인"은 요청이 서버에 닿지 못했을 때만 쓴다.
- **보내기 전 확인:** 완성본·바탕 1 MiB, 썸네일 128 KiB, 마스크 256 KiB, 장면 미리보기 512 KiB, 본문 8 MiB, 스티커 30개를 서버와 같은 값으로 미리 확인해 넘으면 입력을 지킨 채 안내한다.

### 제작 부담을 줄이는 보조 기능 (Issue #282, 2026-10-01)

「월계 마스코트 개발 전달 최종 기획 노트」의 남은 항목 네 가지를 `collectible-assist.mjs`(DOM 없는 순수 함수)와 `collectible-editor.mjs`의 배선으로 구현했다. `collectible-model.mjs`는 다른 브랜치(schema v2)가 편집 중이라 손대지 않았다.

- **14.3 자동 저장(기기 로컬, 서버 자동 저장 아님, 2026-10-01 단순화):** 서버에 한 번이라도 저장한 프로젝트(wrapper id가 있는)만 대상으로, 편집이 멈추고 약 1.5초 뒤(`autosaveDelayMs`, 시험에서만 조절) `localStorage` 키 `masscom:collectible-draft:<merchantId>:<accountScope 해시>`에 **편집 값만**(사진 원본·음성·이야기 장면 자료·완성 파생 이미지는 절대 담지 않음) 적는다. `collectible-assist.mjs`의 `draftEditsOnly(project)` 한 함수가 이 모양을 정의하고, `applyDraftEdits(serverProject, edits)`가 그 역함수다. `accountScope`는 `merchant.mjs`가 아는 로그인 계정 구분값(`mine.accountScope`)이며 **없으면 자동 저장·복원 자체를 하지 않는다**(공유 PC 보관함 'anon' 버킷 폐지). 새로 시작해 아직 한 번도 저장하지 않은 초안은 자동 저장 대상이 아니고 `beforeunload` 경고로만 보호한다. 마운트 뒤 저장 목록을 성공적으로 읽은 다음에만(목록 조회 실패는 판단을 보류하고 보관본을 그대로 둔다), 같은 점포·계정의 로컬 사본이 서버의 그 프로젝트 버전과 **같을 때만**(더 새 서버 버전이면 묻지 않고 조용히 지운다) "저장하지 않은 편집을 이어서 할까요?"를 묻는다. 지금 에디터가 이미 dirty면(목록 조회를 기다리는 동안 새 편집을 시작한 경합) 묻지 않고 조용히 건너뛴다. 수락하면 그 프로젝트의 최신 서버본을 다시 받아(`GET` 한 번) `applyDraftEdits`로 편집 값만 그 위에 겹친다 — 사진·음성은 항상 서버의 최신본을 쓰며, 안내 문구는 "사진·목소리는 마지막으로 저장한 것을 써요"다. 초안 저장·게시·삭제가 성공하거나 명시적 새 초안 시작(폐기)을 수락하면 로컬 사본을 지운다. 로그아웃·계정 전환으로 그 계정의 모든 점포 보관본을 지우는 일은 `collectible-assist.mjs`의 `clearCollectibleDrafts(storage, accountScope)`를 `merchant.mjs`가 제작기가 열려 있지 않아도 직접 호출해 처리한다(같은 계정의 점포·역할 목록만 바뀐 호출은 지우지 않는다 — 비교 대상은 `accountScope` 하나뿐이다). 모든 저장 공간 접근은 try/catch로 감싸 사생활 보호 모드·용량 초과에서도 편집이 끊기지 않는다.
- **8.1 등급 전체 선택·해제:** 각 효과·동작의 "적용할 등급" 그룹 아래에 "전체 선택"·"전체 해제" 버튼을 둔다. 미리보기로 보는 등급(`selectedGrade`)은 건드리지 않고, 한 번의 클릭은 undo/redo 한 단계로 묶인다(기존 `mutate()` 배선 재사용). 효과의 전체 선택은 9.14의 배타 재질 검사를 그대로 지켜 이미 충돌하는 등급은 건너뛰고 몇 개를 건너뛰었는지 알린다. 모두 꺼지면 효과는 기존 "현재 어느 등급에도 적용하지 않아요" 문구를 그대로 보인다.
- **9.14 재질 충돌 안내:** `collectible-renderer.mjs`의 합성 방식(`effectPaint`, 171~205행)을 근거로 무광·에나멜·유리를 같은 대상·등급의 배타 그룹으로 정했다 — 셋 다 표면 전체를 덮는 `soft-light`/`overlay`+`screen`/`destination-in`+`source-atop` 합성이라 같이 켜면 결과를 예측할 수 없다. 메탈릭·펄·홀로그램·발광은 그라디언트/테두리 레이어라 조합해도 안전해 그대로 뒀다(기존 코드가 이미 이 판단으로 짜여 있었고, 이번에 `EXCLUSIVE_MATERIAL_GROUP`으로 정식화했다). 같은 대상·등급에 배타 재질을 새로 켜면 조용히 바꾸지 않고 "무광과 에나멜은 같은 곳에 함께 쓸 수 없어요. 에나멜을 끄고 무광을 켤까요?" 형태로 확인하며, 수락하면 기존 재질을 끄고 새 재질을 켜고, 거절하면 체크를 되돌리고 다른 등급에 적용하거나 먼저 꺼 달라고 안내한다(대안 제시).
- **4.2 자동 맞춤:** 자르기 단계에 "자동 맞춤" 버튼을 둔다. 버튼을 눌러야만 동작하며(자동 실행 없음), `window.FaceDetector`(Shape Detection API)가 있으면 원본 사진에서 가장 큰 얼굴을 찾아 얼굴 중심이 프레임 중앙에, 얼굴이 세이프 영역(512×0.78, 스티커 배치와 같은 관례)의 45%를 차지하도록 `crop.x/y/zoom`을 계산한다(`faceFitCrop`, `cropTransform`의 fit-cover 공식을 거꾸로 푼 순수 함수). 지원하지 않거나 감지에 실패하면 `centerFillCrop()`(zoom 1, 중앙)으로 물러난다. 결과는 undo 한 단계로 남고, 안내 문구로 "얼굴 기준으로 맞췄어요"/"가운데로 맞췄어요"를 구분해 알린다.

### 고객 경로와 제거된 외형

- `GET /collection`·`/api/web/collection`의 `collectibles[].artwork`는 `{ projectId, publicationId, gradeId, gradeName, shape, theme, name, thumbnailDataUrl }` 그대로다(획득 행은 참조만 저장하고 불변 발행본 등급 요약을 읽는다).
- 운영자가 게시 미디어를 제거한 수집품은 `artwork`가 빠지고 상세 `GET /collectibles/:entitlementId`·`/api/web/collectibles/:entitlementId`는 404 `COLLECTIBLE_NOT_FOUND`다. 보상·방문 기록은 그대로이므로 앱·웹은 `artwork`가 없으면 기존 수집품 카드로 보여 준다.

## 유지하는 후속 제안과 결정 항목

원문의 개발 순서는 일정과 의존성 제안이며 기능을 삭제하는 표가 아니다. 다음 항목은 이번 기본 경로와 구분해서 보존한다.

- **[Issue #284](https://github.com/2026-KW-HACKATHON/27_MassCOM/issues/284) 네 WP(스키마·웹 A·Android·웹 B) 전부 완료:** 스티커 여러 줄·정렬·등급별 별도 배치(v2 `stickers[].align/layouts`), 별도 뒷면 편집(v2 `back`), 마스코트 스티커(v2 `stickers[].kind:'mascot'`), 모션 once/loop 재생과 파티클 종류(v2 `motion[].playback/particle`), 인사말의 등급·테마별 개별화(v2 `greetingOverrides`), 패럴랙스(v2 `parallax`), 분리된 부분이 움직이는 living picture(v2 `living`, 코인 회전·입자와는 구분되는 새 개념), 각도별 재질 재계산(v2 `derived[g].angleFrames`), 기기 기울임 연동(Android `useAnimatedSensor`·웹 `deviceorientation`)까지 전부 구현됐다. 세부는 위 "WP2 웹 A 구현 결과"·"WP3 웹 B 구현 결과"와 [설계 명세](superpowers/specs/2026-10-01-collectible-expression-v2-design.md)를 본다. 남은 것은 실제 브라우저·기기 확인(`NOT_RUN`)과 독립 교차 리뷰다.
- 고급 공간 이동·생성 장면은 여전히 이번 범위 밖 선택 확장이다. (자동 얼굴 감지·중앙 맞춤은 Issue #282로 구현했다. 아래 "제작 부담을 줄이는 보조 기능" 절 참조.)
- 정확한 템플릿 수·속도·시간, 물리적 두께 단위·모양별 범위, 자동 재생, 공통 설정의 등급/시즌별 덮어쓰기는 추가 검토한다. (기기 안 자동 저장은 Issue #282로 구현하고 2026-10-01에 단순화했다. 서버 자동 저장은 여전히 후속이다.)
- 시즌의 기간·획득 조건·한정 의미·재발급·중복 표시, 특수등급/테마 생성 권한·이름 변경·삭제 운영 절차는 별도 정책이다. 특수등급은 자동으로 확률형·희귀 보상이 되지 않는다.
- 마스코트 관계 성장·나의 동네와 거점·시즌 앨범 목표·친구 공동 목표는 17장의 장기 서비스 제안으로 남는다. 첫 사진 제작기 필수 기능으로 혼합하지 않는다. (Issue #283에서 배달한 항목: 획득 연출, 가게·시즌·등급 필터/정렬 보기, 대표 진열, 공유, 중복 획득 묶음 표시, 가게별 1·3·5회 시리즈 칸, 첫 수집품/새 가게/시리즈 완성 마스코트 반응 — 자세한 내용은 [apps/mobile/README.md](../apps/mobile/README.md#도감-수집-경험-issue-283).)
- 실제 기기의 최대 사진·등급·스티커·효과 조합·반복 편집 처리 시간과 메모리, 화면 밖·백그라운드 재생, Android 신규 상세의 실제 사진·오디오 표시, 소유자의 UI 판정은 실제 결과로 검증한다.

기획노트의 예시 이름·등급 개수·게임의 캐릭터/카드/로고는 고정 구현 기준이 아니다. Orna·Pokémon TCG Pocket·Pokémon GO는 경험 참고이며 고유 표현을 그대로 복제하는 요청으로 해석하지 않는다.

## 후속 화면 참고 반영

사용자가 같은 PR 작업 중 전달한 [화면 참고 이미지 두 장](SOURCE_INDEX.md)을 따라 파랑·흰색·남색의 스튜디오 시작 화면과 네 단계 편집 흐름을 구성한다. 단계는 사진 배치 → 등급 미리보기 → 세부 조정 → 연출과 목소리이며, 앞뒤로 자유롭게 이동하면서 같은 편집 프로젝트를 유지한다. 고급 기능을 모두 채워야 다음 단계로 갈 수 있는 절차는 아니다.

시작 화면의 제작물 카드는 서버의 목록 메타데이터(이름·상태·버전)를 사용한다. 카드 선택 시 해당 프로젝트를 읽고, 갤러리 표시를 위해 모든 원본 사진을 내려받지 않는다. 기본·여름축제·겨울방학과 새 테마 입력은 `theme.name`만 바꾸며 등급·재질·캠페인·획득 조건을 설정하지 않는다.

모양·재질·동작은 기존 지원 항목을 시각 카드로 보여 준다. 단일 미리보기 등급과 복수 효과/동작 적용 등급은 각각 선택한다. 초안 저장·게시, 캠페인 목표 연결, 음성·추가 장면과 원본 보존은 같은 저장 계약을 사용한다. 참고 이미지의 입자/패럴랙스 재질과 실제 mm 단위, 예시 인물·제작물은 새 기능이나 실제 점포 자료로 복사하지 않는다.

## 앱의 등급 재질 연출 (Issue #349, 2026-10-03)

앱은 게시물의 `gradeId`·`gradeName`으로 재질을 고른다. 브론즈는 은은한 따뜻한 광택, 실버는 차가운 금속 반사, 골드는 따뜻한 금속색·밝은 대각 반사띠·별빛 5개, 프리즘(특별 포함)은 움직이는 반복 무지개 홀로그램·미세 회절선·별빛 10개다. 제작기 효과는 기존 사진에 구워진 그대로 유지하고 서버에 효과 목록을 요구하지 않는다. 테두리 색도 같은 등급 판별을 공유한다.

상세 앞·뒷면의 빛은 회전 각도·카드 끌기·전용 중력 센서(32ms 표본, 첫 자세 기준으로 부드럽게 변화)를 합친다. 회전용 “기울여 보기”가 꺼져도 반사가 움직이며, 정지한 휴대전화에서도 자동 반사가 돈다(골드 3초·프리즘 2.8초·실버 3.4초·브론즈 11초, 주기의 마지막 20%는 반사띠가 그림 밖에서 쉰다). 사진·현재 각도 스프라이트의 알파 또는 공통 윤곽으로 조명을 자른다. 기본 뒷면은 프리즘 무지개·골드 금속 바탕과 대비를 유지하는 글자 패널을 사용한다.

목록·대표 진열·기존 카드는 하나의 UI 스레드 시계를 공유하며 화면 안의 골드·프리즘만 움직인다. 화면 밖·탭 이탈·백그라운드·모달 뒤에서는 정적 프레임으로 전환하고 목록에는 센서를 붙이지 않는다. 봉투는 프리즘 무지개 광선·골드 금빛 광선을 더하면서 기존 점주 shine/sparkle을 유지한다. 공유 이미지는 골드·프리즘의 정적 재질을 캡처한다. 시스템 동작 줄이기와 상세 화면의 동작 줄이기를 존중하며 반복·센서·광선 폭발 없이 중앙의 한 프레임을 표시한다. 등급 연출은 장식이며 보상·방문·NFT 규칙을 변경하지 않는다. **fix round 1 (2026-10-03):** 실제 사진에서 골드가 거의 보이지 않고 프리즘이 약한 필터처럼 보인 기기 QA `FAIL`을 반영했다. 바탕/반사띠 중심 알파는 브론즈 0.035/0.12, 실버 0.10/0.50, 골드 0.30/0.80, 프리즘 0.44/0.85다. 바탕은 `overlay`(실버·브론즈는 `soft-light`), 반사띠·방사광·별빛·림은 `screen`으로 사진과 같은 부모 아래에서 합성한다. 프리즘은 사진 위 약 3~4주기의 좁은 대각 무지개·0.20~0.30 회절선과 빛을 더한다. 목록은 0.8배 강도·4초 주기이며 골드 별빛 3개·프리즘 4개를 유지하고, 봉투는 1.15배(최대 반사 알파 0.95)다. 점주 shine/sparkle과 기본 뒷면 문자는 기존 감쇠를 유지한다. 반복 무지개는 X/Y를 함께 정확히 한 색 주기만큼 이동하며 RGB 경계 연속성을 시험한다. 상세 카드의 세로 끌기는 가로 조명 Pan이 빠르게 포기하고, 뷰포트 밖 카드에서는 센서·시계를 멈춘다. 동작 줄이기에서도 중앙 반사띠·바탕·무지개·별빛을 한 정적 프레임으로 보인다. 기본 뒷면 바탕/문자 디자인은 유지했다. 수정 후 실제 색감·제스처·성능·접근성의 기기 판정은 `NOT_RUN — 사용자 판정 필요`다. 임시 QA 경로는 효과만 감싸므로 실제 고객 화면의 사진 합성과 동일한 조건이 아니며 고객 화면 재-QA가 필요하다.


2026-10-03 2차 수정: Android SVG는 점 시작 숫자 문자열을 거부하므로 상세 점주 shine/sparkle의 반사띠 offset도 숫자 JSX 속성으로 수정하고 전체 TSX 소스 회귀 검사를 추가했다. 밝은 그림에서도 금빛이 남도록 골드 바탕은 `#FFB300 → #FFE08A → #C98A00`의 **일반 합성** 그라데이션(상세 알파 0.22), 반사띠는 양쪽 `#FFC23A → #FFE7A0`(최대 알파 0.52)과 흰 중심(0.80)으로 바꿨다. 골드·프리즘 림은 크기의 4.5% 두께에 지속 금속/무지개 바탕과 같은 반사띠를 따라 움직이는 하이라이트를 일반 합성한다. 골드 별빛은 높이 최대 약 19%와 glow를 가지며 최소 광량 0.60으로 유지된다(상세 5개·카드 3개). 카드 광량 0.8배와 동작 줄이기 정적 프레임은 유지한다. 프리즘 foil·회절선·별빛 합성은 1차 수치를 유지한다. 수정 후 실제 Android 색감·가독성·목록 성능 판정은 아직 `NOT_RUN`이다.

## 검증 연결

- 모델: `node --test tests/site/collectible-model.test.mjs` — 새 등급과 시즌의 독립성, 브론즈 홀로그램·프리즘 해제, 모두 끄기, 개별 대상, 톱니·우표 외곽, 원본 유지와 fit-cover 경계.
- 브라우저 렌더러·편집기·상세: 해당 사이트 시험과 실제 브라우저 확인 — 픽셀 효과 차이, 자르기/완성 모양 일치, 조작·저장·오류·재생 수명.
- API: API 단위·PostgreSQL 통합 — 권한·허용 미디어·초안/게시·버전 충돌·다른 점포 캠페인 거절·기존 목표 유지·게시 버전 획득·다른 보유자 거절.
- 웹 제작기 행동: `node --test tests/site/collectible-editor-flow.test.mjs tests/site/collectible-errors.test.mjs tests/site/collectible-qa-fixture.test.mjs` — 최소 DOM(`tests/fixtures/mini-dom.mjs`)과 계약 흉내 API(`collectible-fake-api.mjs`) 위에서 캠페인 읽기·저장 기준값·게시·복사·충돌·게시 중지·삭제·WebP·크기 상한·429/413 문구와, 오류 코드 전부의 문구 매핑·QA 서버의 운영 모양을 확인한다. 같은 파일에 Issue #282의 자동 저장(서버 저장 전 wrapper 없음·계정 구분값 없음은 저장 안 함, 편집 값만 저장, 같은/더 새 서버 버전·조회 실패·dirty 에디터의 복원 판단, 계정 전환·역할 목록 변경의 기기 보관본 처리)·등급 전체 선택(미리보기 등급 불변·undo 한 단계)·재질 충돌 확인(수락·거절 양쪽)·자동 맞춤(얼굴 감지·feature-detect 대체·undo 한 단계) 회귀도 있다. 픽셀 결과·실제 브라우저 조작은 검증하지 않는다.
- 제작 부담 보조 기능의 순수 로직: `node --test tests/site/collectible-assist.test.mjs` — 저장 키 계산, 자동 저장이 미디어(사진·음성·이야기 장면·파생 이미지)를 절대 담지 않는 `draftEditsOnly`와 서버 최신본에 그 값만 겹치는 `applyDraftEdits`, 계정 보관본 일괄 삭제, 배타 재질 판정과 확인 문구, `cropTransform`으로 왕복 검증한 얼굴 맞춤 기하(중앙 정렬·세이프 영역 45%·zoom 1~8 클램프·구석 얼굴의 경계 처리)를 DOM 없이 확인한다.
- Android: `npm test --prefix apps/mobile` — 받은 보상의 외형 유무에 따른 수집품 버튼, 제거된 수집품(404) 안내, `RECORD_AUDIO` 차단 설정.
- 기존 기능: 방문·보상·NFT·점주 웹·운영/시연 앱 회귀 — 새 외형 구조가 기존 보상 조건과 환경 분리를 변경하지 않는지 확인.

실행하지 않은 시험·배포·실기기 확인은 완료로 기록하지 않는다. 스냅샷 미디어를 공개 페이지나 시험 증거에 포함할 때도 실제 개인 사진·목소리를 fixture로 복사하지 않는다.
