# 하늘 동네·여권 도장 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 흰 바탕의 밋밋한 Android 앱을 하늘 동네 배경·떠 있는 카드·여권 도장·마스코트 연출이 있는 앱으로 바꾼다.

**Architecture:** 색·그림자·연출 값은 `src/theme/world.ts`, 순수 연출 계산은 `src/motion/`, 재사용 화면 조각은 `src/ui/`에 둔다. 각 화면은 이 조각을 조합만 하고 데이터·API 호출은 그대로 둔다. 하단 탭은 expo-router `tabBar` 교체로 떠 있는 세 칸 바가 되고 `내 정보`는 머리글 아바타로 이동한다.

**Tech Stack:** Expo SDK 57, expo-router, React Native 0.86, react-native-reanimated 4.5.1, react-native-svg 15.15.4, expo-haptics(지연 import), 시험은 `tsx --test`(node:test, 소스·스타일 객체 검사).

**Spec:** `docs/superpowers/specs/2026-09-29-sky-town-redesign-design.md`

> **구현 뒤 메모:** 이 계획의 코드 조각은 착수 시점의 초안이다. 색(도장 주황 `#CA6E29`, 종이 선 `#A77C46`)과 스크롤 구조(그림이 `SkyBackdrop` 고정 배경이 아니라 `SkyArt`로 머리글 안에 들어가 내용과 함께 스크롤, `SkyScrollView`·`BackHeader`·머리글 반투명 패널 추가)는 구현 중 바뀌었다. 바뀐 내용은 스펙 10절 "구현 중 바뀐 점"과 코드가 정본이다.

## Global Constraints

- 새 npm 의존성 추가 금지(`react-native-reanimated`, `react-native-svg`, `expo-haptics`만 사용).
- 본문 글자 대비 4.5:1 이상, 큰 글자·그래픽 3:1 이상. 투명도로 글자를 흐리게 하지 않는다.
- 터치 대상 최소 48dp(`uiMetrics.minTouch`).
- `useReducedMotion()`이 true면 모든 연출은 즉시 최종 상태.
- API·DB·권한·보상 규칙·정직성 문구(가상 점포·앱 수집품·NFT 구분)는 바꾸지 않는다.
- 운영 번들에 시연 전용 점포 그림을 넣지 않는다(`*.showcase.ts` 선택 구조 유지).
- 그림 자산 합계 약 2MB 이하, 포즈 파일당 약 150KB 목표(최대 250KB).
- 커밋 메시지는 한국어, `Refs #224`, Co-Authored-By 줄 금지.

## Review Focus

- 다크 모드에서 하늘 배경 위 글자·카드 대비가 떨어지는 경우 → `world.test.ts`가 라이트·다크 모두 대비를 검사한다(Task 2).
- 글자 200%에서 떠 있는 탭 바·헤더가 잘리는 경우 → 탭 바 높이는 `fontScale >= 1.5`에서 늘어나고 라벨은 `maxFontSizeMultiplier`를 둔다(Task 5 시험).
- 점포가 많아 진입 연출이 길어지는 경우 → `staggerDelay`가 8번째 이후 지연을 더하지 않는다(Task 3 시험).
- 동작 줄이기 사용자에게 구름·숨쉬기가 계속 움직이는 경우 → 공통 `useMotionEnabled` 분기 시험(Task 3, 4).
- `내 정보` 탭을 없앤 뒤 계정 삭제·로그아웃에 닿지 못하는 경우 → 모든 탭 화면 머리글에 `/settings` 링크가 있는지 소스 시험(Task 5).

---

### Task 1: 마스코트 그림 자산 정리

Codex가 만든 원본(`apps/mobile/assets/images/mascot/v2/*.png`, 1024px 이상)을 앱용 크기로 줄이고 목록 모듈을 만든다.

**Files:**
- Create: `apps/mobile/scripts/optimize-mascot-art.py`
- Modify: `apps/mobile/assets/images/mascot/v2/*.png` (최적화 결과로 교체)
- Create: `apps/mobile/src/ui/mascot-art.ts`
- Test: `apps/mobile/src/ui/mascot-art.test.ts`

**Interfaces:**
- Produces: `export type MascotPose = 'wave' | 'explore-map' | 'stamp' | 'gift' | 'sleep' | 'puzzled' | 'friends' | 'search' | 'cheer' | 'logo-badge'`, `export const mascotArt: Record<MascotPose, number>`, `export const skyTownHeader: number`, `export const MASCOT_POSES: readonly MascotPose[]`.

- [ ] **Step 1: 최적화 스크립트 작성**

```python
#!/usr/bin/env python3
"""Codex 원본을 앱용 크기로 줄인다. 포즈는 긴 변 512px·팔레트 PNG(알파 유지), 배경은 1080px."""
import sys
from pathlib import Path
from PIL import Image

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'assets/images/mascot/v2')
poses = ['wave', 'explore-map', 'stamp', 'gift', 'sleep', 'puzzled', 'friends', 'search', 'cheer', 'logo-badge']
for name in poses:
    path = root / f'{name}.png'
    image = Image.open(path).convert('RGBA')
    image.thumbnail((512, 512), Image.LANCZOS)
    image.quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
for name, width in [('sky-town-header', 1080), ('town-map', 1080)]:
    path = root / f'{name}.png'
    image = Image.open(path).convert('RGB')
    image.thumbnail((width, width * 2), Image.LANCZOS)
    image.quantize(colors=192, method=Image.Quantize.MEDIANCUT).save(path, optimize=True)
for path in sorted(root.glob('*.png')):
    print(f'{path.name}\t{Image.open(path).size}\t{path.stat().st_size // 1024}KB')
```

- [ ] **Step 2: 실행하고 크기 확인**

Run: `cd apps/mobile && python3 scripts/optimize-mascot-art.py`
Expected: 포즈 10개 각 250KB 이하, 합계 약 2MB 이하. 초과하면 해당 포즈만 `colors=96`으로 다시 실행.

- [ ] **Step 3: 실패하는 시험 작성**

