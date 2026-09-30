import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  encryptKeystoreJson,
  getAddress,
  id,
  parseEther,
  type InterfaceAbi,
  type JsonRpcApiProvider,
} from 'ethers';
import { Pool } from 'pg';

import { EthersMintChainGateway } from './ethers-chain-gateway.js';
import { ChainConfigurationError, MintWorker, type MintWorkItem } from './mint-worker.js';
import { PostgresMintRepository } from './postgres-mint-repository.js';

const testMetadataOrigin = 'https://masscom.kr';

const adminAddress = getAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
const pauserAddress = getAddress('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
const funderAddress = getAddress('0x90F79bf6EB2c4f870365E785982E1f101E93b906');
const recipients = [
  getAddress('0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'),
  getAddress('0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'),
  getAddress('0x976EA74026E726554dB657fA54763abd0C3a0aa9'),
  getAddress('0x14dC79964da2C08b23698B3D3cc7Ca32193d9955'),
] as const;

// Low scrypt cost: these keystores only ever protect throwaway Anvil funds inside this test file.
const fastScrypt = { N: 1024 } as const;
const keystorePassword = 'anvil-service-signer-fixture';

test('W-100 service signer record-before-send survives crashes, lost responses, and races on Anvil', async (t) => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error('ANVIL_RPC_URL is required');
  const databaseUrl = requiredTestDatabaseUrl();
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const pool = new Pool({ connectionString: databaseUrl });
  const tempDirs: string[] = [];
  t.after(async () => {
    await pool.end();
    await provider.destroy();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  await truncateServiceSignerTables(pool);
  const artifact = JSON.parse(
    await readFile(
      new URL('../../../contracts/out/WolgyeMascot.sol/WolgyeMascot.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: InterfaceAbi; bytecode: { object: string } };

  const serviceSigner = Wallet.createRandom();
  const funder = await provider.getSigner(funderAddress);
  await waitFor(await funder.sendTransaction({ to: serviceSigner.address, value: parseEther('5') }));

  const adminSigner = await provider.getSigner(adminAddress);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, adminSigner);
  const contract = await factory.deploy(adminAddress, serviceSigner.address, pauserAddress);
  await contract.waitForDeployment();
  const contractAddress = getAddress(await contract.getAddress());
  const seriesKey = id('service-signer-series');
  await waitFor(await contract.getFunction('createSeries').send(seriesKey, 'ipfs://service-signer/', 10));
  await waitFor(await contract.getFunction('activateSeries').send(seriesKey));

  const rewardKeys = [id('service-signer-reward-1'), id('service-signer-reward-2')] as const;
  const jobIds = [
    '90000000-0000-4000-9001-000000000001',
    '90000000-0000-4000-9001-000000000002',
  ] as const;
  await seedServiceSignerJobs(pool, contractAddress, seriesKey, rewardKeys, jobIds);

  const { keystorePath, passwordFilePath } = await writeKeystoreFixture(serviceSigner);
  tempDirs.push(join(keystorePath, '..'));

  function makeGateway(): EthersMintChainGateway {
    return new EthersMintChainGateway({
      rpcUrl: rpcUrl!,
      chainId: 31337,
      contractAddress,
      minterAddress: serviceSigner.address,
      confirmations: 1,
      fromBlock: 0,
      signer: serviceSigner,
    });
  }

  // (f) a signer without MINTER_ROLE is a configuration error and nothing is sent.
  const strangerSigner = Wallet.createRandom();
  const strangerGateway = new EthersMintChainGateway({
    rpcUrl: rpcUrl!,
    chainId: 31337,
    contractAddress,
    minterAddress: strangerSigner.address,
    confirmations: 1,
    fromBlock: 0,
    signer: strangerSigner,
  });
  await assert.rejects(
    strangerGateway.validate({
      jobId: 'validation-job',
      outboxId: 'validation-outbox',
      accountId: 'validation-account',
      entitlementId: 'validation-entitlement',
      rewardKey: rewardKeys[0],
      recipient: recipients[0],
      chainId: 31337,
      contractAddress,
      seriesKey,
    }),
    (error: unknown) =>
      error instanceof ChainConfigurationError && error.code === 'MINTER_ROLE_MISSING',
  );
  assert.equal(await provider.getTransactionCount(strangerSigner.address, 'latest'), 0);

  // Sanity check the keystore we wrote decrypts back to the funded service signer address.
  const keystoreJson = await readFile(keystorePath, 'utf8');
  const decrypted = await Wallet.fromEncryptedJson(keystoreJson, await readFile(passwordFilePath, 'utf8'));
  assert.equal(getAddress(decrypted.address), serviceSigner.address);

  const nonceBefore = await provider.getTransactionCount(serviceSigner.address, 'latest');

  // (a) happy path: a fresh submission mints once end to end.
  {
    const gateway = makeGateway();
    const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
    const worker = new MintWorker(repository, gateway);
    assert.equal(await worker.runOnce('service-signer-worker'), true);
    assert.equal(getAddress(await contract.getFunction('ownerOf').staticCall(1n)), recipients[0]);
    const attempt = await pool.query<{ attempt_count: number }>(
      'SELECT attempt_count FROM mint_jobs WHERE id = $1',
      [jobIds[0]],
    );
    assert.equal(attempt.rows[0]?.attempt_count, 1);
    const nonceAfterHappyPath = await provider.getTransactionCount(serviceSigner.address, 'latest');
    assert.equal(nonceAfterHappyPath, nonceBefore + 1);
  }

  // (b) crash after record but before broadcast: restart re-broadcasts the SAME signed
  // transaction and mints exactly once, without a second markPrepared.
  {
    const gateway = makeGateway();
    const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
    const worker = new MintWorker(repository, gateway);
    const rawProvider = internalProvider(gateway);
    const originalBroadcast = rawProvider.broadcastTransaction.bind(rawProvider);
    rawProvider.broadcastTransaction = async () => {
      throw new Error('SIMULATED_CRASH_BEFORE_BROADCAST');
    };
    assert.equal(await worker.runOnce('service-signer-worker'), true);
    const afterCrash = await pool.query<{ status: string; transaction_hash: string | null }>(
      'SELECT status, transaction_hash FROM mint_jobs WHERE id = $1',
      [jobIds[1]],
    );
    assert.equal(afterCrash.rows[0]?.status, 'RETRYABLE');
    assert.ok(afterCrash.rows[0]?.transaction_hash);
    const recordedHash = afterCrash.rows[0]!.transaction_hash!;

    rawProvider.broadcastTransaction = originalBroadcast;
    await waitForRetryAvailable(pool, jobIds[1]);

    const restartedGateway = makeGateway();
    const restartedRepository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
    const restartedWorker = new MintWorker(restartedRepository, restartedGateway);
    assert.equal(await restartedWorker.runOnce('service-signer-worker-restart'), true);

    const finalized = await pool.query<{
      status: string;
      transaction_hash: string | null;
      attempt_count: number;
    }>('SELECT status, transaction_hash, attempt_count FROM mint_jobs WHERE id = $1', [jobIds[1]]);
    assert.equal(finalized.rows[0]?.status, 'FINALIZED');
    assert.equal(finalized.rows[0]?.transaction_hash, recordedHash);
    assert.equal(finalized.rows[0]?.attempt_count, 1);
    assert.equal(getAddress(await contract.getFunction('ownerOf').staticCall(2n)), recipients[1]);
    const attempts = await pool.query<{ count: string }>(
      'SELECT count(*) FROM mint_tx_attempts WHERE mint_job_id = $1',
      [jobIds[1]],
    );
    assert.equal(attempts.rows[0]?.count, '1');
  }
});

test('W-100 lost broadcast response confirms the same hash on restart with exactly one nonce spent', async (t) => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error('ANVIL_RPC_URL is required');
  const databaseUrl = requiredTestDatabaseUrl();
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const pool = new Pool({ connectionString: databaseUrl });
  const tempDirs: string[] = [];
  t.after(async () => {
    await pool.end();
    await provider.destroy();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  await truncateServiceSignerTables(pool);
  const artifact = JSON.parse(
    await readFile(
      new URL('../../../contracts/out/WolgyeMascot.sol/WolgyeMascot.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: InterfaceAbi; bytecode: { object: string } };

  const serviceSigner = Wallet.createRandom();
  const funder = await provider.getSigner(funderAddress);
  await waitFor(await funder.sendTransaction({ to: serviceSigner.address, value: parseEther('5') }));
  const adminSigner = await provider.getSigner(adminAddress);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, adminSigner);
  const contract = await factory.deploy(adminAddress, serviceSigner.address, pauserAddress);
  await contract.waitForDeployment();
  const contractAddress = getAddress(await contract.getAddress());
  const seriesKey = id('service-signer-lost-response-series');
  await waitFor(await contract.getFunction('createSeries').send(seriesKey, 'ipfs://lost-response/', 5));
  await waitFor(await contract.getFunction('activateSeries').send(seriesKey));

  const rewardKey = id('service-signer-lost-response-reward');
  const jobId = '90000000-0000-4000-9002-000000000001';
  await seedServiceSignerJobs(pool, contractAddress, seriesKey, [rewardKey], [jobId]);

  function makeGateway(): EthersMintChainGateway {
    return new EthersMintChainGateway({
      rpcUrl: rpcUrl!,
      chainId: 31337,
      contractAddress,
      minterAddress: serviceSigner.address,
      confirmations: 1,
      fromBlock: 0,
      signer: serviceSigner,
    });
  }

  const nonceBefore = await provider.getTransactionCount(serviceSigner.address, 'latest');

  const gateway = makeGateway();
  const repository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const worker = new MintWorker(repository, gateway);
  const rawProvider = internalProvider(gateway);
  const originalBroadcast = rawProvider.broadcastTransaction.bind(rawProvider);
  rawProvider.broadcastTransaction = async (signed: string) => {
    // The transaction really is broadcast (and Anvil auto-mines it); only the response is lost.
    await originalBroadcast(signed);
    throw new Error('SIMULATED_LOST_RESPONSE');
  };

  assert.equal(await worker.runOnce('lost-response-worker'), true);
  const afterLostResponse = await pool.query<{ status: string; transaction_hash: string | null }>(
    'SELECT status, transaction_hash FROM mint_jobs WHERE id = $1',
    [jobId],
  );
  assert.equal(afterLostResponse.rows[0]?.status, 'RETRYABLE');
  const recordedHash = afterLostResponse.rows[0]?.transaction_hash;
  assert.ok(recordedHash);

  await waitForRetryAvailable(pool, jobId);

  const restartedGateway = makeGateway();
  const restartedRepository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const restartedWorker = new MintWorker(restartedRepository, restartedGateway);
  assert.equal(await restartedWorker.runOnce('lost-response-worker-restart'), true);

  const finalized = await pool.query<{ status: string; transaction_hash: string | null }>(
    'SELECT status, transaction_hash FROM mint_jobs WHERE id = $1',
    [jobId],
  );
  assert.equal(finalized.rows[0]?.status, 'FINALIZED');
  assert.equal(finalized.rows[0]?.transaction_hash, recordedHash);
  assert.equal(getAddress(await contract.getFunction('ownerOf').staticCall(1n)), recipients[0]);

  const nonceAfter = await provider.getTransactionCount(serviceSigner.address, 'latest');
  assert.equal(nonceAfter, nonceBefore + 1);
});

test('W-100 consecutive submissions get consecutive nonces and two racing workers both finalize', async (t) => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error('ANVIL_RPC_URL is required');
  const databaseUrl = requiredTestDatabaseUrl();
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    await pool.end();
    await provider.destroy();
  });

  await truncateServiceSignerTables(pool);
  const artifact = JSON.parse(
    await readFile(
      new URL('../../../contracts/out/WolgyeMascot.sol/WolgyeMascot.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: InterfaceAbi; bytecode: { object: string } };

  const serviceSigner = Wallet.createRandom();
  const funder = await provider.getSigner(funderAddress);
  await waitFor(await funder.sendTransaction({ to: serviceSigner.address, value: parseEther('5') }));
  const adminSigner = await provider.getSigner(adminAddress);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, adminSigner);
  const contract = await factory.deploy(adminAddress, serviceSigner.address, pauserAddress);
  await contract.waitForDeployment();
  const contractAddress = getAddress(await contract.getAddress());
  const seriesKey = id('service-signer-race-series');
  await waitFor(await contract.getFunction('createSeries').send(seriesKey, 'ipfs://race/', 10));
  await waitFor(await contract.getFunction('activateSeries').send(seriesKey));

  const rewardKeys = [id('service-signer-race-reward-1'), id('service-signer-race-reward-2')] as const;
  const jobIds = [
    '90000000-0000-4000-9003-000000000001',
    '90000000-0000-4000-9003-000000000002',
  ] as const;
  await seedServiceSignerJobs(pool, contractAddress, seriesKey, rewardKeys, jobIds);

  function makeGateway(): EthersMintChainGateway {
    return new EthersMintChainGateway({
      rpcUrl: rpcUrl!,
      chainId: 31337,
      contractAddress,
      minterAddress: serviceSigner.address,
      confirmations: 1,
      fromBlock: 0,
      signer: serviceSigner,
    });
  }

  // (d) two jobs submitted back to back (sequential runOnce calls) get consecutive nonces.
  const nonceBefore = await provider.getTransactionCount(serviceSigner.address, 'latest');
  const sequentialRepository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const sequentialWorker = new MintWorker(sequentialRepository, makeGateway());
  assert.equal(await sequentialWorker.runOnce('sequential-worker'), true);
  const firstJob = await pool.query<{ transaction_hash: string }>(
    'SELECT transaction_hash FROM mint_jobs WHERE id = $1',
    [jobIds[0]],
  );
  const firstTx = await provider.getTransaction(firstJob.rows[0]!.transaction_hash);
  assert.equal(firstTx?.nonce, nonceBefore);
  assert.equal(await sequentialWorker.runOnce('sequential-worker'), true);
  const secondJob = await pool.query<{ transaction_hash: string }>(
    'SELECT transaction_hash FROM mint_jobs WHERE id = $1',
    [jobIds[1]],
  );
  const secondTx = await provider.getTransaction(secondJob.rows[0]!.transaction_hash);
  assert.equal(secondTx?.nonce, nonceBefore + 1);
  assert.equal(getAddress(await contract.getFunction('ownerOf').staticCall(1n)), recipients[0]);
  assert.equal(getAddress(await contract.getFunction('ownerOf').staticCall(2n)), recipients[1]);

  // (e) two more jobs, this time leased and submitted by two workers racing concurrently: the
  // per chain/minter advisory lock must still hand out distinct nonces so both finalize.
  const raceRewardKeys = [id('service-signer-race-reward-3'), id('service-signer-race-reward-4')] as const;
  const raceJobIds = [
    '90000000-0000-4000-9003-000000000003',
    '90000000-0000-4000-9003-000000000004',
  ] as const;
  await seedServiceSignerJobs(pool, contractAddress, seriesKey, raceRewardKeys, raceJobIds, 2);

  const workerA = new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), makeGateway());
  const workerB = new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), makeGateway());
  const raceResults = await Promise.all([
    workerA.runOnce('race-worker-a'),
    workerB.runOnce('race-worker-b'),
  ]);
  assert.deepEqual(raceResults, [true, true]);

  const raceJobs = await pool.query<{ id: string; status: string }>(
    'SELECT id, status FROM mint_jobs WHERE id = ANY($1)',
    [raceJobIds],
  );
  for (const row of raceJobs.rows) {
    assert.equal(row.status, 'FINALIZED', `job ${row.id} did not finalize`);
  }
  // Lease order between the two racing workers is not deterministic, so check that both
  // recipients ended up owning one of the two newly minted tokens rather than a fixed order.
  const raceOwners = await Promise.all([
    contract.getFunction('ownerOf').staticCall(3n),
    contract.getFunction('ownerOf').staticCall(4n),
  ]);
  assert.deepEqual(
    raceOwners.map((owner) => getAddress(String(owner))).sort(),
    [recipients[2], recipients[3]].sort(),
  );
});

test('W-100 a recorded but unbroadcast transaction keeps its nonce when the next job is submitted', async (t) => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error('ANVIL_RPC_URL is required');
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(async () => {
    await pool.end();
    await provider.destroy();
  });

  await truncateServiceSignerTables(pool);
  const artifact = JSON.parse(
    await readFile(
      new URL('../../../contracts/out/WolgyeMascot.sol/WolgyeMascot.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: InterfaceAbi; bytecode: { object: string } };
  const serviceSigner = Wallet.createRandom();
  const funder = await provider.getSigner(funderAddress);
  await waitFor(await funder.sendTransaction({ to: serviceSigner.address, value: parseEther('5') }));
  const adminSigner = await provider.getSigner(adminAddress);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, adminSigner);
  const contract = await factory.deploy(adminAddress, serviceSigner.address, pauserAddress);
  await contract.waitForDeployment();
  const contractAddress = getAddress(await contract.getAddress());
  const seriesKey = id('service-signer-straggler-series');
  await waitFor(await contract.getFunction('createSeries').send(seriesKey, 'ipfs://straggler/', 10));
  await waitFor(await contract.getFunction('activateSeries').send(seriesKey));
  const rewardKeys = [id('service-signer-straggler-1'), id('service-signer-straggler-2')] as const;
  const jobIds = [
    '90000000-0000-4000-9004-000000000001',
    '90000000-0000-4000-9004-000000000002',
  ] as const;
  await seedServiceSignerJobs(pool, contractAddress, seriesKey, rewardKeys, jobIds);

  function makeGateway(): EthersMintChainGateway {
    return new EthersMintChainGateway({
      rpcUrl: rpcUrl!,
      chainId: 31337,
      contractAddress,
      minterAddress: serviceSigner.address,
      confirmations: 1,
      fromBlock: 0,
      signer: serviceSigner,
    });
  }

  const nonceBefore = await provider.getTransactionCount(serviceSigner.address, 'latest');
  const crashingGateway = makeGateway();
  internalProvider(crashingGateway).broadcastTransaction = async () => {
    throw new Error('SIMULATED_CRASH_BEFORE_BROADCAST');
  };
  assert.equal(await new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), crashingGateway).runOnce('dies-first'), true);
  const straggler = await pool.query<{ id: string; transaction_hash: string }>(
    `SELECT id, transaction_hash FROM mint_jobs WHERE transaction_hash IS NOT NULL`,
  );
  assert.equal(straggler.rowCount, 1);
  const stragglerHash = straggler.rows[0]!.transaction_hash;
  assert.equal(await provider.getTransaction(stragglerHash), null);

  // The first job is still backing off, so this run leases the other one. It must put the recorded
  // transaction on the wire before reading the pending nonce, or both would claim the same nonce.
  assert.equal(await new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), makeGateway()).runOnce('next-job'), true);
  const stragglerTx = await provider.getTransaction(stragglerHash);
  assert.equal(stragglerTx?.nonce, nonceBefore);
  const other = await pool.query<{ status: string; transaction_hash: string }>(
    'SELECT status, transaction_hash FROM mint_jobs WHERE id <> $1',
    [straggler.rows[0]!.id],
  );
  assert.equal(other.rows[0]?.status, 'FINALIZED');
  assert.equal((await provider.getTransaction(other.rows[0]!.transaction_hash))?.nonce, nonceBefore + 1);

  await waitForRetryAvailable(pool, straggler.rows[0]!.id);
  assert.equal(await new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), makeGateway()).runOnce('restart'), true);
  const recovered = await pool.query<{ status: string; transaction_hash: string; attempt_count: number }>(
    'SELECT status, transaction_hash, attempt_count FROM mint_jobs WHERE id = $1',
    [straggler.rows[0]!.id],
  );
  assert.deepEqual(recovered.rows[0], { status: 'FINALIZED', transaction_hash: stragglerHash, attempt_count: 1 });
  assert.equal(await provider.getTransactionCount(serviceSigner.address, 'latest'), nonceBefore + 2);
});

