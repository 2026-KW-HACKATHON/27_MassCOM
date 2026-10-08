#!/usr/bin/env node
// Check the staged APK/AAB, where Expo embeds public map IDs in both config and Hermes bytecode.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const [artifact, ...extra] = process.argv.slice(2);
if (!artifact || extra.length || !/\.(apk|aab)$/.test(artifact)) {
  console.error('usage: check-embedded-maps.mjs <file.apk|file.aab>');
  process.exit(2);
}

const secrets = ['NAVER_MAP_CLIENT_SECRET', 'NAVER_SEARCH_CLIENT_SECRET']
  .map(name => ({ name, value: process.env[name] })).filter(item => item.value);

const expected = [
  ['TMAP', 'EXPO_PUBLIC_TMAP_MAP_APP_KEY', 'sdkAppKey'],
  ['NAVER', 'EXPO_PUBLIC_NAVER_MAP_CLIENT_ID', 'naverClientId'],
].map(([provider, environment, configField]) => ({
  provider, configField, value: process.env[environment]?.trim(),
})).filter(item => item.value);
if (!expected.length) {
  console.error('embedded maps check FAILED: no public map ID configured');
  process.exit(1);
}

const prefix = artifact.endsWith('.aab') ? 'base/assets/' : 'assets/';
const configEntry = `${prefix}app.config`;
const bundleEntry = `${prefix}index.android.bundle`;
class MapCheckError extends Error {}
try {
  const entries = new Set(execFileSync('unzip', ['-Z1', artifact], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n'));
  if (!entries.has(configEntry) || !entries.has(bundleEntry)) throw new MapCheckError('app config or JS bundle is missing');
  const configText = execFileSync('unzip', ['-p', artifact, configEntry], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const config = JSON.parse(configText);
  const bundle = execFileSync('unzip', ['-p', artifact, bundleEntry], { maxBuffer: 100_000_000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (!bundle.length) throw new MapCheckError('JS bundle is empty');
  for (const { name, value } of secrets) {
    if (configText.includes(value) || bundle.includes(Buffer.from(value))) {
      throw new MapCheckError(`${name} is embedded`);
    }
  }
  for (const { provider, configField, value } of expected) {
    if (config.extra?.masscomMaps?.[configField] !== value || !bundle.includes(Buffer.from(value))) {
      throw new MapCheckError(`${provider} public ID is missing or mismatched`);
    }
  }
  console.log(`embedded maps verified: ${basename(artifact)} (${expected.map(item => item.provider).join(', ')})`);
} catch (error) {
  console.error(`embedded maps check FAILED: ${error instanceof MapCheckError ? error.message : 'artifact cannot be read'}`);
  process.exit(1);
}
