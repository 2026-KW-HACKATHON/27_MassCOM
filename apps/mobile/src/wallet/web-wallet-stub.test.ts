import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sdkPattern = /reown|walletconnect|ethers/i;

test('웹 지갑 자리 채움 파일은 지갑 SDK를 가져오지 않는다', () => {
  for (const path of ['./appkit.web.ts', './appkit-ui.web.tsx', '../screens/wallet-link/index.web.tsx']) {
    const imports = source(path).split('\n').filter((line) => /^\s*(import|export)\b.*\bfrom\b|require\(/.test(line));
    assert.equal(imports.some((line) => sdkPattern.test(line)), false, path);
  }
});

test('웹 appkit은 늘 지갑 미설정이고 계정별 AppKit을 만들지 않는다', async () => {
  const web = await import('./appkit.web');
  assert.equal(web.walletRuntimeConfig.available, false);
  assert.ok(!web.walletRuntimeConfig.available && web.walletRuntimeConfig.missing.includes('EXPO_PUBLIC_REOWN_PROJECT_ID'));
  assert.equal(web.createAccountScopedAppKit(), null);
});

test('웹 자리 채움은 네이티브 모듈이 내보내는 이름을 모두 내보낸다', () => {
  assert.match(source('./appkit.ts'), /export const walletRuntimeConfig\b/);
  assert.match(source('./appkit.ts'), /export function createAccountScopedAppKit\b/);
  assert.match(source('./appkit.web.ts'), /export const walletRuntimeConfig\b/);
  assert.match(source('./appkit.web.ts'), /export function createAccountScopedAppKit\b/);
  assert.match(source('../screens/wallet-link/index.tsx'), /export function WalletLinkScreen\b/);
  assert.match(source('../screens/wallet-link/index.web.tsx'), /export function WalletLinkScreen\b/);
  // 루트 레이아웃이 지갑 패키지에서 가져오는 세 이름.
  const layout = source('../app/_layout.tsx');
  assert.match(layout, /import \{ AppKit, AppKitProvider, useAppKitTheme \} from '@reown\/appkit-react-native';/);
  for (const name of ['AppKit', 'AppKitProvider', 'useAppKitTheme']) {
    assert.match(source('./appkit-ui.web.tsx'), new RegExp(`export function ${name}\\b`));
  }
});

test('Metro는 웹에서만 지갑 패키지를 자리 채움으로 바꾸고 네이티브는 그대로 둔다', () => {
  const config = createRequire(import.meta.url)(resolve(mobileRoot, 'metro.config.js')) as {
    resolver: { resolveRequest: (context: unknown, name: string, platform: string | null) => unknown };
  };
  const fallthrough = { fallthrough: true };
  const context = { originModulePath: resolve(mobileRoot, 'src/app/_layout.tsx'), resolveRequest: () => fallthrough };
  assert.deepEqual(config.resolver.resolveRequest(context, '@reown/appkit-react-native', 'web'), {
    filePath: resolve(mobileRoot, 'src/wallet/appkit-ui.web.tsx'),
    type: 'sourceFile',
  });
  for (const platform of ['android', 'ios']) {
    assert.equal(config.resolver.resolveRequest(context, '@reown/appkit-react-native', platform), fallthrough, platform);
  }
  assert.equal(config.resolver.resolveRequest(context, 'react-native', 'web'), fallthrough);
  // 플랫폼을 모를 때(null·undefined)도 네이티브 쪽이다.
  for (const platform of [null, undefined]) {
    assert.equal(config.resolver.resolveRequest(context, '@reown/appkit-react-native', platform as never), fallthrough, String(platform));
  }
});

test('metro.config.js의 지갑 SDK 리다이렉트는 platform === "web" 조건 안에만 있다', () => {
  const metro = readFileSync(resolve(mobileRoot, 'metro.config.js'), 'utf8');
  // 지갑 패키지 이름은 한 번만 나오고, 바로 그 if 조건이 웹 검사와 함께 있다. 이 줄이 바뀌면 안드로이드가 자리 채움을 받는다.
  assert.equal(metro.match(/@reown\/appkit-react-native/g)?.length, 1);
  assert.match(metro, /if \(platform === 'web' && moduleName === '@reown\/appkit-react-native'\) \{\s*return \{ filePath: resolve\(__dirname, 'src\/wallet\/appkit-ui\.web\.tsx'\)/);
});