```ts
// apps/mobile/src/ui/mascot-art.test.ts
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../assets/images/mascot/v2/', import.meta.url));
const poses = ['wave', 'explore-map', 'stamp', 'gift', 'sleep', 'puzzled', 'friends', 'search', 'cheer', 'logo-badge'];

test('every mascot pose ships as a small transparent PNG and is listed in the art module', () => {
  const source = readFileSync(fileURLToPath(new URL('./mascot-art.ts', import.meta.url)), 'utf8');
  let total = 0;
  for (const pose of poses) {
    const bytes = statSync(dir + pose + '.png').size;
    total += bytes;
    assert.ok(bytes <= 250 * 1024, `${pose} is ${bytes} bytes`);
    assert.ok(source.includes(`'${pose}': require('../../assets/images/mascot/v2/${pose}.png')`), pose);
  }
  for (const background of ['sky-town-header', 'town-map']) total += statSync(dir + background + '.png').size;
  assert.ok(total <= 2.5 * 1024 * 1024, `art total ${total} bytes`);
});

test('mascot art sources are recorded', () => {
  const sources = readFileSync(dir + 'SOURCES.md', 'utf8');
  for (const pose of poses) assert.ok(sources.includes(pose), pose);
});
```

- [ ] **Step 4: 실패 확인**

Run: `cd apps/mobile && npx tsx --test src/ui/mascot-art.test.ts`
Expected: FAIL (mascot-art.ts 없음)

- [ ] **Step 5: 목록 모듈 작성**

```ts
// apps/mobile/src/ui/mascot-art.ts
// D-045: 승인된 마스코트와 같은 화풍으로 Codex가 그린 포즈 세트. 출처는 v2/SOURCES.md.
export type MascotPose =
  | 'wave' | 'explore-map' | 'stamp' | 'gift' | 'sleep'
  | 'puzzled' | 'friends' | 'search' | 'cheer' | 'logo-badge';

export const MASCOT_POSES: readonly MascotPose[] = [
  'wave', 'explore-map', 'stamp', 'gift', 'sleep', 'puzzled', 'friends', 'search', 'cheer', 'logo-badge',
];

export const mascotArt: Record<MascotPose, number> = {
  'wave': require('../../assets/images/mascot/v2/wave.png'),
  'explore-map': require('../../assets/images/mascot/v2/explore-map.png'),
  'stamp': require('../../assets/images/mascot/v2/stamp.png'),
  'gift': require('../../assets/images/mascot/v2/gift.png'),
  'sleep': require('../../assets/images/mascot/v2/sleep.png'),
  'puzzled': require('../../assets/images/mascot/v2/puzzled.png'),
  'friends': require('../../assets/images/mascot/v2/friends.png'),
  'search': require('../../assets/images/mascot/v2/search.png'),
  'cheer': require('../../assets/images/mascot/v2/cheer.png'),
  'logo-badge': require('../../assets/images/mascot/v2/logo-badge.png'),
};

export const skyTownHeader: number = require('../../assets/images/mascot/v2/sky-town-header.png');
```

- [ ] **Step 6: 통과 확인 후 커밋**

Run: `cd apps/mobile && npx tsx --test src/ui/mascot-art.test.ts` → PASS

```bash
git add apps/mobile/scripts/optimize-mascot-art.py apps/mobile/assets/images/mascot/v2 apps/mobile/src/ui/mascot-art.ts apps/mobile/src/ui/mascot-art.test.ts
git commit -m "Codex 마스코트 포즈 세트를 앱 크기로 줄여 넣는다" -m "Refs #224"
```

---

### Task 2: 하늘 동네 색·모양 토큰

**Files:**
- Create: `apps/mobile/src/theme/contrast.ts`
- Create: `apps/mobile/src/theme/world.ts`
- Test: `apps/mobile/src/theme/world.test.ts`

**Interfaces:**
- Produces: `contrast(foreground: string, background: string): number`; `export type WorldTheme = { sky: readonly [string, string, string]; skyInk: string; skyMuted: string; card: string; cardInk: string; cardMuted: string; cardShadow: string; paper: string; paperInk: string; paperLine: string; stampOrange: string; stampInk: string; tabBar: string; tabActive: string; tabInactive: string; radius: { card: number; chip: number; tabBar: number }; }`; `lightWorld`, `darkWorld`, `worldForScheme(scheme)`.

- [ ] **Step 1: 실패하는 시험 작성**

```ts
// apps/mobile/src/theme/world.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrast } from './contrast';
import { darkWorld, lightWorld, worldForScheme } from './world';

test('world text stays readable on its own surfaces in light and dark', () => {
  for (const world of [lightWorld, darkWorld]) {
    for (const sky of world.sky) {
      assert.ok(contrast(world.skyInk, sky) >= 4.5, `skyInk on ${sky}`);
      assert.ok(contrast(world.skyMuted, sky) >= 4.5, `skyMuted on ${sky}`);
    }
    assert.ok(contrast(world.cardInk, world.card) >= 4.5);
    assert.ok(contrast(world.cardMuted, world.card) >= 4.5);
    assert.ok(contrast(world.paperInk, world.paper) >= 4.5);
    assert.ok(contrast(world.stampInk, world.paper) >= 4.5);
    assert.ok(contrast(world.stampOrange, world.card) >= 3, 'stamp orange is a graphic accent');
    assert.ok(contrast(world.tabActive, world.tabBar) >= 4.5);
    assert.ok(contrast(world.tabInactive, world.tabBar) >= 4.5);
  }
});

test('scheme selection falls back to light', () => {
  assert.equal(worldForScheme('dark'), darkWorld);
  assert.equal(worldForScheme(null), lightWorld);
  assert.equal(worldForScheme('unspecified'), lightWorld);
});

test('contrast matches the WCAG formula at the extremes', () => {
  assert.equal(Math.round(contrast('#000000', '#FFFFFF')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd apps/mobile && npx tsx --test src/theme/world.test.ts` → FAIL (모듈 없음)

- [ ] **Step 3: 구현**

```ts
// apps/mobile/src/theme/contrast.ts
/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const [red, green, blue] = [1, 3, 5].map((index) => {
      const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}
```

