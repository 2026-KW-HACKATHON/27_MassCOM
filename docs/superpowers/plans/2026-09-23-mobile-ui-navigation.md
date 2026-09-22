# 모바일 탐색·방문·도감 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 기존 인증·지갑·API 경계를 유지하면서 Android 앱에 네 기본 탭과 더 읽기 쉬운 탐색·방문·도감·내 정보 화면을 제공한다.

**Architecture:** 루트 AuthSessionProvider/AppKitProvider와 Stack은 유지하고, 기존 네 기본 경로만 Expo Router의 (tabs) 그룹에 둔다. 화면별 API hook과 비즈니스 로직은 재사용하며 브랜드 강조색·간격과 화면 배치만 점진적으로 조정한다.

**Tech Stack:** Expo 57.0.24, Expo Router 57.0.22, React Native 0.86.3, 기존 @expo/ui·react-native-svg·Node test/tsx.

**Spec:** docs/superpowers/specs/2026-09-23-mobile-ui-navigation-design.md, DESIGN.md

## Global Constraints

- API·DB, 보상·NFT·양도 정책, Google 인증·지갑 보안 모델을 바꾸지 않는다.
- 기존 /, /claim, /collection, /settings, /open 경로와 masscom scheme·HTTPS 앱 링크를 유지한다.
- 앱 수집품, NFT 접수·확인 중·최종 완료를 섞지 않는다.
- 승인된 음식점·마스코트 사진이 없으면 가짜 사진·방문·협약 실적을 만들지 않는다.
- 새 라이브러리·유료 서비스·Play 공개 제출을 추가하지 않는다.
- RQ-001의 ‘로그인 없이 탐색 VERIFIED’와 현재 루트 인증 게이트의 충돌은 이 UI 변경으로 해결했다고 주장하지 않는다.
- 코드 커밋은 의도 중심 한국어 제목과 실제 검증을 담은 Lore trailer를 사용한다. Issue #126의 한국어 PR 하나로 통합한다.

## Review Focus

1. 기존 /open 링크와 네 기본 URL이 탭 도입 뒤 다른 화면으로 가지 않는가? Task 1의 경로 계약 시험·Task 5의 Android 링크 실기가 확인한다.
2. 계정 A에서 B로 전환해도 이전 도감·지갑 화면이 남지 않는가? Task 1의 루트 공급자 보존 점검·Task 5의 계정 전환 실기가 확인한다. D02 전체 수용은 별도로 기록한다.
3. 200% 글꼴 또는 360dp 폭에서 탭 라벨·수집 수치·버튼이 잘리지 않는가? Task 3/4의 화면 조정·Task 5의 실기 스크린샷이 확인한다.
4. 음식점 0건과 네트워크 실패가 같은 ‘없음’ 상태로 보이지 않는가? Task 3의 기존 로딩/오류/빈 상태 코드 확인·Task 5의 화면 검증이 확인한다.
5. NFT가 QUEUED/CONFIRMING인데 ‘실제 NFT’ 수가 올라가지 않는가? Task 4의 collection-counts 단위 시험과 도감 화면 검증이 확인한다.

## File map

