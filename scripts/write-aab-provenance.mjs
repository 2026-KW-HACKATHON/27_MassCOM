#!/usr/bin/env node

import {
  existsSync,
  linkSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';

const allowedOptions = new Set([
  'output',
  'artifact',
  'artifact-sha256',
  'artifact-bytes',
  'artifact-source-commit',
  'source-commit',
  'mobile-dirty',
  'source-expected-android-package',
  'source-expected-android-version-name',
  'source-expected-android-version-code',
  'w08-verified-artifact-package',
  'signature-status',
  'signature-exit-code',
  'signature-certificate-sha256',
  'wallet-surface-status',
  'wallet-surface-exit-code',
  'release-readiness-status',
  'release-readiness-pending',
  'generated-at',
  'input',
  'finalize-artifact-basename',
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

function validateAutomatedVerdict(verdict, label) {
  if (!['PASS', 'FAIL'].includes(verdict.status)) {
    throw new Error(`${label} status must be PASS or FAIL`);
  }
  if (verdict.status === 'PASS' && verdict.exitCode !== 0) {
    throw new Error(`${label} PASS requires exit code 0`);
  }
  if (verdict.status === 'FAIL' && verdict.exitCode === 0) {
    throw new Error(`${label} FAIL requires a nonzero exit code`);
  }
}

function canonicalOutputPath(outputPath) {
  return join(realpathSync(dirname(resolve(outputPath))), basename(outputPath));
}

function writeRecordAtomically(outputPath, record) {
  const outputCanonicalPath = canonicalOutputPath(outputPath);
  const temporaryPath = join(
    dirname(outputCanonicalPath),
    `.${basename(outputCanonicalPath)}.${randomUUID()}.tmp`,
  );
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    linkSync(temporaryPath, outputCanonicalPath);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error(`provenance output already exists: ${outputCanonicalPath}`);
    }
    throw error;
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

const options = parseArguments(process.argv.slice(2));
const outputPath = required(options, 'output');
if (options.has('finalize-artifact-basename')) {
  const finalizationOptions = new Set(['input', 'output', 'finalize-artifact-basename']);
  for (const option of options.keys()) {
    if (!finalizationOptions.has(option)) {
      throw new Error(`finalization does not accept option: --${option}`);
    }
  }
  const inputPath = required(options, 'input');
  if (!existsSync(inputPath)) throw new Error(`provenance input does not exist: ${inputPath}`);
  const inputCanonicalPath = realpathSync(inputPath);
  const outputCanonicalPath = canonicalOutputPath(outputPath);
  if (inputCanonicalPath === outputCanonicalPath) {
    throw new Error('finalized provenance output must differ from its input');
  }
  const finalArtifactBasename = required(options, 'finalize-artifact-basename');
  if (
    basename(finalArtifactBasename) !== finalArtifactBasename ||
    !finalArtifactBasename.endsWith('.aab')
  ) {
    throw new Error('final artifact basename must be a basename ending in .aab');
  }
  const record = JSON.parse(readFileSync(inputCanonicalPath, 'utf8'));
  if (record?.schema !== 'masscom.aab-provenance.v1' || typeof record?.artifact !== 'object') {
    throw new Error('provenance input does not use the supported schema');
  }
  if (!/^[0-9a-f]{64}$/i.test(record.artifact.sha256 ?? '')) {
    throw new Error('provenance input has an invalid artifact sha256');
  }
  if (!Number.isSafeInteger(record.artifact.bytes) || record.artifact.bytes < 0) {
    throw new Error('provenance input has invalid artifact bytes');
  }
  record.artifact.basename = finalArtifactBasename;
  writeRecordAtomically(outputCanonicalPath, record);
  process.exit(0);
}

const artifactPath = required(options, 'artifact');
if (!existsSync(artifactPath)) throw new Error(`artifact does not exist: ${artifactPath}`);
const artifactCanonicalPath = realpathSync(artifactPath);
const outputCanonicalPath = canonicalOutputPath(outputPath);
const artifactStat = statSync(artifactPath);
let sameExistingInode = false;
if (existsSync(outputPath)) {
  const outputStat = statSync(outputPath);
  sameExistingInode = outputStat.dev === artifactStat.dev && outputStat.ino === artifactStat.ino;
}
if (outputCanonicalPath === artifactCanonicalPath || sameExistingInode) {
  throw new Error('provenance output must not refer to the artifact');
}

const artifactSha256 = required(options, 'artifact-sha256');
if (!/^[0-9a-f]{64}$/i.test(artifactSha256)) {
  throw new Error('artifact sha256 must be 64 hexadecimal characters');
}

const sourceCommit = required(options, 'source-commit');
if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
  throw new Error('source commit must be a 40-character hexadecimal Git object id');
}
const artifactSourceCommit = required(options, 'artifact-source-commit');
if (!/^[0-9a-f]{40}$/i.test(artifactSourceCommit)) {
  throw new Error('artifact source commit must be a 40-character hexadecimal Git object id');
}
if (artifactSourceCommit.toLowerCase() !== sourceCommit.toLowerCase()) {
  throw new Error('artifact source commit must match the source commit');
}

const certificate = options.get('signature-certificate-sha256') ?? '';
if (certificate !== '' && !/^[0-9a-f]{64}$/i.test(certificate)) {
  throw new Error('signature certificate sha256 must be empty or 64 hexadecimal characters');
}

const w08VerifiedArtifactPackage = options.get('w08-verified-artifact-package') ?? '';
if (
  w08VerifiedArtifactPackage !== '' &&
  !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(w08VerifiedArtifactPackage)
) {
  throw new Error('W08-verified artifact package is not a valid Android package name');
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
    buildSourceCommit: artifactSourceCommit.toLowerCase(),
  },
  source: {
    commit: sourceCommit.toLowerCase(),
    mobileDirty: boolean(options, 'mobile-dirty'),
  },
  android: {
    sourceExpected: {
      package: required(options, 'source-expected-android-package'),
      versionName: required(options, 'source-expected-android-version-name'),
      versionCode: integer(
        options,
        'source-expected-android-version-code',
        'source-expected Android version code',
      ),
    },
    w08VerifiedArtifactPackage:
      w08VerifiedArtifactPackage === '' ? null : w08VerifiedArtifactPackage,
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
validateAutomatedVerdict(record.signature, 'signature');
validateAutomatedVerdict(record.walletSurface, 'wallet surface');
if (record.signature.status === 'PASS' && record.signature.certificateSha256 === null) {
  throw new Error('signature PASS requires a certificate fingerprint');
}
if (
  record.walletSurface.status === 'PASS' &&
  record.android.w08VerifiedArtifactPackage === null
) {
  throw new Error('wallet surface PASS requires a verified artifact package');
}
if (
  record.walletSurface.status === 'PASS' &&
  record.android.w08VerifiedArtifactPackage !== record.android.sourceExpected.package
) {
  throw new Error(
    'W08-verified artifact package must match source-expected Android package',
  );
}

writeRecordAtomically(outputCanonicalPath, record);
