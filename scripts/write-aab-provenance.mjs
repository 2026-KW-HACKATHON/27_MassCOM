#!/usr/bin/env node

import { existsSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const allowedOptions = new Set([
  'output',
  'artifact',
  'artifact-sha256',
  'artifact-bytes',
  'source-commit',
  'mobile-dirty',
  'android-package',
  'android-version-name',
  'android-version-code',
  'signature-status',
  'signature-exit-code',
  'signature-certificate-sha256',
  'wallet-surface-status',
  'wallet-surface-exit-code',
  'release-readiness-status',
  'release-readiness-pending',
  'generated-at',
]);

function parseArguments(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith('--') || value === undefined) {
      throw new Error(`expected --option value, got ${option ?? 'end of input'}`);
    }
    const name = option.slice(2);
    if (!allowedOptions.has(name)) throw new Error(`unknown option: ${option}`);
    options.set(name, value);
  }
  return options;
}

function required(options, name) {
  const value = options.get(name);
  if (value === undefined || value === '') throw new Error(`missing required option: --${name}`);
  return value;
}

function status(options, name, label) {
  const normalized = required(options, name).trim().toUpperCase().replaceAll('-', '_');
  if (!['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN'].includes(normalized)) {
    throw new Error(`unknown ${label} status: ${normalized}`);
  }
  return normalized;
}

function integer(options, name, label) {
  const raw = required(options, name);
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a non-negative integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is outside the safe integer range`);
  return value;
}

function boolean(options, name) {
  const raw = required(options, name);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

const options = parseArguments(process.argv.slice(2));
const outputPath = required(options, 'output');
const artifactPath = required(options, 'artifact');
if (!existsSync(artifactPath)) throw new Error(`artifact does not exist: ${artifactPath}`);

const artifactSha256 = required(options, 'artifact-sha256');
if (!/^[0-9a-f]{64}$/i.test(artifactSha256)) {
  throw new Error('artifact sha256 must be 64 hexadecimal characters');
}

const sourceCommit = required(options, 'source-commit');
if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
  throw new Error('source commit must be a 40-character hexadecimal Git object id');
}

const certificate = options.get('signature-certificate-sha256') ?? '';
if (certificate !== '' && !/^[0-9a-f]{64}$/i.test(certificate)) {
  throw new Error('signature certificate sha256 must be empty or 64 hexadecimal characters');
}

const generatedAt = options.get('generated-at') ?? new Date().toISOString();
if (new Date(generatedAt).toISOString() !== generatedAt) {
  throw new Error('generated-at must be a canonical ISO-8601 timestamp');
}

if (!options.has('release-readiness-pending')) {
  throw new Error('missing required option: --release-readiness-pending');
}
const pending = options.get('release-readiness-pending')
  .split(',')
  .map((gate) => gate.trim())
  .filter(Boolean);

const record = {
  schema: 'masscom.aab-provenance.v1',
  artifact: {
    basename: basename(artifactPath),
    sha256: artifactSha256.toLowerCase(),
    bytes: integer(options, 'artifact-bytes', 'artifact bytes'),
  },
  source: {
    commit: sourceCommit.toLowerCase(),
    mobileDirty: boolean(options, 'mobile-dirty'),
  },
  android: {
    package: required(options, 'android-package'),
    versionName: required(options, 'android-version-name'),
    versionCode: integer(options, 'android-version-code', 'Android version code'),
  },
  signature: {
    status: status(options, 'signature-status', 'signature'),
    exitCode: integer(options, 'signature-exit-code', 'signature exit code'),
    certificateSha256: certificate === '' ? null : certificate.toUpperCase(),
  },
  walletSurface: {
    status: status(options, 'wallet-surface-status', 'wallet surface'),
    exitCode: integer(options, 'wallet-surface-exit-code', 'wallet surface exit code'),
  },
  releaseReadiness: {
    status: status(options, 'release-readiness-status', 'release readiness'),
    pending,
  },
  generatedAt,
};

if (record.releaseReadiness.status === 'PASS' && record.releaseReadiness.pending.length > 0) {
  throw new Error('release readiness cannot pass with pending gates');
}

writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