- apps/mobile/src/app/_layout.tsx: 루트 인증·AppKit 경계를 유지하며 (tabs)를 Stack의 첫 화면으로 등록한다.
- apps/mobile/src/app/(tabs)/_layout.tsx: 네 탭의 한국어 이름·아이콘·색·Safe Area를 정의한다.
- apps/mobile/src/app/(tabs)/index.tsx, claim.tsx, collection.tsx, settings.tsx: 기존 route 파일을 내용 변경 없이 이동한다.
- apps/mobile/src/navigation/tab-glyph.tsx: 이미 설치된 react-native-svg로 네 탭의 작은 선 아이콘만 그린다.
- apps/mobile/src/navigation/primary-tabs.test.ts: 네 route 파일, 탭 이름, 루트 그룹의 정적 계약을 검사한다.
- apps/mobile/src/theme/palette.ts, colors.test.ts, ui-metrics.ts: 라이트·다크 브랜드 강조색의 대비와 소수의 간격·터치 크기 토큰을 정의한다. Android 시스템 의미색을 쓰는 colors.ts 전체는 교체하지 않는다.
- apps/mobile/src/screens/merchant-list/index.tsx: 긴 소개와 중복 이동 버튼을 줄이고 실제 목록/빈 상태를 앞당긴다.
- apps/mobile/src/screens/collection/collection-counts.ts, collection-counts.test.ts, index.tsx: 수집 수치의 안전한 계산과 간결한 정보 계층.
- apps/mobile/src/screens/claim-redeem/index.tsx, account-settings/index.tsx: 기존 행동을 보존한 채 인증/계정 화면의 시각 계층과 터치·글자 배치를 정리한다.
- README.md, apps/mobile/README.md, docs/PROJECT_STATE.md, docs/TEST_STATUS.md, docs/HANDOFF.md: 실제 코드·검증에 맞춘 상태 기록.

---

### Task 1: 네 기본 탭과 기존 경로를 같은 라우터에 연결

**Files:**
- Create: apps/mobile/src/app/(tabs)/_layout.tsx
- Create: apps/mobile/src/navigation/tab-glyph.tsx
- Create: apps/mobile/src/navigation/primary-tabs.test.ts
- Modify: apps/mobile/src/app/_layout.tsx
- Move: apps/mobile/src/app/{index,claim,collection,settings}.tsx → apps/mobile/src/app/(tabs)/

**Interfaces:**
- Consumes: AuthSessionProvider, useAuthSession, AppKitProvider, colorsForScheme.
- Produces: 기존 URL을 유지하는 (tabs) 그룹과 TabGlyph({ name: 'explore' | 'claim' | 'collection' | 'account', color: string, size: number }).

- [ ] **Step 1: 경로 계약의 실패 시험 작성.** 새 primary-tabs.test.ts에 아래 내용을 넣는다.

~~~ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const app = fileURLToPath(new URL('../app/', import.meta.url));

test('four primary routes live under one tab group without duplicate root files', () => {
  for (const name of ['index', 'claim', 'collection', 'settings']) {
    assert.ok(existsSync(join(app, '(tabs)', name + '.tsx')), name);
    assert.equal(existsSync(join(app, name + '.tsx')), false, name);
  }
  assert.ok(existsSync(join(app, 'open.tsx')), 'external app link route');
  const root = readFileSync(join(app, '_layout.tsx'), 'utf8');
  assert.match(root, /name="\(tabs\)"/);
  assert.match(root, /key=\{auth\.accountId\}/);
});

test('tab labels describe the four primary user jobs', () => {
  const layout = readFileSync(join(app, '(tabs)', '_layout.tsx'), 'utf8');
  for (const title of ['탐색', '방문 인증', '도감', '내 정보']) {
    assert.ok(layout.includes(title), title);
  }
});
~~~

- [ ] **Step 2: RED 확인.** apps/mobile에서 ./node_modules/.bin/tsx --test src/navigation/primary-tabs.test.ts를 실행한다. 기대: (tabs) 파일이 없어 실패.
- [ ] **Step 3: route 파일을 git mv로 이동하고 최소 Stack/Tabs 연결.** 루트 Routes()의 Stack 첫 항목을 다음처럼 바꾸고 기존 상세·추천·지갑·점주 Stack 항목은 유지한다. open.tsx는 기존처럼 루트의 파일 기반 route로 둔다.

~~~tsx
<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
~~~

새 (tabs)/_layout.tsx는 expo-router의 Tabs를 사용한다. 네 Tabs.Screen의 name은 index, claim, collection, settings이고 title은 탐색, 방문 인증, 도감, 내 정보다. useColorScheme()에서 colorsForScheme을 받아 header/tabBar의 배경·텍스트·선택색을 지정한다. 아이콘은 TabGlyph를 사용하며 Android 화면 읽기 라벨에는 한국어 title을 그대로 제공한다.

