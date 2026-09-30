# 수집품 표현 v2 설계 (Issue #284) — architect(opus) 산출물 2026-10-01, 오케스트레이터 승인

원문(영어) 설계는 세션 스크래치패드에 있었고, 이 문서는 그 내용을 한국어로 옮기며 path:line 근거·스키마 블록·WP 분할·시험 계획·위험을 그대로 유지한다. WP1(이 문서가 기준으로 삼는 범위) 구현 결과는 [TEST_STATUS](../../TEST_STATUS.md) 최신 항목과 [HANDOFF](../../HANDOFF.md)의 Issue #284 인수인계 절을 본다.

## 요약

추가 전용 스키마 v2다. 서버는 v1 입력·읽기를 v2로 올리며, DB migration은 없다(`detail` jsonb는 모양 검사가 없다). 각도·재생 시간에 따라 달라지는 모든 요소는 게시 시점에 웹 렌더러(유일하게 올바른 재질 코드를 가진 곳)가 스프라이트로 미리 구워 낸다. Android는 스프라이트 칸만 바꿔 끼운다: 합성도 없고 새 의존성도 없다. Android 기울임은 이미 설치된 Reanimated `useAnimatedSensor`를 쓴다(`expo-sensors`는 거부). 함정: Android의 엄격한 `animation` enum, 8 MiB 본문 상한.

## 근거 사실 (경로는 저장소 루트 기준, 줄 번호는 `61bde48` 기준)

1. `apps/api/src/collectible-project-rules.ts:100-101`(구현 전 기준선) 엄격한 키 집합이 `schemaVersion !== 1`이면 거절 → 새 필드마다 v2가 필요하고, 서버는 배포 중 열려 있던 브라우저 탭이 보내는 v1도 여전히 받아야 한다.
2. `apps/mobile/src/commerce/collectible-artwork.ts:17,34` 상세 전체를 `animation`이 v1 8종 밖이면 거절 → 새 동작 종류를 추가하면 이미 설치된 APK가 깨진다. **파티클 종류는 기존 `confetti` 모션의 `particle` 매개변수로 표현하고, `animation`은 v1 enum에 그대로 둔다.**
3. `apps/production-web/assets/collectible-renderer.mjs:357-368`의 `serializeDerived`는 활성화된 모든 등급(≤16)+기본+마스크를 렌더링한다. 게시 스냅샷은 `rewardGrades` 값(`apps/api/src/postgres/collectible-project.ts:103`, ≤3 등급)만 담는다 → 연결된 등급만 렌더링해 본문 용량을 확보한다.
4. `apps/api/migrations/0034...sql:46-50`의 `detail` jsonb는 객체인지만 검사한다. 미디어 제거는 detail 전체를 덮어쓴다(약 167번 줄) → 새 필드는 migration이 필요 없고 제거 절차가 그대로 덮는다.
5. metallic·hologram·pearl만 각도를 쓴다(`renderer.mjs:188-202`). 이 재질이나 패럴랙스가 없는 등급은 프레임이 필요 없다.
6. `apps/mobile/src/screens/collection/collectible-detail.tsx:228-230`의 다섯 측면 슬랩은 각도 독립적인 색칠된 실루엣이다. 정면 이미지(230번 줄)만 프레임이 필요하다.
7. Reanimated 4.5.1은 `useAnimatedSensor`/`SensorType.GRAVITY`를 내보내고 매니페스트 권한이 필요 없다. 기기 위 합성은 웹과 맞출 수 없다: rn-svg `FeBlend`는 normal/multiply/screen/darken/lighten만 지원하는데 웹은 color/soft-light/overlay를 쓴다.
8. `rules.ts:22`(구현 전 기준선)는 이미 스티커 텍스트에 `\n\r\t`를 허용하지만 v1 렌더러는 한 줄만 그린다(`renderer.mjs:212`).

## 스키마 v2 (`collectible-model.mjs:6` `SCHEMA_VERSION=2`, `rules.ts`에 대응 값을 둔다) — 추가만 한다

