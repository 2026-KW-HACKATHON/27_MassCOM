import { stat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Wallet, getAddress, type Signer } from 'ethers';

/**
 * A configuration (non-retryable) problem discovered while resolving how the worker should sign
 * mint transactions. Never carries the password, keystore JSON, or private key in its message.
 */
export class MinterConfigurationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'MinterConfigurationError';
  }
}

/**
 * A worker that reads an env var whose NAME ends in one of these (case-insensitively, whatever
 * it is prefixed with — MINTER_, DEPLOYER_, WALLET_, ...) refuses to start: the service signer
 * must come from an encrypted keystore (MINTER_KEYSTORE_PATH / MINTER_KEYSTORE_PASSWORD_FILE),
 * never a raw key, seed phrase, or mnemonic sitting in the environment.
 * Assembled from pieces so this list itself never reads as a "NAME=value" secret assignment to
 * the repo's own secret scanner (scripts/check-secrets.sh).
 */
const FORBIDDEN_RAW_KEY_ENV_NAME_SUFFIXES = [
  ['PRIVATE', 'KEY'].join('_'),
  'MNEMONIC',
  ['SEED', 'PHRASE'].join('_'),
];

/** Public testnets the service signer is allowed to submit to. Base Sepolia only. */
export const SERVICE_SIGNER_ALLOWED_CHAIN_IDS: ReadonlySet<number> = new Set([84532]);

const moduleDir = dirname(fileURLToPath(import.meta.url));
/** apps/worker/src -> repo root. */
export const defaultRepoRoot = resolve(moduleDir, '../../..');

export type UnlockedSignerResolution = { mode: 'unlocked' };
export type ServiceSignerResolution = { mode: 'service'; signer: Signer; address: string };

export function assertNoRawPrivateKeyEnv(env: NodeJS.ProcessEnv): void {
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const normalizedName = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const forbidden = FORBIDDEN_RAW_KEY_ENV_NAME_SUFFIXES.some((suffix) =>
      normalizedName.endsWith(suffix.replace(/[^A-Z0-9]/g, '')),
    ) || normalizedName.endsWith('RECOVERYPHRASE');
    if (forbidden) {
      throw new MinterConfigurationError('MINTER_RAW_PRIVATE_KEY_ENV_FORBIDDEN');
    }
  }
}

export function assertServiceSignerChainAllowed(chainId: number): void {
  if (!SERVICE_SIGNER_ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new MinterConfigurationError('MINTER_CHAIN_NOT_ALLOWED');
  }
}

/**
 * Resolves how the worker should sign mint transactions for the given chain.
 * - chainId 31337 keeps the existing local-Anvil unlocked-account path unchanged, gated on
 *   ALLOW_UNLOCKED_LOCAL_MINTER=true exactly as before.
 * - any other chain id must be on the service-signer allow-list and provide an encrypted
 *   keystore outside the repository; the decrypted address must match minterAddress.
 */
export async function resolveMinterSigner(params: {
  env: NodeJS.ProcessEnv;
  chainId: number;
  minterAddress: string;
  repoRoot?: string;
}): Promise<UnlockedSignerResolution | ServiceSignerResolution> {
  // Applies on every chain, including the local Anvil branch: a raw key sitting in the
  // environment is a configuration mistake worth refusing on regardless of which signing path
  // ends up being used.
  assertNoRawPrivateKeyEnv(params.env);
  if (params.chainId === 31337) {
    if (params.env.ALLOW_UNLOCKED_LOCAL_MINTER !== 'true') {
      throw new MinterConfigurationError('MINTER_LOCAL_UNLOCKED_NOT_ALLOWED');
    }
    return { mode: 'unlocked' };
  }
  assertServiceSignerChainAllowed(params.chainId);
  const { keystoreJson, password } = await loadServiceSignerFiles({
    env: params.env,
    repoRoot: params.repoRoot ?? defaultRepoRoot,
  });
  return resolveServiceSigner({ keystoreJson, password, minterAddress: params.minterAddress });
}

export async function loadServiceSignerFiles(params: {
  env: NodeJS.ProcessEnv;
  repoRoot: string;
}): Promise<{ keystoreJson: string; password: string }> {
  const keystorePath = requiredEnv(params.env.MINTER_KEYSTORE_PATH, 'MINTER_KEYSTORE_PATH');
  const passwordFilePath = requiredEnv(
    params.env.MINTER_KEYSTORE_PASSWORD_FILE,
    'MINTER_KEYSTORE_PASSWORD_FILE',
  );
  const resolvedKeystorePath = await assertOutsideRepo(
    keystorePath,
    params.repoRoot,
    'MINTER_KEYSTORE_PATH_INSIDE_REPO',
  );
  const resolvedPasswordFilePath = await assertOutsideRepo(
    passwordFilePath,
    params.repoRoot,
    'MINTER_KEYSTORE_PASSWORD_FILE_INSIDE_REPO',
  );
  const keystoreJson = await readPrivateFile(resolvedKeystorePath, {
    directoryTooOpen: 'MINTER_KEYSTORE_DIRECTORY_PERMISSIONS_TOO_OPEN',
    permissionsTooOpen: 'MINTER_KEYSTORE_PERMISSIONS_TOO_OPEN',
    unreadable: 'MINTER_KEYSTORE_UNREADABLE',
  });
  const passwordRaw = await readPrivateFile(resolvedPasswordFilePath, {
    directoryTooOpen: 'MINTER_KEYSTORE_PASSWORD_DIRECTORY_PERMISSIONS_TOO_OPEN',
    permissionsTooOpen: 'MINTER_KEYSTORE_PASSWORD_PERMISSIONS_TOO_OPEN',
    unreadable: 'MINTER_KEYSTORE_PASSWORD_UNREADABLE',
  });
  // Strip every trailing CR/LF, not just a single one: some editors/tools leave more than one
  // trailing newline, and any of them left in place would become part of the password.
  const password = passwordRaw.replace(/[\r\n]+$/, '');
  return { keystoreJson, password };
}