- [ ] **Step 4: TabGlyph 구현.** react-native-svg의 Svg/Path/Circle/Rect만 사용한다. 네 도형은 탐색 돋보기, 방문 확인 표시, 도감 격자, 계정 사람 윤곽이다. 텍스트·이모지 아이콘이나 새 아이콘 패키지를 추가하지 않는다.

~~~tsx
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type GlyphName = 'explore' | 'claim' | 'collection' | 'account';

export function TabGlyph({ name, color, size }: {
  name: GlyphName; color: string; size: number;
}) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const };
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    {name === 'explore' ? <>
      <Circle cx="10.5" cy="10.5" r="6.5" {...stroke} />
      <Path d="M15.5 15.5 21 21" {...stroke} />
    </> : null}
    {name === 'claim' ? <>
      <Rect x="4" y="4" width="16" height="16" rx="3" {...stroke} />
      <Path d="m8 12 3 3 5-6" {...stroke} />
    </> : null}
    {name === 'collection' ? <>
      <Rect x="4" y="4" width="7" height="7" rx="1" {...stroke} />
      <Rect x="13" y="4" width="7" height="7" rx="1" {...stroke} />
      <Rect x="4" y="13" width="7" height="7" rx="1" {...stroke} />
      <Rect x="13" y="13" width="7" height="7" rx="1" {...stroke} />
    </> : null}
    {name === 'account' ? <>
      <Circle cx="12" cy="8" r="3.5" {...stroke} />
      <Path d="M5 20c.5-3.4 3-5 7-5s6.5 1.6 7 5" {...stroke} />
    </> : null}
  </Svg>;
}
~~~
- [ ] **Step 5: GREEN과 회귀 확인.** 위 단일 시험 PASS 뒤 npm test --prefix apps/mobile, npm run typecheck --prefix apps/mobile, npm run export:android --prefix apps/mobile을 한 번 실행한다. 중복 route 또는 기존 /open 타입 오류가 있으면 이 Task에서 해결한다.
- [ ] **Step 6: 커밋.** UI 코드·시험만 stage하고, 기존 URL·계정별 AppKit 보존을 Constraint/Directive trailer에 남긴다.

### Task 2: 검증 가능한 따뜻한 강조색과 최소 UI 토큰

**Files:**
- Modify: apps/mobile/src/theme/palette.ts
- Modify: apps/mobile/src/theme/colors.test.ts
- Create: apps/mobile/src/theme/ui-metrics.ts

**Interfaces:**
- Consumes: AppColors, colorsForScheme.
- Produces: accentContainer/onAccentContainer 색 쌍과 uiMetrics의 pageInset/sectionGap/cardRadius/minTouch.

- [ ] **Step 1: 실패하는 대비 시험 작성.** colors.test.ts의 기존 contrastPairs와 키 목록에 accentContainer/onAccentContainer을 추가한다. 기존 오류·성공 쌍은 제거하지 않는다. 라이트·다크 모두 4.5:1 이상이어야 하므로 기존 코드에서 RED가 난다.

~~~ts
// Existing contrastPairs array receives this additional entry:
['onAccentContainer', 'accentContainer'],
~~~

- [ ] **Step 2: 최소 팔레트·간격 구현.** AppColors에 두 키를 추가하고 light accentContainer=#F7E8C9, onAccentContainer=#4D3516, dark accentContainer=#45371B, onAccentContainer=#F8E9CC를 넣는다. 이 쌍의 계산 대비는 각각 9.44:1, 9.65:1이다. ui-metrics.ts는 다음 네 값만 내보낸다.

~~~ts
export const uiMetrics = {
  pageInset: 20,
  sectionGap: 24,
  cardRadius: 20,
  minTouch: 48,
} as const;
~~~

