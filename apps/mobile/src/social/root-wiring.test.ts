import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const layoutSource = readFileSync(fileURLToPath(new URL('../app/_layout.tsx', import.meta.url)), 'utf8');
const authProviderSource = readFileSync(fileURLToPath(new URL('../auth/auth-provider.tsx', import.meta.url)), 'utf8');

test('root mounts the social push provider once around the root stack', () => {
  assert.match(layoutSource, /import \{ SocialPushProvider \} from '@\/social\/push-runtime';/);
  assert.equal((layoutSource.match(/<SocialPushProvider\b/g) ?? []).length, 1);
  assert.match(layoutSource, /apiUrl=\{publicApiConfig\.available \? publicApiConfig\.apiUrl : undefined\}/);
  assert.match(layoutSource, /accountId=\{auth\.accountId\}/);
  assert.match(layoutSource, /credential=\{auth\.credential\}/);
  assert.match(layoutSource, /onSessionInvalid=\{auth\.invalidateSession\}/);
});

test('root derives the Expo push project id from expo/eas constants', () => {
  assert.match(layoutSource, /import Constants from 'expo-constants';/);
  assert.match(layoutSource, /Constants\.expoConfig\?\.extra/);
  assert.match(layoutSource, /Constants\.easConfig\?\.projectId/);
  assert.match(layoutSource, /projectId=\{projectId\}/);
});

test('root routes notification-opened mail only after auth state is ready', () => {
  assert.match(layoutSource, /router\.push\(\{ pathname: '\/mail\/\[mailId\]', params: \{ mailId \} \}\);/);
  assert.match(layoutSource, /if \(!auth\.accountId \|\| !auth\.credential\) return;/);
});

test('root stack registers the social route screens', () => {
  for (const route of [
    'friends/[friendshipId]/message',
    'friends/[friendshipId]/meal-invite',
    'mail/index',
    'mail/[mailId]',
    'meal-merchant',
    'home/missions',
  ]) {
    assert.ok(layoutSource.includes(`Stack.Screen name="${route}"`));
  }
});

test('auth provider revokes the original social push binding before auth session changes', () => {
  assert.match(authProviderSource, /import \{ appVariantForPackage, beginSocialPushBindingRevocation, revokeSocialPushBindings \} from '@\/social\/push-runtime';/);
  assert.match(authProviderSource, /apiUrl: publicApiConfiguration\.available \? publicApiConfiguration\.apiUrl : undefined/);
  assert.match(authProviderSource, /appVariant: appVariantForPackage\(getAppPackageId\(\)\)/);
  assert.match(authProviderSource, /beginSocialPushBindingRevocation\(\);/);
  assert.equal((authProviderSource.match(/const previousCredential = credential;/g) ?? []).length, 3);
  assert.equal((authProviderSource.match(/await revokeSocialPushBindingForAuthSession\(previousAccountId, previousCredential\);/g) ?? []).length, 3);
});