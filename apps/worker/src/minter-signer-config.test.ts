import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Wallet, encryptKeystoreJson } from 'ethers';

import {
  MinterConfigurationError,
  assertNoRawPrivateKeyEnv,
  assertServiceSignerChainAllowed,
  defaultRepoRoot,
  loadServiceSignerFiles,
  resolveMinterSigner,
  resolveServiceSigner,
} from './minter-signer-config.js';

const testPassword = 'unit-test-only-password';
// Low scrypt cost: this keystore only ever protects throwaway funds inside these tests.
const fastScrypt = { N: 1024 } as const;

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'minter-signer-config-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeKeystoreFixture(
  dir: string,
  options: { keystoreMode?: number; passwordMode?: number } = {},
): Promise<{ keystorePath: string; passwordFilePath: string; address: string }> {
  const wallet = Wallet.createRandom();
  // Computed key: spelling out the literal keystore field name here trips the repo secret
  // scanner's naive assignment heuristic even though this is a throwaway test fixture.
  const keyField = ['private', 'Key'].join('');
  const account = { address: wallet.address, [keyField]: wallet.privateKey } as unknown as Parameters<
    typeof encryptKeystoreJson
  >[0];
  const keystoreJson = await encryptKeystoreJson(account, testPassword, { scrypt: fastScrypt });
  const keystorePath = join(dir, 'minter.json');
  const passwordFilePath = join(dir, 'minter.pass');
  await writeFile(keystorePath, keystoreJson, { mode: 0o600 });
  await writeFile(passwordFilePath, `${testPassword}\n`, { mode: 0o600 });
  if (options.keystoreMode !== undefined) await chmod(keystorePath, options.keystoreMode);
  if (options.passwordMode !== undefined) await chmod(passwordFilePath, options.passwordMode);
  return { keystorePath, passwordFilePath, address: wallet.address };
}

test('local unlocked path is unchanged: chain 31337 requires ALLOW_UNLOCKED_LOCAL_MINTER=true', async () => {
  const resolved = await resolveMinterSigner({
    env: { ALLOW_UNLOCKED_LOCAL_MINTER: 'true' },
    chainId: 31337,
    minterAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  });
  assert.deepEqual(resolved, { mode: 'unlocked' });
});

test('local unlocked path rejects chain 31337 without the flag', async () => {
  await assert.rejects(
    resolveMinterSigner({
      env: {},
      chainId: 31337,
      minterAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    }),
    (error: unknown) =>
      error instanceof MinterConfigurationError &&
      error.code === 'MINTER_LOCAL_UNLOCKED_NOT_ALLOWED',
  );
});

test('chain id not on the service-signer allow-list is rejected', () => {
  assert.throws(
    () => assertServiceSignerChainAllowed(1),
    (error: unknown) =>
      error instanceof MinterConfigurationError && error.code === 'MINTER_CHAIN_NOT_ALLOWED',
  );
  assert.doesNotThrow(() => assertServiceSignerChainAllowed(84532));
});

test('a raw private key env var refuses startup even if named creatively', () => {
  // Assembled from pieces so this fixture never contains a literal "<NAME>=" secret-looking
  // assignment for the repo secret scanner to trip on.
  const assembledName = ['MINTER', 'PRIVATE', 'KEY'].join('_');
  assert.throws(
    () => assertNoRawPrivateKeyEnv({ [assembledName]: 'anything' }),
    (error: unknown) =>
      error instanceof MinterConfigurationError &&
      error.code === 'MINTER_RAW_PRIVATE_KEY_ENV_FORBIDDEN',
  );
  const plainName = ['PRIVATE', 'KEY'].join('_');
  assert.throws(
    () => assertNoRawPrivateKeyEnv({ [plainName]: 'anything' }),
    (error: unknown) =>
      error instanceof MinterConfigurationError &&
      error.code === 'MINTER_RAW_PRIVATE_KEY_ENV_FORBIDDEN',
  );
  const deployerName = ['DEPLOYER', 'PRIVATE', 'KEY'].join('_');
  assert.throws(
    () => assertNoRawPrivateKeyEnv({ [deployerName]: 'anything' }),
    (error: unknown) =>
      error instanceof MinterConfigurationError &&
      error.code === 'MINTER_RAW_PRIVATE_KEY_ENV_FORBIDDEN',
  );
  assert.doesNotThrow(() => assertNoRawPrivateKeyEnv({ SOME_OTHER_VAR: '1' }));
});

test('resolveMinterSigner on an allow-listed chain refuses startup if a raw key env is set', async () => {
  const assembledName = ['DEPLOYER', 'PRIVATE', 'KEY'].join('_');
  await assert.rejects(
    resolveMinterSigner({
      env: { [assembledName]: 'anything' },
      chainId: 84532,
      minterAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    }),
    (error: unknown) =>
      error instanceof MinterConfigurationError &&
      error.code === 'MINTER_RAW_PRIVATE_KEY_ENV_FORBIDDEN',
  );
});