실제 Android 일반 텍스트·배경은 colors.ts의 시스템 의미색을 유지한다. 새 팔레트 색은 탐색/도감의 브랜드 강조 영역에서 useColorScheme()에 따라 명시적으로 적용한다. 전체 화면 색을 한 번에 강제하지 않는다.

- [ ] **Step 3: GREEN과 회귀 확인.** ./node_modules/.bin/tsx --test src/theme/colors.test.ts (apps/mobile 작업 디렉터리), npm run typecheck --prefix apps/mobile을 실행한다. 기존 의미색 대비 시험도 유지한다.
- [ ] **Step 4: 커밋.** 토큰 추가가 기존 오류·성공 상태색을 바꾸지 않았음을 Tested trailer에 적는다.

### Task 3: 탐색 첫 화면의 정보 밀도와 정직한 상태

**Files:**
- Modify: apps/mobile/src/screens/merchant-list/index.tsx
- Test: existing apps/mobile/src/merchant/merchant-api.test.ts
- Evidence: docs/evidence/android-merchant-list.png (기존 baseline), 구현 뒤 새 Android 캡처

**Interfaces:**
- Consumes: useMerchantCatalog(apiUrl), uiMetrics, colorsForScheme.
- Produces: 동일 PublicMerchant 데이터·링크를 가진 더 짧은 탐색 화면. API 인터페이스 변경 없음.

- [ ] **Step 1: baseline을 RED 증거로 고정.** 기존 android-merchant-list.png에서 긴 소개와 중복 버튼 때문에 첫 음식점이 늦게 보임을 확인한다. 360dp 폭의 목표는 첫 화면에 ‘동네 음식점’ 제목과 첫 카드 상단 또는 정직한 빈 상태가 보이는 것이다.
- [ ] **Step 2: 작은 화면 변경.** merchant-list/index.tsx에서 title을 26/33 정도로, 소개를 2~3줄로, header gap을 10~12로 줄인다. 방문·도감·계정으로 중복 이동하는 primaryActions/quickActions를 제거하고, 추천 경로는 sectionHeading 옆의 한 맥락 링크로 둔다. 지갑은 도감에서 선택적으로 진입하게 하며 탐색 화면의 필수 행동처럼 보이지 않게 한다. 점주 도구는 Task 4의 내 정보 보조 링크로 이동한다.

~~~tsx
<View style={styles.sectionHeading}>
  <Text style={styles.sectionEyebrow}>동네 음식점</Text>
  <Link href="/recommendations" asChild>
    <Pressable accessibilityRole="button" accessibilityLabel="다음 가게 추천 보기">
      <Text style={styles.recommendationActionText}>추천 보기 →</Text>
    </Pressable>
  </Link>
</View>
~~~

- [ ] **Step 3: 데이터 상태 보존.** loading+0건은 로딩, error+0건은 오류·재시도, 성공+0건은 빈 상태를 계속 따로 렌더링한다. error+기존 목록이면 목록을 유지하고 inlineError를 보인다. MerchantCard의 실제 name/story/roadAddress/campaign/DEMO 표시는 유지한다.
- [ ] **Step 4: 검증.** npm test --prefix apps/mobile에서 merchant-api 시험을 포함해 PASS, typecheck·lint PASS를 확인한다. Android 360/390dp 화면에서 첫 목록/빈 상태의 위치를 캡처하고 baseline과 비교한다. 실기 캡처를 못 하면 그 항목은 NOT_RUN으로 기록한다.
- [ ] **Step 5: 커밋.** 실제 점포·이미지를 추가하지 않았다는 Directive를 남긴다.

### Task 4: 방문·도감·내 정보의 단계와 안전한 상태 표시

**Files:**
- Create: apps/mobile/src/screens/collection/collection-counts.ts
- Create: apps/mobile/src/screens/collection/collection-counts.test.ts
- Modify: apps/mobile/src/screens/collection/index.tsx
- Modify: apps/mobile/src/screens/claim-redeem/index.tsx
- Modify: apps/mobile/src/screens/account-settings/index.tsx