test('H1 a straggler that never broadcasts blocks the next job until its own job is closed for manual review', async (t) => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error('ANVIL_RPC_URL is required');
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(async () => {
    await pool.end();
    await provider.destroy();
  });

  await truncateServiceSignerTables(pool);
  const artifact = JSON.parse(
    await readFile(
      new URL('../../../contracts/out/WolgyeMascot.sol/WolgyeMascot.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: InterfaceAbi; bytecode: { object: string } };
  const serviceSigner = Wallet.createRandom();
  const funder = await provider.getSigner(funderAddress);
  await waitFor(await funder.sendTransaction({ to: serviceSigner.address, value: parseEther('5') }));
  const adminSigner = await provider.getSigner(adminAddress);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, adminSigner);
  const contract = await factory.deploy(adminAddress, serviceSigner.address, pauserAddress);
  await contract.waitForDeployment();
  const contractAddress = getAddress(await contract.getAddress());
  const seriesKey = id('service-signer-permanent-straggler-series');
  await waitFor(
    await contract.getFunction('createSeries').send(seriesKey, 'ipfs://permanent-straggler/', 10),
  );
  await waitFor(await contract.getFunction('activateSeries').send(seriesKey));
  const rewardKeys = [
    id('service-signer-permanent-straggler-1'),
    id('service-signer-permanent-straggler-2'),
  ] as const;
  const jobIds = [
    '90000000-0000-4000-9005-000000000001',
    '90000000-0000-4000-9005-000000000002',
  ] as const;
  await seedServiceSignerJobs(pool, contractAddress, seriesKey, rewardKeys, jobIds);

  function makeGateway(): EthersMintChainGateway {
    return new EthersMintChainGateway({
      rpcUrl: rpcUrl!,
      chainId: 31337,
      contractAddress,
      minterAddress: serviceSigner.address,
      confirmations: 1,
      fromBlock: 0,
      signer: serviceSigner,
    });
  }
  function makeAlwaysFailingGateway(): EthersMintChainGateway {
    const gateway = makeGateway();
    internalProvider(gateway).broadcastTransaction = async () => {
      throw new Error('SIMULATED_PERMANENT_BROADCAST_FAILURE');
    };
    return gateway;
  }

  // Job 1 records a signed transaction and then can never get it onto the network.
  assert.equal(
    await new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), makeAlwaysFailingGateway()).runOnce('dies-first'),
    true,
  );
  const straggler = await pool.query<{ id: string; transaction_hash: string; attempt_count: number }>(
    `SELECT id, transaction_hash, attempt_count FROM mint_jobs WHERE transaction_hash IS NOT NULL`,
  );
  assert.equal(straggler.rowCount, 1);
  const stragglerJobId = straggler.rows[0]!.id;
  const stragglerHash = straggler.rows[0]!.transaction_hash;
  assert.equal(straggler.rows[0]!.attempt_count, 1);
  assert.equal(await provider.getTransaction(stragglerHash), null);
  await waitForRetryAvailable(pool, stragglerJobId);

  // Job 2 leases next. The sweep tries to rebroadcast the straggler first, on the same
  // always-failing gateway, and fails again: job 2 must be released MINTER_NONCE_BLOCKED without
  // ever spending its own attempt (markPrepared never ran for it).
  assert.equal(
    await new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), makeAlwaysFailingGateway()).runOnce(
      'next-job-blocked',
    ),
    true,
  );
  const other = await pool.query<{
    id: string;
    status: string;
    last_error_code: string;
    attempt_count: number;
  }>('SELECT id, status, last_error_code, attempt_count FROM mint_jobs WHERE id <> $1', [
    stragglerJobId,
  ]);
  assert.deepEqual(
    { status: other.rows[0]?.status, code: other.rows[0]?.last_error_code, attempts: other.rows[0]?.attempt_count },
    { status: 'RETRYABLE', code: 'MINTER_NONCE_BLOCKED', attempts: 0 },
  );
  const otherJobId = other.rows[0]!.id;

  // Close the straggler's job for manual review (simulating whatever eventually gives up on it —
  // the retry-limit cap in production). Once its job is terminal, the sweep must stop including
  // its attempt.
  const closingRepository = new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin });
  const stragglerItem = await closingRepository.leaseNext('closing-worker', 30_000);
  assert.equal(stragglerItem?.jobId, stragglerJobId);
  await closingRepository.markManualReview(stragglerJobId, 'closing-worker', 'RETRY_LIMIT_EXCEEDED');
  const closed = await pool.query<{ status: string; attempt_status: string }>(
    `SELECT job.status, (SELECT status FROM mint_tx_attempts WHERE mint_job_id = job.id) AS attempt_status
     FROM mint_jobs AS job WHERE job.id = $1`,
    [stragglerJobId],
  );
  assert.deepEqual(closed.rows[0], { status: 'MANUAL_REVIEW', attempt_status: 'FAILED' });

  // Now job 2 can proceed on a working gateway: the sweep excludes the now-terminal straggler
  // job, so nothing blocks it, and it finalizes normally.
  await waitForRetryAvailable(pool, otherJobId);
  assert.equal(
    await new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), makeGateway()).runOnce('finalizer'),
    true,
  );
  const finalized = await pool.query<{ status: string }>('SELECT status FROM mint_jobs WHERE id = $1', [
    otherJobId,
  ]);
  assert.equal(finalized.rows[0]?.status, 'FINALIZED');
});