```ts
// apps/mobile/src/theme/world.ts
// Issue #224 하늘 동네 세계의 장식 토큰. 의미색(행동·성공·오류)은 palette.ts가 정본이다.
export type WorldTheme = {
  sky: readonly [string, string, string];
  skyInk: string; skyMuted: string;
  card: string; cardInk: string; cardMuted: string; cardShadow: string;
  paper: string; paperInk: string; paperLine: string;
  stampOrange: string; stampInk: string;
  tabBar: string; tabActive: string; tabInactive: string;
  radius: { card: number; chip: number; tabBar: number };
};

const radius = { card: 24, chip: 999, tabBar: 28 } as const;

export const lightWorld: WorldTheme = {
  sky: ['#BFE3FF', '#E4F3FF', '#F7FBFF'],
  skyInk: '#12294A', skyMuted: '#34506F',
  card: '#FFFFFF', cardInk: '#192331', cardMuted: '#55657B', cardShadow: '#1D4E89',
  paper: '#F7EFE0', paperInk: '#4A3317', paperLine: '#A77C46',
  stampOrange: '#CA6E29', stampInk: '#A3401F',
  tabBar: '#FFFFFF', tabActive: '#2456D6', tabInactive: '#55657B',
  radius,
};

export const darkWorld: WorldTheme = {
  sky: ['#1D3A63', '#1A2A45', '#182131'],
  skyInk: '#F3F5F9', skyMuted: '#C4D0E0',
  card: '#20252F', cardInk: '#F3F5F9', cardMuted: '#B3BCCB', cardShadow: '#000000',
  paper: '#2A2418', paperInk: '#F2E6CF', paperLine: '#8C6A3C',
  stampOrange: '#F0A057', stampInk: '#FFB09A',
  tabBar: '#20252F', tabActive: '#9BB8FF', tabInactive: '#B3BCCB',
  radius,
};

export function worldForScheme(scheme: 'light' | 'dark' | 'unspecified' | null | undefined): WorldTheme {
  return scheme === 'dark' ? darkWorld : lightWorld;
}
```

- [ ] **Step 4: 통과 확인.** 대비가 모자라면 해당 글자색만 어둡게(라이트)/밝게(다크) 조정하고 기준은 낮추지 않는다.

Run: `cd apps/mobile && npx tsx --test src/theme/world.test.ts` → PASS

- [ ] **Step 5: 기존 `src/screens/wallet-link/styles.test.ts`·`merchant-detail/styles.test.ts`의 지역 `contrast` 함수를 `../../theme/contrast`의 import로 바꾸고 `npm test` 전체 PASS 확인 후 커밋**

```bash
git add apps/mobile/src/theme apps/mobile/src/screens/wallet-link/styles.test.ts apps/mobile/src/screens/merchant-detail/styles.test.ts
git commit -m "하늘 동네 색·모양 토큰과 공통 대비 계산을 둔다" -m "Refs #224"
```

---

### Task 3: 연출 계산과 공통 스위치

**Files:**
- Create: `apps/mobile/src/motion/timing.ts`
- Create: `apps/mobile/src/motion/use-motion.ts`
- Test: `apps/mobile/src/motion/timing.test.ts`

**Interfaces:**
- Produces: `staggerDelay(index: number): number` (50ms 간격, 8번째부터 350ms 고정); `stampTilt(id: string): number` (−12~12도, 같은 id는 같은 값); `export const motion = { pressScale: 0.96, spring: { damping: 14, stiffness: 220 }, breatheMs: 3000, cloudMs: 40000, enterOffset: 12 }`; `useMotionEnabled(): boolean` (= `!useReducedMotion()`).

- [ ] **Step 1: 실패하는 시험 작성**

```ts
// apps/mobile/src/motion/timing.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { motion, stampTilt, staggerDelay } from './timing';

test('stagger delay grows by 50ms and stops growing after the eighth item', () => {
  assert.equal(staggerDelay(0), 0);
  assert.equal(staggerDelay(1), 50);
  assert.equal(staggerDelay(7), 350);
  assert.equal(staggerDelay(8), 350);
  assert.equal(staggerDelay(120), 350);
  assert.equal(staggerDelay(-3), 0);
});

test('stamp tilt is stable per merchant and stays within 12 degrees', () => {
  const ids = ['merchant-a', 'merchant-b', 'showcase-c', '', 'x'.repeat(200)];
  for (const id of ids) {
    const tilt = stampTilt(id);
    assert.equal(stampTilt(id), tilt, 'deterministic');
    assert.ok(tilt >= -12 && tilt <= 12, `${id} → ${tilt}`);
  }
  assert.notEqual(stampTilt('merchant-a'), stampTilt('merchant-b'));
});

test('press feedback is subtle and the motion switch honours reduced motion', () => {
  assert.ok(motion.pressScale >= 0.94 && motion.pressScale < 1);
  const hook = readFileSync(fileURLToPath(new URL('./use-motion.ts', import.meta.url)), 'utf8');
  assert.match(hook, /useReducedMotion/);
  assert.match(hook, /return !reduced/);
});
```

- [ ] **Step 2: 실패 확인** — Run: `cd apps/mobile && npx tsx --test src/motion/timing.test.ts` → FAIL

- [ ] **Step 3: 구현**

```ts
// apps/mobile/src/motion/timing.ts
export const motion = {
  pressScale: 0.96,
  spring: { damping: 14, stiffness: 220 },
  breatheMs: 3000,
  cloudMs: 40000,
  enterOffset: 12,
} as const;

const STEP_MS = 50;
const MAX_STEPS = 7;

/** Entry delay for the index-th list item; long lists never wait more than 350ms. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, Math.floor(index)), MAX_STEPS) * STEP_MS;
}

/** Deterministic ink-stamp rotation in degrees for a merchant, −12…12. */
export function stampTilt(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 25) - 12;
}
```

```ts
// apps/mobile/src/motion/use-motion.ts
import { useReducedMotion } from 'react-native-reanimated';

/** False when the person asked the OS to reduce motion; every effect then jumps to its end state. */
export function useMotionEnabled(): boolean {
  const reduced = useReducedMotion();
  return !reduced;
}
```

- [ ] **Step 4: 통과 확인 후 커밋** — Run 위 시험 → PASS

```bash
git add apps/mobile/src/motion
git commit -m "진입 지연·도장 기울기·동작 줄이기 스위치를 공통 연출로 둔다" -m "Refs #224"
```