```
stickers[]  +align 'left'|'center'|'right'   +layouts {[gradeId]:{x,y 0..1,size 8..120,rotation ±180}} (≤16, 키는 등급 ID 부분집합)
            kind +'mascot'(text = pose ∈ MASCOT_POSES); text: ≤80자, ≤4줄('\n'), \r·\t 금지
back        {mode 'default'|'custom', color #hex, stickers Sticker[≤10](layouts 없음, ID는 앞뒤 통틀어 유일)}
motion[]    +playback 'once'|'loop'   +particle 'confetti'|'snow'|'petals'|'sparkles'(type==='confetti'일 때만 필요)
greetingOverrides [{id, gradeIds ⊆ grades(0..16), themeName ≤80(''=아무 테마), text 1..300}] ≤16; gradeIds가 []이고 themeName도 ''인 항목은 거절
parallax    {strength 0..100, strokes [{tool 'fg'|'bg', size .01..0.2, points [{x,y}] 1..1000, 사진 0..1 좌표}] ≤100}
living      {periodMs 1000..4000, items [{id, kind 'sway'|'bob'|'steam'|'blink', target 'region'|<앞면 스티커 id>, gradeIds,
             amplitude 0..100, pivot {x,y} 0..1 얼굴 좌표, strokes(region 대상만, 1..20)}] ≤4}
            blink는 오직 pose ∈ MASCOT_BLINK인 mascot 스티커에서만; parallax+living 점 합계 ≤ 20,000
derived[g]  v1 키 유지(baseDataUrl/effectMasks는 이제 선택, 더 이상 만들지 않음) +
  backImageDataUrl  ≤512², ≤256 KiB
  angleFrames {dataUrl, side 256..512 정수, count 12, columns 4, stepDegrees 15}; 스프라이트는 정확히 4side×3side, ≤1 MiB; i번째 칸 = −82.5°+15i
  living {dataUrl, count 8..24, columns 1..8, cellWidth/cellHeight 16..512, periodMs, box {x,y,w,h} 0..1, x+w≤1, y+h≤1};
         스프라이트 = cols·cw × ⌈count/cols⌉·ch ≤ 4096 px, ≤512 KiB
```

v1→v2 업그레이드는 순수 함수이며 멱등이다. `upgradeProject`(model.mjs)와 `upgradeCollectibleProject`(rules.ts) 둘 다 같은 공유 골든 픽스처(`tests/fixtures/collectible-v1.json` → `collectible-v2-upgraded.json`)로 시험한다.
- `schemaVersion` → 2. 스티커는 `align:'center'`, `layouts:{}`를 받고, 텍스트는 `/[\r\n\t]+/g → ' '`로 정규화한다.
- `back` = `{mode:'default', color: <기본색>, stickers: []}`.
- 모션은 `playback:'loop'`를 받고, confetti 타입이면 `particle:'confetti'`도 받는다.
- `greetingOverrides: []`, `parallax: {strength:0, strokes:[]}`, `living: {periodMs:2400, items:[]}`.
- `derived`는 그대로 둔다. v1 derived는 뒷면 이미지가 없어 재직렬화(편집기가 게시마다 다시 만든다, `editor.mjs:423-426`) 전까지 게시 준비를 통과하지 못한다.
- 그 외 버전은 400.

서버는 생성·저장·복사·게시(`validateCollectibleProject` 안)와 `mapProject`(`postgres/collectible-project.ts:253`)에서 업그레이드를 실행해 API가 항상 v2만 돌려준다. `postgres/collectible-project.ts:35`와 `collectible-project.ts:39`의 `schemaVersion: 1` 리터럴은 2가 된다. 편집기도 로드 시 `upgradeProject`를 실행한다.

**구현 결과 메모(WP1):** 위 계획은 스티커 `align`/`layouts`, 모션 `playback`을 항상 있는 값으로 뒀지만, 실제 서버 검증은 이 셋을 선택 항목으로 두고 없으면 업그레이드와 같은 기본값을 채운다. WP2가 아직 편집기의 스티커·모션 생성 코드를 고치지 않아, 그대로 필수로 만들면 이 브랜치만 배포됐을 때 기존 편집기의 저장이 거절되는 회귀가 생기기 때문이다. `particle`은 설계대로 엄격하다(`type!=='confetti'`인데 값이 있으면 거절).

## 서버 검증·스냅샷·상한·저장