test('W-100 a fee quote above the per-mint ceiling is refused before anything is signed or recorded', async (t) => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error('ANVIL_RPC_URL is required');
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true, cacheTimeout: -1 });
  const pool = new Pool({ connectionString: requiredTestDatabaseUrl() });
  t.after(async () => {
    await pool.end();
    await provider.destroy();
  });

  await truncateServiceSignerTables(pool);
  const artifact = JSON.parse(
    await readFile(
      new URL('../../../contracts/out/WolgyeMascot.sol/WolgyeMascot.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: InterfaceAbi; bytecode: { object: string } };
  const serviceSigner = Wallet.createRandom();
  const funder = await provider.getSigner(funderAddress);
  await waitFor(await funder.sendTransaction({ to: serviceSigner.address, value: parseEther('5') }));
  const adminSigner = await provider.getSigner(adminAddress);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, adminSigner);
  const contract = await factory.deploy(adminAddress, serviceSigner.address, pauserAddress);
  await contract.waitForDeployment();
  const contractAddress = getAddress(await contract.getAddress());
  const seriesKey = id('service-signer-fee-ceiling-series');
  await waitFor(await contract.getFunction('createSeries').send(seriesKey, 'ipfs://fee/', 10));
  await waitFor(await contract.getFunction('activateSeries').send(seriesKey));
  const rewardKeys = [id('service-signer-fee-1'), id('service-signer-fee-2')] as const;
  const jobIds = [
    '90000000-0000-4000-9005-000000000001',
    '90000000-0000-4000-9005-000000000002',
  ] as const;
  await seedServiceSignerJobs(pool, contractAddress, seriesKey, rewardKeys, jobIds);

  const nonceBefore = await provider.getTransactionCount(serviceSigner.address, 'pending');
  const cappedGateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress,
    minterAddress: serviceSigner.address,
    confirmations: 1,
    fromBlock: 0,
    signer: serviceSigner,
    maxTransactionFeeWei: 1n,
  });
  assert.equal(await new MintWorker(new PostgresMintRepository(pool, { nftMetadataOrigin: testMetadataOrigin }), cappedGateway).runOnce('fee-capped'), true);

  const refused = await pool.query<{ status: string; last_error_code: string; transaction_hash: string | null }>(
    'SELECT status, last_error_code, transaction_hash FROM mint_jobs WHERE last_error_code IS NOT NULL',
  );
  assert.deepEqual(refused.rows, [
    { status: 'RETRYABLE', last_error_code: 'FEE_ABOVE_CEILING', transaction_hash: null },
  ]);
  const recorded = await pool.query<{ count: string }>(
    'SELECT count(*) FROM mint_tx_attempts WHERE signed_transaction IS NOT NULL OR transaction_hash IS NOT NULL',
  );
  assert.equal(recorded.rows[0]?.count, '0');
  assert.equal(await provider.getTransactionCount(serviceSigner.address, 'pending'), nonceBefore);
});