---

### Task 4: 공통 화면 조각 (`src/ui/`)

**Files:**
- Create: `apps/mobile/src/ui/styles.ts` (조각 스타일 팩토리)
- Create: `apps/mobile/src/ui/sky-backdrop.tsx`, `floating-card.tsx`, `bounce-button.tsx`, `mascot.tsx`, `stagger.tsx`, `state-scene.tsx`, `app-header.tsx`, `use-ui-styles.ts`(`export function useUiStyles()`: 현재 색 체계의 `makeUiStyles` 결과를 memo)
- Test: `apps/mobile/src/ui/styles.test.ts`, `apps/mobile/src/ui/components.test.ts`

**Interfaces:**
- Consumes: `WorldTheme`, `worldForScheme` (Task 2); `motion`, `staggerDelay`, `useMotionEnabled` (Task 3); `mascotArt`, `skyTownHeader`, `MascotPose` (Task 1); `AppColors`, `colorsForScheme` (palette.ts); `lightHaptic` (gamification/native-effects).
- Produces:
  - `makeUiStyles(palette: AppColors, world: WorldTheme)` → StyleSheet with keys `card`, `cardTitle`, `cardBody`, `primaryButton`, `primaryButtonText`, `secondaryButton`, `secondaryButtonText`, `headerTitle`, `headerSubtitle`, `avatarButton`, `sceneTitle`, `sceneBody`.
  - `<SkyBackdrop scroll?: boolean>{children}</SkyBackdrop>` — 전체 화면 배경(그라데이션+헤더 그림+구름 2개). 자식은 그 위에 그린다.
  - `<FloatingCard onPress?: () => void accessibilityLabel?: string style?>{children}</FloatingCard>`
  - `<BounceButton label: string onPress variant?: 'primary' | 'secondary' disabled?: boolean />`
  - `<Mascot pose: MascotPose size: number breathe?: boolean accessibilityLabel?: string />` (라벨 없으면 장식으로 숨김)
  - `<Stagger index: number>{children}</Stagger>`
  - `<StateScene kind: 'empty' | 'error' | 'loading' title: string body?: string action?: { label: string; onPress: () => void } />` (empty→sleep, error→puzzled, loading→search)
  - `<AppHeader title: string subtitle?: string />` — 제목과 오른쪽 위 `logo-badge` 아바타(`Link href="/settings"`, 라벨 "내 정보").

- [ ] **Step 1: 스타일 시험 작성**

```ts
// apps/mobile/src/ui/styles.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contrast } from '../theme/contrast';
import { darkColors, lightColors } from '../theme/palette';
import { uiMetrics } from '../theme/ui-metrics';
import { darkWorld, lightWorld } from '../theme/world';
import { makeUiStyles } from './styles';

test('floating cards, buttons and headers stay readable and touchable', () => {
  for (const [palette, world] of [[lightColors, lightWorld], [darkColors, darkWorld]] as const) {
    const styles = makeUiStyles(palette, world);
    assert.equal(styles.card.backgroundColor, world.card);
    assert.equal(styles.card.borderRadius, world.radius.card);
    assert.ok(contrast(styles.cardTitle.color as string, world.card) >= 4.5);
    assert.ok(contrast(styles.cardBody.color as string, world.card) >= 4.5);
    assert.ok(contrast(styles.primaryButtonText.color as string, styles.primaryButton.backgroundColor as string) >= 4.5);
    assert.ok(contrast(styles.secondaryButtonText.color as string, styles.secondaryButton.backgroundColor as string) >= 4.5);
    for (const sky of world.sky) {
      assert.ok(contrast(styles.headerTitle.color as string, sky) >= 4.5);
      assert.ok(contrast(styles.headerSubtitle.color as string, sky) >= 4.5);
    }
    for (const key of ['primaryButton', 'secondaryButton', 'avatarButton'] as const) {
      assert.ok((styles[key].minHeight as number) >= uiMetrics.minTouch, key);
    }
    assert.ok((styles.avatarButton.minWidth as number) >= uiMetrics.minTouch);
  }
});
```

- [ ] **Step 2: 조각 소스 시험 작성**

```ts
// apps/mobile/src/ui/components.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

test('every animated piece respects reduced motion', () => {
  for (const file of ['sky-backdrop.tsx', 'floating-card.tsx', 'bounce-button.tsx', 'mascot.tsx', 'stagger.tsx']) {
    assert.match(read(file), /useMotionEnabled\(\)/, file);
  }
});

test('the header keeps account tools one tap away', () => {
  const header = read('app-header.tsx');
  assert.match(header, /href="\/settings"/);
  assert.match(header, /accessibilityLabel="내 정보"/);
});

test('state scenes map to the right mascot', () => {
  const scene = read('state-scene.tsx');
  assert.match(scene, /empty: 'sleep'/);
  assert.match(scene, /error: 'puzzled'/);
  assert.match(scene, /loading: 'search'/);
});

test('decorative mascots are hidden from screen readers unless labelled', () => {
  const mascot = read('mascot.tsx');
  assert.match(mascot, /importantForAccessibility=\{accessibilityLabel \? 'yes' : 'no-hide-descendants'\}/);
});
```

- [ ] **Step 3: 실패 확인** — Run: `cd apps/mobile && npx tsx --test src/ui/styles.test.ts src/ui/components.test.ts` → FAIL

- [ ] **Step 4: 스타일 팩토리 구현**