- 검증: 새 `object()` 키 집합, 새 ID에 `id()`. 참조 관계(레이아웃 키·override/living의 gradeIds ⊆ grades, living 대상 ⊆ 앞면 스티커, 효과 대상은 앞면 전용 유지)도 검사한다. 스프라이트는 `validateCollectibleMedia` + 정확한 치수 검사를 거친다. 애니메이션 WebP는 여전히 거절한다. 저장·스냅샷 시점에 새 이미지 3종에 `stripImageMetadata`를 적용한다.
- 게시 준비(`rules.ts:169` 확장), 연결된 등급마다: `backImageDataUrl`은 항상 필요. metallic/hologram/pearl이 있거나 `parallax.strength>0`이면서 획이 있으면 `angleFrames` 필요. 어떤 living 항목이든 이 등급을 나열하면 `living` 필요. 없으면 `COLLECTIBLE_NOT_READY`.
- `collectibleSnapshot`(`rules.ts:379-403`): `greeting`은 가장 구체적인 override(등급+테마 > 등급 > 테마 > 기본, 동점은 배열 순서) — 여전히 문자열 하나다. `animation`은 첫 `loop` 모션 타입 또는 `'still'`(v1 enum, 업그레이드된 v1과 오늘 결과가 같다). 새 필드: `motions:[{type,playback,particle?}]`, `backImageDataUrl`, `angleFrames`, `living`. 획·마스크·원본은 절대 포함하지 않는다. 라우트·권한 변경 없음.
- 본문 상한: 8 MiB 유지(`collectible-project.ts:3`). v2 추정 ≤3등급 × (이미지 ~120K + 뒷면 ~30K + 프레임 ~250–450K + living ~80K) ≈ base64 2.5 MB(오늘은 4등급 ≈ 1.4 MB). 편집기 크기 사다리: 프레임 한 변 448→384→320→256, 화질 .85→.7, `publishSizeProblem` 통과할 때까지, 그 다음은 기존 초과 안내. QA에서 413을 보면 12 MiB로 올리는 것을 대비(WP1에서 검토한 설정 변경).
- 저장: migration 없음. 스프라이트는 불변 `collectible_publication_grades.detail`에 산다. v1 행은 다시 쓰지 않는다.

## 웹 렌더러/편집기 기능별 (WP2·WP3, 이 브랜치 범위 밖)

- 스티커: `resolveSticker(s, gradeId)`(model)을 `frontFor`(`renderer.mjs:240`)가 쓴다. `stickerLayer`(`:206-221`)는 1.2줄 간격으로 줄을 나누고 `align`으로 중앙 정렬된 블록 안에 앵커하며 `imageFor`로 마스코트 포즈를 그린다. 편집기(`editor.mjs:127-135`): 텍스트 입력 → textarea, 정렬 select, "이 등급만 따로 배치" 토글이 `layouts[selectedGrade]`를 쓰고 "공통으로 되돌리기"가 있다. 등급 삭제는 그 등급의 layouts와 override 참조를 지운다.
- 뒷면: 새 `backFor(project, gradeId, size, merchantName)`. 기본: 바탕색·안쪽 테두리·가게 이름·수집품 이름·등급·마스코트 도장. 커스텀: 뒷면색 + 뒷면 스티커. 편집기: 같은 스티커 컨트롤에서 앞/뒤 전환. 효과 대상은 앞면 전용 유지. `drawVolume`의 뒷면 분기(`:279-281`)가 뒷면 캔버스를 그리고, 뷰어·Android는 `backImageDataUrl`을 그리며 v1은 오늘의 모습으로 대체한다.
- 모션: 템플릿마다 재생 방식 라디오(`editor.mjs:147`), confetti면 파티클 select. 순수 `particleAt(kind,i,phase)`(model)가 `:293-299`를 대체한다. `ONCE_MS` 표는 model과 Android에 둔다: rotate 4000, shine/sparkle/stamp 3500, float/pulse 2400, confetti 2000.
- 인사말: `:153` 아래에 override 목록, `gradeChecks`와 테마 이름 입력 재사용. 서버가 텍스트를 최종 결정한다.
- 패럴랙스: `brushTarget` 상태(`photo`|`parallax`|`living:<id>`)가 자르기 캔버스 위 사진 브러시 포인터 코드를 색 오버레이와 함께 재사용한다. 순수 `strokeAlpha(strokes,w,h)`(`processPhotoPixels`처럼 node로 시험 가능)를 `cropTransform`으로 매핑한다. `frontFor`에서: s = sin(angle)·strength/100·0.04·size; 배경은 (1+.08·strength/100)배 확대 후 −s/2 이동; 전경(사진 ∩ 마스크)은 +s; 스티커는 +1.2s; 테두리는 고정. 사진 효과는 합성 뒤에 적용한다(`:229-237`). 마스크는 획 키로 캐시한다. 자동 분리는 없다(오너가 직접 칠한다, ML 없음).
- Living picture: 스티커 대상은 자기만의 분리된 레이어를 변형한다. 영역의 `sway`/`bob`은 (사진 ∩ 영역 마스크)의 변형된 사본을 정지 포즈 위에 그린다(각도 6°/3% 상한). `steam`은 영역에 잘린 위로 솟아 흐려지는 김 줄기다. `blink`는 한 주기당 160ms 동안 `<pose>-blink.png`로 바꾼다. 게시본: 각도 0의 living 레이어만, 패딩된 합집합 박스로 잘라, 칸 수는 `periodMs/100`을 8..24로 clamp. 각도 프레임은 living 대상 스티커를 뺀다. `imageDataUrl`은 옛 클라이언트를 위해 정지 포즈를 유지한다.
- 각도 프레임: `serializeDerived(project,{gradeIds: 연결된 등급, merchantName})`가 이미지·썸네일·뒷면, 필요하면 12개의 `frontFor(size, −82.5+15i)` 칸, living 스프라이트를 만든다. 효과 없는 스티커 레이어는 각도 사이에 캐시한다.
- 뷰어(`viewer.mjs:127`): `angleFrames`가 있으면 가장 가까운 두 칸을 섞고(`angleFrameIndex`), living 오버레이는 시간으로, 뒷면 이미지, loop 모션은 자동재생, `once` 모션은 "획득 장면 다시 보기".
- 웹 기울임: `deviceorientation` 감마 오프셋(켤 때 잡음, 저역통과 .2, ±30°); iOS `requestPermission()`은 토글 클릭에서; 미지원·동작 줄이기면 토글 숨김; `visibilitychange`에서 정지. 편집기에는 기울임 없음.