**Interfaces:**
- Consumes: CollectionSnapshot, 기존 ClaimRedeemScreen/AccountSettingsScreen props와 API 호출.
- Produces: collectionCounts(snapshot: CountInput) → { visits: number; appCollectibles: number; finalizedNfts: number }. CountInput은 방문 배열과 nftStatus만 가진 수집품 배열이므로 기존 CollectionSnapshot을 그대로 받을 수 있다. 기존 발행·삭제 함수의 호출 순서는 변경하지 않는다.

- [ ] **Step 1: NFT 수치 RED 시험.** 새 collection-counts.test.ts에 방문 1, 앱 수집품 4, 상태 NOT_REQUESTED/QUEUED/CONFIRMING/FINALIZED 각 1인 fixture를 만들고 실제 NFT 수 1을 기대한다. fixture는 시험 파일 안에서만 사용한다.

~~~ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectionCounts } from './collection-counts';

test('queued and confirming collectibles are not finalized NFTs', () => {
  const snapshot = {
    visits: [{}],
    collectibles: [
      { nftStatus: 'NOT_REQUESTED' },
      { nftStatus: 'QUEUED' },
      { nftStatus: 'CONFIRMING' },
      { nftStatus: 'FINALIZED' },
    ],
  } as const;
  assert.deepEqual(collectionCounts(snapshot), {
    visits: 1,
    appCollectibles: 4,
    finalizedNfts: 1,
  });
});
~~~

- [ ] **Step 2: RED 후 최소 구현.** apps/mobile에서 ./node_modules/.bin/tsx --test src/screens/collection/collection-counts.test.ts를 실행해 미구현 실패를 확인하고, 아래 함수만 추가한다.

~~~ts
import type { CollectionSnapshot } from '@/commerce/commerce-api';

type CountInput = {
  visits: readonly unknown[];
  collectibles: readonly Pick<CollectionSnapshot['collectibles'][number], 'nftStatus'>[];
};

export function collectionCounts(snapshot: CountInput) {
  return {
    visits: snapshot.visits.length,
    appCollectibles: snapshot.collectibles.length,
    finalizedNfts: snapshot.collectibles.filter((item) => item.nftStatus === 'FINALIZED').length,
  };
}
~~~

- [ ] **Step 3: 도감 배치.** 기존 countRow는 collectionCounts 결과를 사용한다. 짧은 제목과 세 수치를 상단에 유지하되 좁은 폭/큰 글씨에서는 세로 배치한다. 수집품 카드는 ‘앱 수집 완료’와 nftLabel(status)를 계속 별도 텍스트로 표시하고 접수·확인 중·최종 완료를 합치지 않는다. useColorScheme 기반 강조 배경에 Task 2의 onAccentContainer를 사용한다.

~~~tsx
const summary = collectionCounts(collection);
<View style={styles.countRow}>
  <Count label="방문" value={summary.visits} />
  <Count label="앱 수집품" value={summary.appCollectibles} />
  <Count label="실제 NFT" value={summary.finalizedNfts} />
</View>
~~~

- [ ] **Step 4: 방문·내 정보 배치.** claim-redeem에서는 QR 스캔/코드 입력 → 미리보기 → 수령 확정 순서를 시각적으로 구분하지만 inspect/redeem, 중복/실패 복구, 카메라 권한 로직은 건드리지 않는다. account-settings에서는 현재 운영 계정과 로그아웃/전환을 상단에 두고, 점주 도구 보조 링크를 한 곳에 둔다. 삭제 안내·확인 Alert·차단 문구는 삭제/완화하지 않는다. 48dp 터치 영역과 줄바꿈을 보장한다.

~~~tsx
<Link href="/merchant" asChild>
  <Pressable accessibilityRole="button" style={styles.secondaryLink}>
    <Text style={styles.secondaryLinkText}>점주용 방문 확인</Text>
  </Pressable>