```ts
// apps/mobile/src/ui/styles.ts
import { StyleSheet } from 'react-native';

import type { AppColors } from '../theme/palette';
import { uiMetrics } from '../theme/ui-metrics';
import type { WorldTheme } from '../theme/world';

export function makeUiStyles(palette: AppColors, world: WorldTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: world.card, borderRadius: world.radius.card, padding: 18,
      shadowColor: world.cardShadow, shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3,
    },
    cardTitle: { color: world.cardInk, fontSize: 17, fontWeight: '800', lineHeight: 24 },
    cardBody: { color: world.cardMuted, fontSize: 15, lineHeight: 22 },
    primaryButton: {
      backgroundColor: palette.primary, borderRadius: 16, minHeight: uiMetrics.minTouch,
      paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
    },
    primaryButtonText: { color: palette.onPrimary, fontSize: 16, fontWeight: '800' },
    secondaryButton: {
      backgroundColor: palette.primaryContainer, borderRadius: 16, minHeight: uiMetrics.minTouch,
      paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
    },
    secondaryButtonText: { color: palette.onPrimaryContainer, fontSize: 16, fontWeight: '800' },
    headerTitle: { color: world.skyInk, fontSize: 28, fontWeight: '800', lineHeight: 36 },
    headerSubtitle: { color: world.skyMuted, fontSize: 15, lineHeight: 22 },
    avatarButton: {
      minWidth: uiMetrics.minTouch, minHeight: uiMetrics.minTouch, borderRadius: 999,
      alignItems: 'center', justifyContent: 'center',
    },
    sceneTitle: { color: world.cardInk, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    sceneBody: { color: world.cardMuted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  });
}
```

- [ ] **Step 5: 조각 구현.** 공통 훅: `const palette = colorsForScheme(useColorScheme()); const world = worldForScheme(useColorScheme()); const styles = useMemo(() => makeUiStyles(palette, world), [palette, world]);`

`mascot.tsx`:
```tsx
import { useEffect } from 'react';
import { Pressable, useColorScheme } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { useMotionEnabled } from '../motion/use-motion';
import { motion } from '../motion/timing';
import { mascotArt, type MascotPose } from './mascot-art';

type Props = { pose: MascotPose; size: number; breathe?: boolean; accessibilityLabel?: string };

export function Mascot({ pose, size, breathe = true, accessibilityLabel }: Props) {
  useColorScheme();
  const enabled = useMotionEnabled();
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  useEffect(() => {
    if (!enabled || !breathe) { scale.value = 1; return; }
    scale.value = withRepeat(withTiming(1.03, { duration: motion.breatheMs / 2, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [enabled, breathe, scale]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }] }));
  const wiggle = () => {
    if (!enabled) return;
    rotate.value = withSequence(withTiming(-6, { duration: 90 }), withTiming(6, { duration: 120 }), withTiming(0, { duration: 90 }));
  };
  return (
    <Pressable
      onPress={wiggle}
      accessible={Boolean(accessibilityLabel)}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      <Animated.Image source={mascotArt[pose]} style={[{ width: size, height: size }, animated]} resizeMode="contain" />
    </Pressable>
  );
}
```

`stagger.tsx`:
```tsx
import type { ReactNode } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { staggerDelay, motion } from '../motion/timing';
import { useMotionEnabled } from '../motion/use-motion';

export function Stagger({ index, children }: { index: number; children: ReactNode }) {
  const enabled = useMotionEnabled();
  const entering = enabled
    ? FadeInDown.delay(staggerDelay(index)).springify().damping(motion.spring.damping).withInitialValues({ transform: [{ translateY: motion.enterOffset }] })
    : undefined;
  return <Animated.View entering={entering}>{children}</Animated.View>;
}
```