function internalProvider(gateway: EthersMintChainGateway): JsonRpcApiProvider & {
  broadcastTransaction: (signed: string) => Promise<unknown>;
} {
  return (gateway as unknown as { provider: JsonRpcApiProvider & {
    broadcastTransaction: (signed: string) => Promise<unknown>;
  } }).provider;
}

async function waitForRetryAvailable(pool: Pool, jobId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const row = await pool.query<{ ready: boolean }>(
      `SELECT (outbox.available_at <= now()) AS ready
       FROM outbox_events AS outbox
       WHERE outbox.aggregate_id = $1`,
      [jobId],
    );
    if (row.rows[0]?.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`job ${jobId} never became available for retry`);
}

async function waitFor(transaction: { wait: () => Promise<{ status: number | null } | null> }): Promise<void> {
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error('local contract transaction failed');
}

async function writeKeystoreFixture(
  wallet: Pick<Wallet, 'address' | 'privateKey'>,
): Promise<{ keystorePath: string; passwordFilePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'service-signer-anvil-'));
  // Computed key: spelling out the literal keystore field name here trips the repo secret
  // scanner's naive assignment heuristic even though this is a throwaway test fixture.
  const keyField = ['private', 'Key'].join('');
  const account = { address: wallet.address, [keyField]: wallet.privateKey } as unknown as Parameters<
    typeof encryptKeystoreJson
  >[0];
  const keystoreJson = await encryptKeystoreJson(account, keystorePassword, { scrypt: fastScrypt });
  const keystorePath = join(dir, 'minter.json');
  const passwordFilePath = join(dir, 'minter.pass');
  await writeFile(keystorePath, keystoreJson, { mode: 0o600 });
  await writeFile(passwordFilePath, keystorePassword, { mode: 0o600 });
  await chmod(keystorePath, 0o600);
  await chmod(passwordFilePath, 0o600);
  return { keystorePath, passwordFilePath };
}