</Link>
~~~

- [ ] **Step 5: GREEN과 회귀 확인.** 새 counts 시험, npm test --prefix apps/mobile, typecheck, lint를 실행한다. 실기에서 빈/로딩/오류와 앱 수집품·실제 NFT 문구를 확인하며 자동 fixture만으로 실기 PASS를 만들지 않는다.
- [ ] **Step 6: 커밋.** 화면 재배치만 했고 발행·삭제·QR 로직은 변경하지 않았음을 Tested/Not-tested trailer에 적는다.

### Task 5: Android 실기·문서·한국어 PR 통합

**Files:**
- Modify: README.md, apps/mobile/README.md, docs/PROJECT_STATE.md, docs/TEST_STATUS.md, docs/HANDOFF.md (실제로 확인된 내용만)
- Add evidence if captured: docs/evidence/screenshots/ 아래 날짜가 붙은 Android UI 이미지와 짧은 결과 기록

**Interfaces:**
- Consumes: Tasks 1~4의 라우트·화면·시험 결과.
- Produces: 한글 PR 하나와 병합 가능한 검증 증거. 필수 36개 테스트 ID/상태는 관련 실증 없이는 바꾸지 않는다.

- [ ] **Step 1: 정적·자동 회귀.** npm test --prefix apps/mobile, npm run typecheck --prefix apps/mobile, npm run lint --prefix apps/mobile, npm run export:android --prefix apps/mobile, bash tests/bootstrap/verify_bootstrap_test.sh, bash scripts/check-secrets.sh를 실행한다. 전체 secret scan이 Git-ignored 로컬 .env 파일 때문에 실패하면 경로·원인만 기록하고 파일 내용은 열지 않는다.
- [ ] **Step 2: 기기 준비 확인.** adb devices -l로 연결 상태를 보고, 사용자가 기기를 쓰는 중이면 앱을 강제로 앞에 띄우지 않는다. 개발 앱에서 360/390/412dp 또는 이에 가까운 기기·에뮬레이터 화면과 130%/200% 글자 크기, 라이트·다크, TalkBack을 실제 실행한 범위만 기록한다.
- [ ] **Step 3: 이동·안전 실기.** 네 탭, 음식점 상세/추천, QR/코드 화면, 도감, 계정 전환 뒤 화면 상태, Android 뒤로 가기, masscom://open과 https://masscom.kr/open을 확인한다. 외부 지갑 서명·D02 전체 격리·Play 설치는 이 UI 확인만으로 PASS로 만들지 않는다.
- [ ] **Step 4: 문서 정합.** README의 실제 화면/실행 방법, PROJECT_STATE의 구현 상태, TEST_STATUS의 명령·커밋·기기·결과, HANDOFF의 정확한 재개 지점을 갱신한다. 발견한 RQ-001 충돌은 해결 전까지 별도 미해결로 남긴다.
- [ ] **Step 5: PR과 통합.** 관련 파일만 commit/push한다. 한국어 PR 제목·본문에 목적, 요구사항, 변경, 실제 테스트, 화면 증거, 보안·DB 영향 없음, 남은 문제, 되돌리기를 쓴다. bash scripts/check-pr-korean.sh "$PR_TITLE" "$PR_BODY"를 실제 값으로 통과시킨 뒤 Issue #126을 연결해 PR 하나를 연다. 필수 CI·리뷰를 우회하지 않고 merge하며 main CI를 확인한다.

## Plan self-review

- Spec coverage: 네 기본 탭/URL(Task 1), 시각 언어·대비(Task 2), 탐색(Task 3), 방문·도감·계정(Task 4), Android·문서·PR(Task 5).
- 비목표: API·DB·보상·NFT·인증·지갑 정책 변경과 가짜 이미지/콘텐츠 생성 없음.
- 검증 경계: 기존 36개 테스트 상태는 별도 실증 없이 변경하지 않음. Android 실기를 못 하면 NOT_RUN.