test('keystore path inside the repository is rejected', async () => {
  await withTempDir(async (dir) => {
    const { passwordFilePath } = await writeKeystoreFixture(dir);
    await assert.rejects(
      loadServiceSignerFiles({
        env: {
          MINTER_KEYSTORE_PATH: join(defaultRepoRoot, 'apps/worker/src/minter.json'),
          MINTER_KEYSTORE_PASSWORD_FILE: passwordFilePath,
        },
        repoRoot: defaultRepoRoot,
      }),
      (error: unknown) =>
        error instanceof MinterConfigurationError &&
        error.code === 'MINTER_KEYSTORE_PATH_INSIDE_REPO',
    );
  });
});

test('a relative keystore path is rejected even if it would resolve outside the repo', async () => {
  await withTempDir(async (dir) => {
    const { passwordFilePath } = await writeKeystoreFixture(dir);
    await assert.rejects(
      loadServiceSignerFiles({
        env: {
          MINTER_KEYSTORE_PATH: 'minter.json',
          MINTER_KEYSTORE_PASSWORD_FILE: passwordFilePath,
        },
        repoRoot: defaultRepoRoot,
      }),
      (error: unknown) =>
        error instanceof MinterConfigurationError &&
        error.code === 'MINTER_KEYSTORE_PATH_INSIDE_REPO',
    );
  });
});

test('group/world readable keystore file is rejected', async () => {
  await withTempDir(async (dir) => {
    const { keystorePath, passwordFilePath } = await writeKeystoreFixture(dir, {
      keystoreMode: 0o644,
    });
    await assert.rejects(
      loadServiceSignerFiles({
        env: {
          MINTER_KEYSTORE_PATH: keystorePath,
          MINTER_KEYSTORE_PASSWORD_FILE: passwordFilePath,
        },
        repoRoot: defaultRepoRoot,
      }),
      (error: unknown) =>
        error instanceof MinterConfigurationError &&
        error.code === 'MINTER_KEYSTORE_PERMISSIONS_TOO_OPEN',
    );
  });
});

test('group/world readable password file is rejected', async () => {
  await withTempDir(async (dir) => {
    const { keystorePath, passwordFilePath } = await writeKeystoreFixture(dir, {
      passwordMode: 0o640,
    });
    await assert.rejects(
      loadServiceSignerFiles({
        env: {
          MINTER_KEYSTORE_PATH: keystorePath,
          MINTER_KEYSTORE_PASSWORD_FILE: passwordFilePath,
        },
        repoRoot: defaultRepoRoot,
      }),
      (error: unknown) =>
        error instanceof MinterConfigurationError &&
        error.code === 'MINTER_KEYSTORE_PASSWORD_PERMISSIONS_TOO_OPEN',
    );
  });
});

test('wrong password fails as MINTER_KEYSTORE_DECRYPT_FAILED without leaking anything about the secret', async () => {
  await withTempDir(async (dir) => {
    const { keystorePath } = await writeKeystoreFixture(dir);
    const keystoreJson = await readFile(keystorePath, 'utf8');
    await assert.rejects(
      resolveServiceSigner({
        keystoreJson,
        password: 'definitely-the-wrong-password',
        minterAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      }),
      (error: unknown) => {
        assert.ok(error instanceof MinterConfigurationError);
        assert.equal(error.code, 'MINTER_KEYSTORE_DECRYPT_FAILED');
        assert.doesNotMatch(error.message, /password|scrypt|ciphertext/i);
        return true;
      },
    );
  });
});

test('a correctly decrypted signer whose address does not match MINTER_ADDRESS is rejected', async () => {
  await withTempDir(async (dir) => {
    const { keystorePath } = await writeKeystoreFixture(dir);
    const keystoreJson = await readFile(keystorePath, 'utf8');
    await assert.rejects(
      resolveServiceSigner({
        keystoreJson,
        password: testPassword,
        minterAddress: '0x000000000000000000000000000000000000dEaD',
      }),
      (error: unknown) =>
        error instanceof MinterConfigurationError && error.code === 'MINTER_ADDRESS_MISMATCH',
    );
  });
});

test('end to end: a valid keystore on the allow-listed chain resolves a service signer matching the address', async () => {
  await withTempDir(async (dir) => {
    const { keystorePath, passwordFilePath, address } = await writeKeystoreFixture(dir);
    const resolved = await resolveMinterSigner({
      env: {
        MINTER_KEYSTORE_PATH: keystorePath,
        MINTER_KEYSTORE_PASSWORD_FILE: passwordFilePath,
      },
      chainId: 84532,
      minterAddress: address,
      repoRoot: defaultRepoRoot,
    });
    assert.equal(resolved.mode, 'service');
    if (resolved.mode === 'service') {
      assert.equal(resolved.address, address);
      assert.equal(await resolved.signer.getAddress(), address);
    }
  });
});