## Android (WP4, 이 브랜치 범위 밖, WP1 픽스처 필요, #283 병합 뒤 — 공유 파일 때문)

- `PublishedCollectible`에 `backImageDataUrl?`, `angleFrames?`, `living?`(periodMs·box 포함), `motions?` 추가. v1 필드는 엄격함 유지. 새 필드는 각각 독립 검증하고 유효하지 않으면 그 필드만 버린다(v1 렌더링으로 폴백); 잘못된 새 필드 하나가 상세 전체를 거절하지 않는다.
- 프레임 플레이어: `FaceSprite` = 4·face × 3·face 크기 Image를 칸 위치로 옮긴 클리핑 View, 기존 scaleX 변형(230번 줄) 안에서 두 칸을 opacity로 섞는다. 슬랩은 `imageDataUrl` 그대로. 뒷면은 뒷면 이미지(231번 줄). living 오버레이는 `box`에 잘린 스프라이트, 칸 = `floor((t mod period)/period·count)`. 파티클은 같은 `particleAt` 수식을 쓰는 종류별 View.
- 60ms 인터벌 두 개(131·148번 줄)를 티커 하나로 합친다.
- 인트로: 획득 링크로 열었을 때(`index.tsx:136-142`) `intro`를 넘겨 `once` 모션 먼저, 그다음 첫 `loop` 모션이 자동재생.
- 기울임: 새 `collectible-tilt.tsx`의 `<TiltSensor>`가 `useAnimatedSensor(GRAVITY,{interval:50})`를 쓴다. 토글 켜짐·동작 허용·앱 포그라운드일 때만 마운트. atan2 → 도, 2° 데드존, 저역통과, ±30° clamp, 정수 도만 값이 바뀔 때 JS로. 부호·게인은 조정 가능한 보정 상수로 남긴다.
- 동작 줄이기: 자동재생 없음, 인트로 없음, living 칸 0, 파티클 없음, 기울임 꺼짐/비활성. 수동 슬라이더는 여전히 프레임을 바꾼다.
- APK: 새 패키지·새 권한 없음(20 Hz ≪ 200 Hz 문턱).

## 작업 분할