export async function resolveServiceSigner(params: {
  keystoreJson: string;
  password: string;
  minterAddress: string;
}): Promise<ServiceSignerResolution> {
  let decryptedKey: string;
  try {
    const decrypted = await Wallet.fromEncryptedJson(params.keystoreJson, params.password);
    decryptedKey = decrypted.privateKey;
  } catch {
    // Never forward the underlying error: it can echo back keystore JSON fragments.
    throw new MinterConfigurationError('MINTER_KEYSTORE_DECRYPT_FAILED');
  }
  // Offline signer: nonce, gas, fees and chainId are always supplied explicitly by the gateway,
  // so no provider binding is required here (and keeps this module free of an RPC dependency).
  const wallet = new Wallet(decryptedKey);
  const address = getAddress(wallet.address);
  if (address !== getAddress(params.minterAddress)) {
    throw new MinterConfigurationError('MINTER_ADDRESS_MISMATCH');
  }
  return { mode: 'service', signer: wallet, address };
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new MinterConfigurationError(`MINTER_ENV_${name}_REQUIRED`);
  return value.trim();
}

/**
 * A syntactic (resolve-only) containment check can be fooled by a symlink: a path that reads as
 * outside the repository can still, through a symlinked component, point at a file that is
 * actually tracked inside it. Both sides are canonicalized with realpath before comparing, so
 * that case is rejected the same as a literally-inside path.
 */
async function assertOutsideRepo(
  candidatePath: string,
  repoRoot: string,
  code: string,
): Promise<string> {
  if (!isAbsolute(candidatePath)) throw new MinterConfigurationError(code);
  const resolvedRepoRoot = await realpath(resolve(repoRoot));
  const resolvedCandidate = await realpathTolerant(resolve(candidatePath));
  const relativePath = relative(resolvedRepoRoot, resolvedCandidate);
  const isInsideRepo =
    relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
  if (isInsideRepo) throw new MinterConfigurationError(code);
  return resolvedCandidate;
}

/**
 * fs.realpath requires the full path to exist, but the keystore/password file itself need not
 * exist yet at this point (a clear "unreadable" error follows later): resolve as much of the
 * path as does exist by walking up to the nearest existing ancestor, so a symlinked ancestor
 * directory still cannot be used to disguise a path that is really inside the repository.
 */
async function realpathTolerant(candidatePath: string): Promise<string> {
  try {
    return await realpath(candidatePath);
  } catch {
    const parent = dirname(candidatePath);
    if (parent === candidatePath) return candidatePath; // reached the filesystem root
    const resolvedParent = await realpathTolerant(parent);
    return resolve(resolvedParent, candidatePath.slice(parent.length + 1));
  }
}

async function assertDirectoryChainPrivate(filePath: string, code: string): Promise<void> {
  const currentUid = process.getuid?.();
  let directory = dirname(filePath);
  while (true) {
    let metadata;
    try {
      metadata = await stat(directory);
    } catch {
      throw new MinterConfigurationError(code);
    }
    const stickyRootDirectory = metadata.uid === 0 && (metadata.mode & 0o1000) !== 0;
    if ((metadata.mode & 0o022) !== 0 && !stickyRootDirectory) {
      throw new MinterConfigurationError(code);
    }
    if (currentUid !== undefined && metadata.uid !== 0 && metadata.uid !== currentUid) {
      throw new MinterConfigurationError(code);
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

/**
 * Opens the file once and reuses that single FileHandle for both the permission check and the
 * read, instead of a separate stat() + readFile() pair: two independent filesystem calls leave a
 * window for the file to be swapped out between the mode check and the read (TOCTOU).
 */
async function readPrivateFile(
  path: string,
  codes: { directoryTooOpen: string; permissionsTooOpen: string; unreadable: string },
): Promise<string> {
  await assertDirectoryChainPrivate(path, codes.directoryTooOpen);
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    throw new MinterConfigurationError(codes.unreadable);
  }
  try {
    const mode = (await handle.stat()).mode;
    if ((mode & 0o077) !== 0) {
      throw new MinterConfigurationError(codes.permissionsTooOpen);
    }
    return await handle.readFile('utf8');
  } catch (error) {
    if (error instanceof MinterConfigurationError) throw error;
    throw new MinterConfigurationError(codes.unreadable);
  } finally {
    await handle.close();
  }
}