`floating-card.tsx`: `Pressable`(onPress가 있을 때만)로 감싼 `Animated.View`. `onPressIn`에서 `scale = withSpring(motion.pressScale, motion.spring)`, `onPressOut`에서 `withSpring(1, motion.spring)`, `onPress`에서 `void lightHaptic()`. `useMotionEnabled()`가 false면 scale을 바꾸지 않는다. 스타일은 `styles.card`와 props `style`을 `StyleSheet.flatten`으로 합친다(expo-router Slot 자식 배열 스타일 회피, #216 교훈).

`bounce-button.tsx`: `FloatingCard`와 같은 눌림 연출, `accessibilityRole="button"`, `accessibilityState={{ disabled }}`, variant에 따라 `primaryButton`/`secondaryButton` 스타일과 글자 스타일, `maxFontSizeMultiplier={1.6}`.

`sky-backdrop.tsx`: 루트 `View flex:1` 배경 `world.sky[2]`. 절대 위치 `react-native-svg` `<Svg><Defs><LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={world.sky[0]} /><Stop offset="0.55" stopColor={world.sky[1]} /><Stop offset="1" stopColor={world.sky[2]} /></LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#sky)" /></Svg>`, 그 위 상단에 `Image source={skyTownHeader}` 폭 100%·높이 `width * 0.42`, 다크 모드면 그 위에 `world.sky[0]` 색 55% 불투명 덮개(그림만 어둡게, 글자에는 투명도 쓰지 않음). 구름 2개는 흰 타원 `Svg`(다크는 `#FFFFFF` 12%)를 `withRepeat(withTiming(translateX, { duration: motion.cloudMs, easing: Easing.linear }), -1, false)`로 흘린다. `useMotionEnabled()`가 false면 구름은 제자리. 자식은 절대 배경 위에 그린다.

`state-scene.tsx`:
```tsx
import { Text, View } from 'react-native';

import type { MascotPose } from './mascot-art';
import { Mascot } from './mascot';
import { BounceButton } from './bounce-button';
import { useUiStyles } from './use-ui-styles';

const poseByKind: Record<'empty' | 'error' | 'loading', MascotPose> = { empty: 'sleep', error: 'puzzled', loading: 'search' };

type Props = { kind: 'empty' | 'error' | 'loading'; title: string; body?: string; action?: { label: string; onPress: () => void } };

export function StateScene({ kind, title, body, action }: Props) {
  const styles = useUiStyles();
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 24 }} accessibilityLiveRegion={kind === 'loading' ? 'polite' : 'none'}>
      <Mascot pose={poseByKind[kind]} size={132} />
      <Text style={styles.sceneTitle}>{title}</Text>
      {body ? <Text style={styles.sceneBody}>{body}</Text> : null}
      {action ? <BounceButton label={action.label} onPress={action.onPress} variant="secondary" /> : null}
    </View>
  );
}
```
(`use-ui-styles.ts`는 위 공통 훅을 `export function useUiStyles()`로 뽑은 것.) 시험의 정규식 `empty: 'sleep'`가 맞도록 객체 리터럴 형태를 유지한다.

`app-header.tsx`: 왼쪽 `headerTitle`/`headerSubtitle`, 오른쪽 `<Link href="/settings" asChild><Pressable accessibilityRole="button" accessibilityLabel="내 정보" style={styles.avatarButton}><Image source={mascotArt['logo-badge']} style={{ width: 44, height: 44 }} /></Pressable></Link>`.

- [ ] **Step 6: 통과 확인** — Run: `cd apps/mobile && npx tsx --test src/ui/*.test.ts && npm run typecheck` → PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/mobile/src/ui
git commit -m "하늘 배경·떠 있는 카드·마스코트 연출을 공통 화면 조각으로 만든다" -m "Refs #224"
```

---

### Task 5: 떠 있는 세 칸 탭 바와 머리글 아바타

**Files:**
- Create: `apps/mobile/src/navigation/floating-tab-bar.tsx`
- Modify: `apps/mobile/src/app/(tabs)/_layout.tsx`
- Modify: `apps/mobile/src/navigation/primary-tabs.test.ts`

**Interfaces:**
- Consumes: `worldForScheme`, `useMotionEnabled`, `motion`, `TabGlyph`, `lightHaptic`.
- Produces: `FloatingTabBar(props: BottomTabBarProps)`; 탭 라우트 순서 `index`, `claim`, `collection`; `settings`는 `href: null`로 숨김(경로 유지).

- [ ] **Step 1: 시험 갱신(요구 변경: `내 정보`는 탭에서 머리글 아바타로 이동, 스펙 5절)**

`tab labels describe the four primary user jobs` 시험을 다음으로 바꾼다.

```ts
test('floating tab bar shows explore, a raised claim stamp and collection; account moves to the header', () => {
  const layout = readFileSync(join(app, '(tabs)', '_layout.tsx'), 'utf8');
  for (const title of ['탐색', '방문 인증', '도감']) assert.ok(layout.includes(title), title);
  assert.match(layout, /name="settings"[\s\S]*?href: null/);
  assert.match(layout, /tabBar=\{\(props\) => <FloatingTabBar \{\.\.\.props\} \/>\}/);
  const bar = readFileSync(fileURLToPath(new URL('./floating-tab-bar.tsx', import.meta.url)), 'utf8');
  assert.match(bar, /useMotionEnabled\(\)/);
  assert.match(bar, /fontScale >= 1\.5/);
  assert.match(bar, /maxFontSizeMultiplier=\{1\.25\}/);
  assert.match(bar, /accessibilityRole="tab"/);
});

test('every primary screen offers the account avatar', () => {
  for (const screen of ['merchant-list', 'collection']) {
    const source = readFileSync(fileURLToPath(new URL(`../screens/${screen}/index.tsx`, import.meta.url)), 'utf8');
    assert.match(source, /<AppHeader/, screen);
  }
  const claim = readFileSync(join(app, '(tabs)', 'claim.tsx'), 'utf8');
  assert.match(claim, /<AppHeader/);
});
```
첫 시험 `four primary routes keep the production root...`는 그대로 둔다(`settings.tsx` 파일은 남는다).

- [ ] **Step 2: 실패 확인** — Run: `cd apps/mobile && npx tsx --test src/navigation/primary-tabs.test.ts` → FAIL

- [ ] **Step 3: 탭 바 구현.** 화면 아래 16dp 띄운 둥근 바(`world.tabBar`, 반경 `world.radius.tabBar`, 그림자). `state.routes`를 돌며 `options.href === null`인 라우트는 건너뛴다. 가운데 `claim`은 지름 64 원형 버튼(`palette.primary`, 흰 `TabGlyph name="claim"`)을 바 위로 18dp 올리고, 누르면 0.9배로 눌렸다 튕기며 `lightHaptic()`. 나머지는 아이콘+라벨(`maxFontSizeMultiplier={1.25}`, 선택 `world.tabActive`, 비선택 `world.tabInactive`), 선택이 바뀌면 아이콘 translateY −4→0 스프링. 각 항목 `accessibilityRole="tab"`, `accessibilityState={{ selected }}`, `accessibilityLabel={options.tabBarAccessibilityLabel}`, 최소 48dp. `useWindowDimensions().fontScale >= 1.5`이면 바 높이 76+inset, 아니면 64+inset. `useMotionEnabled()`가 false면 튕김 없음. 탭 누름은 `navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })` 후 기본 동작이면 `navigation.navigate(route.name)`.

- [ ] **Step 4: 레이아웃 교체**

```tsx
// apps/mobile/src/app/(tabs)/_layout.tsx 의 <Tabs> 부분
<Tabs
  tabBar={(props) => <FloatingTabBar {...props} />}
  screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: world.sky[2] } }}
>
  <Tabs.Screen name="index" options={{ title: '탐색', tabBarAccessibilityLabel: '탐색' }} />
  <Tabs.Screen name="claim" options={{ title: '방문 인증', tabBarAccessibilityLabel: '방문 인증' }} />
  <Tabs.Screen name="collection" options={{ title: '도감', tabBarAccessibilityLabel: '도감' }} />
  <Tabs.Screen name="settings" options={{ title: '내 정보', href: null }} />