- **WP1 스키마 v2 + 서버(민감: 신뢰 경계 검증 + 보유자가 받는 내용, 서로 다른 모델 2건 리뷰 = Claude sonnet + Codex gpt-6.1-sol) — 이 문서가 기준으로 삼는 범위, 완료.** 파일: `collectible-model.mjs`(상수·업그레이더·순수 리졸버 `resolveSticker`·`resolveGreeting`·`particleAt`·`angleFrameIndex`·`ONCE_MS`), `collectible-project-rules.ts`, `collectible-project.ts`, `postgres/collectible-project.ts`(:35, :253), `collectible-project-test-support.ts`, `tests/fixtures/collectible-{v1,v2-upgraded,vectors}.json`, `docs/COLLECTIBLE_CREATOR.md`, `apps/api/README.md`, 이 명세.
- WP2 웹 A: 스티커, 뒷면, 모션 재생, 파티클, 인사말 개별화, 연결된 등급만 파생, 뷰어 인트로/loop. 파일: renderer, editor, viewer; 승인된 `apps/mobile/assets/images/mascot/v2`에서 복사한 웹 마스코트 포즈.
- WP3 웹 B: 패럴랙스, living picture, 각도+living 스프라이트, 크기 사다리, 뷰어 프레임/크로스페이드/기울임. 같은 3개 파일 + 편집기 `publishSizeProblem`.
- WP4 Android(WP1 픽스처 필요, 공유 파일 때문에 #283 병합 뒤): `collectible-artwork.ts`, `collectible-motion.ts`, `collectible-detail.tsx`, 새 `collectible-tilt.tsx`, `collection/index.tsx`. 에뮬레이터 E2E는 WP3 이후.
- 그림: `mascot-stamp-blink.png`(그 외 blink 포즈)는 Codex 드로잉. 도착 전까지 `MASCOT_BLINK`는 비어 있다.

## 시험 계획

- **WP1(완료):** API 단위 — v1 픽스처가 정확히 golden v2로 올라감(같은 golden을 model.mjs 사이트 시험도 같이 검사), 멱등. 목록에 있는 항목당 거절 시험 1건(유한하지 않은 값, 범위 초과, 알 수 없는 키, 매달린 등급/스티커 참조, 앞뒤 통틀어 중복 ID, `\r` 또는 5줄, 알 수 없는 포즈, mascot이 아닌 스티커의 blink, 타입에 안 맞는 particle, 스프라이트 치수 오류, 애니메이션 WebP 스프라이트, 과대 스프라이트, 박스 넘침). 요구사항별 게시 준비; 인사말 우선순위 벡터. 노출 검사: 스냅샷 JSON에 `strokes`/`originalDataUrl`이 없음. PostgreSQL 통합: 원본 v1 detail 행이 byte-identical로 반환, v2 게시가 `getAcquired`를 왕복, v1 PUBLISHED 복사가 v2 초안을 내놓음, 옛 편집기의 v1 PUT이 수용됨.
- WP2: `resolveSticker`, 줄 배치, `particleAt` 벡터, 등급 삭제 시 정리의 node 시험. 미니 DOM 흐름: 배치 토글이 `layouts[등급]`을 쓰는지, 뒷면 모드, 재생 라디오, override 추가/삭제, 연결된 등급만 파생. 브라우저 스크린샷(chrome-devtools).
- WP3: node 시험 `strokeAlpha`, `angleFrameIndex`(−90, −82.5, 0, 82.5, 90, 뒷면), `parallaxOffset`, living 주기성(t=0 == t=주기), 스프라이트 수식 ≤4096, 가짜 바이트 추정기로 크기 사다리. 브라우저: 홀로그램+패럴랙스+living을 담은 QA 픽스처 게시; 칸 0/6/11이 홀로그램 영역에서 다름; 에뮬레이트한 deviceorientation; 동작 줄이기 정지 화면.
- WP4: v1 픽스처가 이전과 똑같이 파싱됨; v2 파싱; 잘못된 새 필드는 나머지를 거절하지 않고 버려짐; `animation` enum 불변; 프레임/파티클/칸 벡터가 공유 픽스처와 일치; 기울임 매핑; 인트로 순서; typecheck, lint, `export:android`. 에뮬레이터: v1 불변; −60/0/60°의 홀로그램; `adb emu sensor set acceleration`; 동작 줄이기; 뒷면. 이전 APK에서 v2 수집품 열기.

## 위험

- 게시 때 413 → 연결된 등급만, 기본/마스크 없음, 크기 사다리, 12 MiB 폴백.
- 옛 APK → 추가 전용, `animation`은 v1 enum, 이전 APK로 검증.
- 웹/Android 계산 어긋남 → 두 시험 모두에 공유 벡터 픽스처.
- Android 메모리: 1792×1344 스프라이트 ≈ 디코딩 시 9.6 MB; 같은 URI의 두 Image가 비트맵을 공유하는지 확인, 아니면 16프레임과 가장 가까운 칸만 쓴다.
- Living picture 잔상은 진폭 상한으로 막되, living 스티커 오버레이는 패럴랙스를 받지 않고 각도 0 재질을 유지한다(알려진 한계, `ponytail:` 주석).
- 게시 시간: 프레임 36장 렌더링; 진행률 표시; 스티커 레이어 캐시.
- 배터리: 기울임 켤 때만 센서를 마운트한다.