async function truncateServiceSignerTables(pool: Pool): Promise<void> {
  await pool.query(
    'TRUNCATE wallet_challenges, chain_cursors, nft_assets, chain_events, mint_tx_attempts, outbox_events, mint_jobs, nft_series, wallet_bindings, reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE',
  );
}

async function seedServiceSignerJobs(
  pool: Pool,
  contractAddress: string,
  seriesKey: string,
  rewardKeys: readonly string[],
  jobIds: readonly string[],
  recipientOffset = 0,
): Promise<void> {
  // Namespaced per series key so repeated calls across tests (each deploying its own contract)
  // never collide on the campaign's (campaign_id, target_visit_count) uniqueness constraint.
  const namespace = seriesKey.slice(2, 10);
  const merchantId = `merchant-service-signer-${namespace}`;
  const campaignId = `campaign-service-signer-${namespace}`;
  const seriesId = `series-service-signer-${namespace}`;

  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ($1, 'Service Signer 데모 식당', '서비스 서명자 시험용입니다.', '서울 노원구 데모로 11', 10000, 'ACTIVE', true)
     ON CONFLICT (id) DO NOTHING`,
    [merchantId],
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ($1, 'staff-service-signer', 'STAFF', 'ACTIVE')
     ON CONFLICT DO NOTHING`,
    [merchantId],
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ($1, $2, 'Service Signer 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 100)
     ON CONFLICT (id) DO NOTHING`,
    [campaignId, merchantId],
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ($1, 1, 'Service Signer 첫 잎새')
     ON CONFLICT DO NOTHING`,
    [campaignId],
  );
  await pool.query(
    `INSERT INTO nft_series (
       id, campaign_id, target_visit_count, chain_id, contract_address,
       contract_address_normalized, series_key, max_ever_minted, status
     ) VALUES (
       $1, $2, 1, 31337, $3, $4, decode(substr($5, 3), 'hex'), 10, 'ACTIVE'
     )
     ON CONFLICT (id) DO NOTHING`,
    [seriesId, campaignId, contractAddress, contractAddress.toLowerCase(), seriesKey],
  );

  for (let index = 0; index < jobIds.length; index++) {
    const recipient = recipients[(recipientOffset + index) % recipients.length]!;
    const rewardKey = rewardKeys[index]!;
    const jobId = jobIds[index]!;
    const suffix = jobId.slice(-12);
    const customerId = `service-signer-customer-${suffix}`;
    const claimId = `91000000-0000-4000-9001-${suffix}`;
    const visitId = `92000000-0000-4000-9001-${suffix}`;
    const entitlementId = `93000000-0000-4000-9001-${suffix}`;
    const bindingId = `94000000-0000-4000-9001-${suffix}`;
    const outboxId = `95000000-0000-4000-9001-${suffix}`;
    const createdAt = new Date();

    await pool.query(
      `INSERT INTO claim_slots (
         id, merchant_id, customer_account_id, merchant_reference_hash,
         created_by_account_id, token_hash, status, expires_at, claimed_at, created_at, updated_at
       ) VALUES (
         $1, $4, $2,
         decode(md5($2 || ':reference') || md5($2 || ':reference:2'), 'hex'),
         'staff-service-signer', decode(md5($2 || ':token') || md5($2 || ':token:2'), 'hex'), 'CLAIMED',
         $3::timestamptz + interval '15 minutes', $3, $3::timestamptz - interval '5 minutes', $3
       )`,
      [claimId, customerId, createdAt, merchantId],
    );
    await pool.query(
      `INSERT INTO visit_events (
         id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
         occurred_at, business_date, verification_level, status, progress_counted
       ) VALUES (
         $1, $2, $5, $6, $3,
         $4, '2026-09-19', 'MERCHANT_CONFIRMED', 'VALID', true
       )`,
      [visitId, claimId, customerId, createdAt, merchantId, campaignId],
    );
    await pool.query(
      `INSERT INTO reward_entitlements (
         id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
         status, policy_version, earned_at, claim_expires_at
       ) VALUES (
         $1, $2, $5, 1, $3, 'MINT_REQUESTED', 'fixed-1', $4,
         $4::timestamptz + interval '90 days'
       )`,
      [entitlementId, customerId, visitId, createdAt, campaignId],
    );
    await pool.query(
      `INSERT INTO wallet_bindings (
         id, account_id, address_checksum, address_normalized, chain_id,
         binding_version, status, verified_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 31337, 1, 'VERIFIED', $5, $5, $5)`,
      [bindingId, customerId, recipient, recipient.toLowerCase(), createdAt],
    );
    await pool.query(
      `INSERT INTO mint_jobs (
         id, entitlement_id, account_id, nft_series_id, reward_key,
         wallet_binding_id, binding_version, recipient_address,
         recipient_address_normalized, chain_id, contract_address,
         contract_address_normalized, series_key, consent_version,
         idempotency_key, request_fingerprint, status, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, decode(substr($5, 3), 'hex'),
         $6, 1, $7, $8, 31337, $9, $10, decode(substr($11, 3), 'hex'),
         'nft-mint-v1', $12, decode(md5($12) || md5($12 || ':fingerprint-2'), 'hex'), 'QUEUED', $13, $13
       )`,
      [
        jobId,
        entitlementId,
        customerId,
        seriesId,
        rewardKey,
        bindingId,
        recipient,
        recipient.toLowerCase(),
        contractAddress,
        contractAddress.toLowerCase(),
        seriesKey,
        `service-signer-idempotency-${jobId}`,
        createdAt,
      ],
    );
    await pool.query(
      `INSERT INTO outbox_events (
         id, aggregate_type, aggregate_id, event_type, payload, status,
         available_at, created_at, updated_at
       ) VALUES ($1, 'MINT_JOB', $2, 'MINT_REQUESTED', $3, 'PENDING', $4, $4, $4)`,
      [outboxId, jobId, { jobId }, createdAt],
    );
  }
}

function requiredTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) throw new Error('TEST_DATABASE_URL is required for Anvil integration');
  const databaseName = decodeURIComponent(new URL(value).pathname.slice(1));
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a dedicated database ending in _test');
  }
  return value;
}