</Tabs>
```
각 화면은 이제 자체 `AppHeader`를 그린다(Task 6~9). `settings` 화면은 스택처럼 보이도록 `AppHeader` 대신 뒤로 가기 버튼이 있는 머리글을 쓴다(Task 9).

- [ ] **Step 5: 통과 확인** — Run: `cd apps/mobile && npx tsx --test src/navigation/*.test.ts && npm run typecheck` (다른 화면의 `AppHeader` 시험은 Task 6~8에서 통과)

- [ ] **Step 6: 커밋**

```bash
git add apps/mobile/src/navigation apps/mobile/src/app/'(tabs)'/_layout.tsx
git commit -m "하단 탭을 떠 있는 세 칸 바로 바꾸고 내 정보를 머리글로 옮긴다" -m "Refs #224"
```

---

### Task 6: 탐색 화면

**Files:**
- Modify: `apps/mobile/src/screens/merchant-list/index.tsx`, `styles.ts`, `styles.test.ts`

**Interfaces:**
- Consumes: `SkyBackdrop`, `AppHeader`, `Mascot`, `Stagger`, `FloatingCard`, `StateScene`, `useUiStyles`, 기존 점포 목록 데이터 훅(파일 안 기존 로직 유지).

- [ ] **Step 1: 스타일 시험 갱신** — `styles.test.ts`에 카드 배경이 `world.card`, 점포 이름 대비 4.5:1, 여권 진행 칩 대비 4.5:1(라이트·다크) 단언을 추가하고 FAIL 확인.

- [ ] **Step 2: 구현.** 화면 구성:
```tsx
<SkyBackdrop>
  <ScrollView contentContainerStyle={{ paddingBottom: 120 }} refreshControl={...기존 새로고침...}>
    <AppHeader title="오늘은 어디를 탐험할까요?" subtitle="가본 적 없는 가게에 도장을 찍어 보세요" />
    <View style={styles.heroRow}><Mascot pose="explore-map" size={120} accessibilityLabel="지도를 든 마스코트" /></View>
    {/* 여권 진행 칩: 기존 useBadgeBook 결과가 있으면 '탐험 여권 · {등급}  배지 {n}/9', 로그아웃이면 '로그인하면 여권이 열려요' */}
    {merchants.map((merchant, index) => (
      <Stagger key={merchant.id} index={index}>
        <FloatingCard onPress={() => router.push(기존 상세 경로)} accessibilityLabel={`${merchant.name} 자세히 보기`}>
          {/* 왼쪽 64dp 둥근 그림: 시연 점포 그림이 있으면 그 그림, 없으면 이름 첫 글자 원형 도장(world.stampOrange 테두리) */}
          {/* 제목, 도로명 주소, '도장 {n}개 남음' 등 기존 정보 */}
        </FloatingCard>
      </Stagger>
    ))}
    {/* 빈 목록 → <StateScene kind="empty" title="아직 둘러볼 가게가 없어요" />, 오류 → kind="error" + 다시 시도, 첫 로딩 → kind="loading" */}
  </ScrollView>
