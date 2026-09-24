#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const clientId = '172380658768-n5r2vad5f2g6ndb9kh2cbcig1j9i792g.apps.googleusercontent.com';
const redirectUri = 'https://masscom.kr/api/web/auth/callback';
const envPath = process.argv[2] && resolve(process.argv[2]);

if (process.argv.length !== 3 || !envPath) {
  console.error('usage: pbpaste | node scripts/install-web-oauth-runtime.mjs <private-runtime-env>');
  process.exit(2);
}

let temporaryPath;
try {
  const details = lstatSync(envPath);
  if (!details.isFile() || (details.mode & 0o777) !== 0o600) {
    throw new Error('runtime env must be a regular mode 600 file');
  }
  const input = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (!/^[A-Za-z0-9._~-]{16,512}$/.test(input)) {
    throw new Error('clipboard does not contain one valid OAuth secret');
  }

  const current = readFileSync(envPath, 'utf8');
  const desired = {
    GOOGLE_WEB_CLIENT_ID: clientId,
    GOOGLE_WEB_CLIENT_SECRET: input,
    GOOGLE_WEB_REDIRECT_URI: redirectUri,
  };
  const existing = new Map();
  for (const line of current.split('\n')) {
    const possibleKey = /^\s*(?:export\s+)?(GOOGLE_WEB_CLIENT_ID|GOOGLE_WEB_CLIENT_SECRET|GOOGLE_WEB_REDIRECT_URI)\s*=/.exec(line)?.[1];
    const match = /^(GOOGLE_WEB_CLIENT_ID|GOOGLE_WEB_CLIENT_SECRET|GOOGLE_WEB_REDIRECT_URI)=(.*)$/.exec(line);
    if (possibleKey && !match) throw new Error(`unsupported ${possibleKey} formatting in runtime env`);
    if (!match) continue;
    if (existing.has(match[1])) throw new Error(`duplicate ${match[1]} in runtime env`);
    existing.set(match[1], match[2]);
  }
  for (const name of ['GOOGLE_WEB_CLIENT_ID', 'GOOGLE_WEB_REDIRECT_URI']) {
    if (existing.get(name) && existing.get(name) !== desired[name]) {
      throw new Error(`${name} is already set to another value`);
    }
  }
  if (existing.get('GOOGLE_WEB_CLIENT_SECRET')) {
    throw new Error('runtime env already contains an OAuth secret; refusing to overwrite it');
  }

  let updated = current.trimEnd();
  for (const [name, value] of Object.entries(desired)) {
    const line = `${name}=${value}`;
    updated = existing.has(name)
      ? updated.replace(new RegExp(`^${name}=.*$`, 'm'), line)
      : `${updated}\n${line}`;
  }
  temporaryPath = `${envPath}.web-auth-${process.pid}-${randomBytes(6).toString('hex')}`;
  const descriptor = openSync(temporaryPath, 'wx', 0o600);
  try {
    writeFileSync(descriptor, `${updated}\n`, { encoding: 'utf8' });
    fsyncSync(descriptor);
    if ((fstatSync(descriptor).mode & 0o777) !== 0o600) {
      throw new Error('temporary runtime env is not mode 600');
    }
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporaryPath, envPath);
  temporaryPath = undefined;
  const directory = openSync(dirname(envPath), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  console.log('OAuth runtime tuple saved to private env; secret not printed');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (temporaryPath) {
    try { unlinkSync(temporaryPath); } catch { /* failed write cleanup */ }
  }
}