</SkyBackdrop>
```
기존 `explore-banner.jpg` 배너는 제거한다. 가상 점포 안내("체험용 가상 데이터…") 같은 정직성 문구는 목록 위에 한 번만 둔다.

- [ ] **Step 3: 확인** — Run: `cd apps/mobile && npx tsx --test src/screens/merchant-list/*.test.ts src/navigation/*.test.ts && npm run typecheck && npm run lint` → PASS

- [ ] **Step 4: 커밋** — `git commit -m "탐색 화면을 하늘 동네와 떠 있는 점포 카드로 바꾼다" -m "Refs #224"`

---

### Task 7: 방문 인증 화면

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/claim.tsx`, `apps/mobile/src/screens/claim-redeem/index.tsx`(표현만), 관련 `styles.ts`/시험

- [ ] **Step 1: 시험** — claim-redeem 스타일 시험에 QR 패널 카드 배경 `world.card`, 안내 글자 대비 단언 추가, FAIL 확인.
- [ ] **Step 2: 구현.** `claim.tsx`는 `<SkyBackdrop><AppHeader title="방문 인증" subtitle="가게에서 도장을 받아요" /> ...기존 내용... </SkyBackdrop>`. 상단에 `<Mascot pose="stamp" size={112} accessibilityLabel="도장을 든 마스코트" />`. 2분 QR·확인 코드·남은 시간·코드 입력 흐름과 문구·시간 로직은 바꾸지 않고, 감싸는 컨테이너만 `FloatingCard`(가장자리 점선 `world.paperLine` 2dp, 도장 카드 느낌)로 바꾼다.
- [ ] **Step 3: 확인** — `npx tsx --test src/screens/claim-redeem/*.test.ts src/navigation/*.test.ts && npm run typecheck` → PASS
- [ ] **Step 4: 커밋** — `"방문 인증을 도장 카드와 마스코트로 꾸민다"`

---

### Task 8: 도감 — 여권 도장 페이지

**Files:**
- Create: `apps/mobile/src/ui/passport-stamp-page.tsx`
- Modify: `apps/mobile/src/screens/collection/index.tsx`, `styles.ts`, `styles.test.ts`
- Test: `apps/mobile/src/ui/components.test.ts`(추가 단언)

**Interfaces:**
- Consumes: `stampTilt`, `WorldTheme.paper*`, `stampInk`, 기존 `collection-stamps.ts`의 점포별 스탬프 모델.
- Produces: `<PassportStampPage stamps: ReadonlyArray<{ merchantId: string; name: string; visited: boolean; goalText: string }> />`

- [ ] **Step 1: 시험 추가**
```ts
test('passport stamp page tilts each visited stamp by merchant and labels every slot', () => {
  const page = read('passport-stamp-page.tsx');
  assert.match(page, /stampTilt\(stamp\.merchantId\)/);
  assert.match(page, /accessibilityLabel=\{stamp\.visited \? `\$\{stamp\.name\} 도장 받음` : `\$\{stamp\.name\} 도장 아직 없음`\}/);
  assert.match(page, /world\.paper/);
});
```
`collection/styles.test.ts`에 여권 페이지 글자(`paperInk`)·도장 잉크 대비 4.5:1 단언 추가. FAIL 확인.
- [ ] **Step 2: 구현.** 크림 종이 카드(`world.paper`, 반경 20, 점선 테두리 `world.paperLine`), 3열 격자. 방문한 칸: 지름 72 원형 이중 테두리 도장(`world.stampInk`, 두께 3/1), 안에 점포 이름 앞 두 글자, `transform: [{ rotate: `${stampTilt(stamp.merchantId)}deg` }]`, 새로 찍힌 도장은 `useMotionEnabled()`일 때 1.4배→1배 스프링으로 "쾅". 안 간 칸: 점선 원과 `goalText`. 도감 화면 순서: `AppHeader`("나의 탐험 여권") → 기존 passport-hero(하늘 배경 위) → 메달 선반 → 보상 상자 → 쿠폰 → `PassportStampPage` → 수집품·방문 기록. 기존 스탬프 판 UI는 이 컴포넌트로 교체한다.
- [ ] **Step 3: 확인** — `npx tsx --test src/ui/*.test.ts src/screens/collection/*.test.ts src/gamification/*.test.ts && npm run typecheck` → PASS
- [ ] **Step 4: 커밋** — `"도감 스탬프 판을 도장이 찍히는 여권 페이지로 바꾼다"`

---

### Task 9: 첫 화면·내 정보·점포 상세·축하

**Files:**
- Modify: `apps/mobile/src/screens/foundation/index.tsx`, `apps/mobile/src/theme/foundation.ts`
- Modify: `apps/mobile/src/screens/account-settings/index.tsx`
- Modify: `apps/mobile/src/screens/merchant-detail/index.tsx`, `styles.ts`, `styles.test.ts`
- Modify: `apps/mobile/src/gamification/celebration.tsx`

- [ ] **Step 1: 시험** — `merchant-detail/styles.test.ts`에 상단 그림 위 제목 대비(라이트·다크), foundation 소스에 `<Mascot pose="wave"`와 `logo-badge` 사용, celebration 소스에 `pose="cheer"` 단언 추가. FAIL 확인.
- [ ] **Step 2: 첫 화면.** 역할 선택 단계만 바꾼다: `SkyBackdrop`, 상단 `logo-badge` 36dp + "월계 마스코트", `<Mascot pose="wave" size={160} accessibilityLabel="손을 흔드는 마스코트" />`, 제목 "반가워요! 동네 탐험을 시작해요", 사용자·점주 카드는 `FloatingCard`(아이콘 칸에 각각 `explore-map`·`stamp` 56dp). 뒤로 가기·페이지 넘김 로직과 `onChooseRole` 호출은 유지한다. 파란 네모 "masscom" 표식은 제거한다.
- [ ] **Step 3: 내 정보.** `SkyBackdrop` + 왼쪽 위 뒤로 가기(`router.back()`, 이전 화면이 없으면 `router.replace('/')`, 48dp, 라벨 "뒤로") + 프로필 `FloatingCard`(`logo-badge` 64dp, 로그인 상태 문구) + 기존 설정 항목을 묶음 카드로. 계정 삭제·로그아웃·개발용 미리보기 진입 규칙은 그대로.
- [ ] **Step 4: 점포 상세.** 상단 240dp: 시연 점포 그림이 있으면 그 그림, 없으면 `SkyBackdrop` 헤더 그림. 그 아래 `FloatingCard`로 이름·주소·도장 진행. 기존 버튼·문구 유지.
- [ ] **Step 5: 축하.** 기존 도장 낙하·색종이 모달에 `<Mascot pose="cheer" size={140} />`를 도장 아래에 추가(메달 등급이 오를 때), 상자 공개에는 `gift`.
- [ ] **Step 6: 확인** — `cd apps/mobile && npm test && npm run typecheck && npm run lint` → 전체 PASS
- [ ] **Step 7: 커밋** — `"첫 화면·내 정보·점포 상세·축하에 하늘 동네와 마스코트를 입힌다"`

---

### Task 10: 디자인 기준 문서와 결정 기록

**Files:**
- Modify: `DESIGN.md`(Visual language·Components·Implementation constraints·Open questions), `docs/DECISIONS.md`(D-045~D-048), `README.md`, `docs/TEST_STATUS.md`, `docs/PROJECT_STATE.md`, `docs/HANDOFF.md`(14절 형식·기준 커밋), `docs/AI_USAGE.md`

- [ ] **Step 1:** DESIGN.md 3절 "시각 언어"를 스펙 3절 값으로 교체하고, "새 의존성 금지"를 "새 npm 의존성은 PR에 이유와 대안을 적고 소유자 승인 시에만"으로, "그 밖의 그림 금지"를 "D-045 마스코트 화풍 그림은 사용, 실제 점포 사진·보유하지 않은 수집품 그림은 계속 금지"로 바꾼다. 연출 원칙(스펙 4절)을 새 절로 추가.
- [ ] **Step 2:** DECISIONS 표에 D-045(디자인 A+B·Codex 마스코트 세트, `USER_CONFIRMED` 2026-09-29), D-046(지도 방식), D-047(친구 공개 범위), D-048(사장님 AI 시안·OpenAI) 추가.
- [ ] **Step 3:** README 첫 화면 소개·화면 설명을 새 디자인으로, TEST_STATUS에 날짜 문단(필수 36개 상태 불변), PROJECT_STATE·HANDOFF·AI_USAGE(Codex 그림, Claude 구현·리뷰) 갱신.
- [ ] **Step 4:** Run: `bash tests/site/verify_evidence_consistency_test.sh && bash tests/bootstrap/verify_bootstrap_test.sh` → PASS
- [ ] **Step 5: 커밋** — `"디자인 기준을 하늘 동네 체계로 개정하고 후속 결정을 기록한다"`

---

### Task 11: 전체 검증과 화면 증거

- [ ] **Step 1:** Run: `cd apps/mobile && npm test && npm run typecheck && npm run lint` → PASS
- [ ] **Step 2:** Run: `cd apps/mobile && EXPO_NO_DOTENV=1 npm run export:android` 운영·시연 두 variant(기존 CI와 같은 환경 변수), 이어서 `node ../../scripts/verify-mobile-variant-assets.mjs` → PASS(시연 점포 그림은 운영 번들에 없음)
- [ ] **Step 3:** 에뮬레이터 `MassCOM_Design_QA`(360dp)에서 개발 앱을 다시 빌드해 첫 화면·탐색·방문 인증·도감(여권 페이지)·내 정보·점포 상세를 라이트·다크·글자 200%로 촬영. `.env.local`은 운영 API를 가리키므로 백업→로컬 값→byte 단위 복원 절차(메모리 `masscom-emulator-qa`)를 지킨다.
- [ ] **Step 4:** 실폰(SM-S928N)에 같은 개발 APK를 설치해 첫 화면·탐색·도감 촬영(상태 표시줄 잘라냄, 개인 알림·QR 토큰 화면 저장 금지).
- [ ] **Step 5:** `docs/evidence/sky-town-redesign-2026-09-29/`에 전후 비교 이미지와 README(PASS/NOT_RUN 분리) 저장, 커밋.
- [ ] **Step 6:** 독립 리뷰 2회(sonnet 코드 리뷰, opus 디자인·접근성 리뷰) → 🔴 0 확인 후 PR.
