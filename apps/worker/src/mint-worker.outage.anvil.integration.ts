import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  getAddress,
  id,
  type InterfaceAbi,
} from 'ethers';
import { Pool } from 'pg';

import { EthersMintChainGateway } from './ethers-chain-gateway.js';
import { MintWorker } from './mint-worker.js';
import { PostgresMintRepository } from './postgres-mint-repository.js';

// Anvil's default dev accounts (index 0 = admin, 1 = minter, 2 = pauser, 3 = recipient), matching
// the fixtures already used by mint-worker.anvil.integration.ts.
const adminAddress = getAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
const minterAddress = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
const pauserAddress = getAddress('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
const recipient = getAddress('0x90F79bf6EB2c4f870365E785982E1f101E93b906');

const RETRY_DELAY_MS = 1_100;

test('O02a recovers a job once an unreachable RPC endpoint comes back', async (t) => {
  const rpcUrl = requiredAnvilRpcUrl();
  const databaseUrl = requiredTestDatabaseUrl();
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    await pool.end();
    await provider.destroy();
  });

  const { contractAddress } = await deployMascot(provider);
  const rewardKey = id('worker-outage-a-reward');
  const seriesKey = id('worker-outage-a-series');
  await recreateSeries(provider, contractAddress, seriesKey);
  const { jobId, entitlementId, outboxId } = await seedOutageJob(pool, {
    suffix: 'a',
    contractAddress,
    seriesKey,
    rewardKey,
    recipient,
  });

  const unreachableGateway = new EthersMintChainGateway({
    rpcUrl: 'http://127.0.0.1:1',
    chainId: 31337,
    contractAddress,
    minterAddress,
    confirmations: 1,
    fromBlock: 0,
  });
  const repository = new PostgresMintRepository(pool);
  const outageWorker = new MintWorker(repository, unreachableGateway);

  assert.equal(await outageWorker.runOnce('outage-worker-a'), true);
  const afterOutage = await readJobState(pool, jobId);
  assert.equal(afterOutage.status, 'RETRYABLE');
  assert.equal(afterOutage.last_error_code, 'RPC_UNAVAILABLE');
  assert.equal(afterOutage.attempt_count, 0);
  assert.equal(await readEntitlementStatus(pool, entitlementId), 'MINT_REQUESTED');
  assert.equal(await readOutboxStatus(pool, outboxId), 'PENDING');

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

  const recoveredGateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress,
    minterAddress,
    confirmations: 1,
    fromBlock: 0,
  });
  const recoveredWorker = new MintWorker(new PostgresMintRepository(pool), recoveredGateway);
  assert.equal(await recoveredWorker.runOnce('outage-worker-a-recovered'), true);

  const finalState = await readJobState(pool, jobId);
  assert.equal(finalState.status, 'FINALIZED');
  await assertMinted(provider, contractAddress, rewardKey, jobId, pool);
});

test('O02b recovers a job once minting is unpaused', async (t) => {
  const rpcUrl = requiredAnvilRpcUrl();
  const databaseUrl = requiredTestDatabaseUrl();
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    await pool.end();
    await provider.destroy();
  });

  const { contract, contractAddress } = await deployMascot(provider);
  const rewardKey = id('worker-outage-b-reward');
  const seriesKey = id('worker-outage-b-series');
  await recreateSeries(provider, contractAddress, seriesKey);
  const { jobId } = await seedOutageJob(pool, {
    suffix: 'b',
    contractAddress,
    seriesKey,
    rewardKey,
    recipient,
  });

  const pauserSigner = await provider.getSigner(pauserAddress);
  const pausable = contract.connect(pauserSigner) as Contract;
  await waitFor(await pausable.getFunction('pause').send());

  const gateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress,
    minterAddress,
    confirmations: 1,
    fromBlock: 0,
  });
  const worker = new MintWorker(new PostgresMintRepository(pool), gateway);

  assert.equal(await worker.runOnce('outage-worker-b'), true);
  const pausedState = await readJobState(pool, jobId);
  assert.equal(pausedState.status, 'RETRYABLE');
  assert.equal(pausedState.last_error_code, 'MINT_PAUSED');
  assert.equal(pausedState.attempt_count, 0);
  assert.equal(await countMintTxAttempts(pool, jobId), 0);

  const adminSigner = await provider.getSigner(adminAddress);
  const adminControlled = contract.connect(adminSigner) as Contract;
  await waitFor(await adminControlled.getFunction('unpause').send());

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

  assert.equal(await worker.runOnce('outage-worker-b-recovered'), true);
  const finalState = await readJobState(pool, jobId);
  assert.equal(finalState.status, 'FINALIZED');
  await assertMinted(provider, contractAddress, rewardKey, jobId, pool);
});

test('O02c recovers a job once the minter balance is restored', async (t) => {
  const rpcUrl = requiredAnvilRpcUrl();
  const databaseUrl = requiredTestDatabaseUrl();
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  const pool = new Pool({ connectionString: databaseUrl });
  const originalBalance = await provider.getBalance(minterAddress);
  t.after(async () => {
    await provider.send('anvil_setBalance', [minterAddress, `0x${originalBalance.toString(16)}`]);
    await pool.end();
    await provider.destroy();
  });

  const { contractAddress } = await deployMascot(provider);
  const rewardKey = id('worker-outage-c-reward');
  const seriesKey = id('worker-outage-c-series');
  await recreateSeries(provider, contractAddress, seriesKey);
  const { jobId } = await seedOutageJob(pool, {
    suffix: 'c',
    contractAddress,
    seriesKey,
    rewardKey,
    recipient,
  });

  await provider.send('anvil_setBalance', [minterAddress, '0x0']);

  const gateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress,
    minterAddress,
    confirmations: 1,
    fromBlock: 0,
  });
  const worker = new MintWorker(new PostgresMintRepository(pool), gateway);

  assert.equal(await worker.runOnce('outage-worker-c'), true);
  const drainedState = await readJobState(pool, jobId);
  assert.equal(drainedState.status, 'RETRYABLE');
  assert.equal(drainedState.last_error_code, 'MINTER_BALANCE_LOW');
  assert.equal(drainedState.attempt_count, 0);

  await provider.send('anvil_setBalance', [minterAddress, `0x${originalBalance.toString(16)}`]);
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));

  assert.equal(await worker.runOnce('outage-worker-c-recovered'), true);
  const finalState = await readJobState(pool, jobId);
  assert.equal(finalState.status, 'FINALIZED');
  await assertMinted(provider, contractAddress, rewardKey, jobId, pool);
});

async function deployMascot(
  provider: JsonRpcProvider,
): Promise<{ contract: Contract; contractAddress: string }> {
  const artifact = JSON.parse(
    await readFile(
      new URL('../../../contracts/out/WolgyeMascot.sol/WolgyeMascot.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: InterfaceAbi; bytecode: { object: string } };
  const adminSigner = await provider.getSigner(adminAddress);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, adminSigner);
  const contract = (await factory.deploy(adminAddress, minterAddress, pauserAddress)) as Contract;
  await contract.waitForDeployment();
  const contractAddress = getAddress(await contract.getAddress());
  return { contract, contractAddress };
}

async function recreateSeries(
  provider: JsonRpcProvider,
  contractAddress: string,
  seriesKey: string,
): Promise<void> {
  const adminSigner = await provider.getSigner(adminAddress);
  const contract = new Contract(
    contractAddress,
    [
      'function createSeries(bytes32 seriesId,string baseTokenURI,uint64 maxEverMinted)',
      'function activateSeries(bytes32 seriesId)',
    ],
    adminSigner,
  );
  await waitFor(
    await contract.getFunction('createSeries').send(seriesKey, 'ipfs://worker-outage/', 1),
  );
  await waitFor(await contract.getFunction('activateSeries').send(seriesKey));
}

async function seedOutageJob(
  pool: Pool,
  options: {
    suffix: string;
    contractAddress: string;
    seriesKey: string;
    rewardKey: string;
    recipient: string;
  },
): Promise<{ jobId: string; entitlementId: string; outboxId: string }> {
  await pool.query(
    'TRUNCATE wallet_challenges, chain_cursors, nft_assets, chain_events, mint_tx_attempts, outbox_events, mint_jobs, nft_series, wallet_bindings, reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE',
  );
  const createdAt = new Date();
  const merchantId = `merchant-outage-${options.suffix}`;
  const campaignId = `campaign-outage-${options.suffix}`;
  const customerId = `worker-outage-customer-${options.suffix}`;
  const claimId = `00000000-0000-4000-9002-${options.suffix.padStart(12, '0')}`;
  const visitId = `10000000-0000-4000-9002-${options.suffix.padStart(12, '0')}`;
  const entitlementId = `20000000-0000-4000-9002-${options.suffix.padStart(12, '0')}`;
  const bindingId = `30000000-0000-4000-9002-${options.suffix.padStart(12, '0')}`;
  const jobId = `40000000-0000-4000-9002-${options.suffix.padStart(12, '0')}`;
  const outboxId = `50000000-0000-4000-9002-${options.suffix.padStart(12, '0')}`;

  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ($1, 'Anvil 장애 복구 식당', '워커 장애 복구 시험용입니다.', '서울 노원구 데모로 20', 10000, 'ACTIVE', true)`,
    [merchantId],
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ($1, $2, 'STAFF', 'ACTIVE')`,
    [merchantId, `staff-outage-${options.suffix}`],
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ($1, $2, 'Anvil 장애 복구 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 10)`,
    [campaignId, merchantId],
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ($1, 1, 'Anvil 장애 복구 첫 잎새')`,
    [campaignId],
  );
  await pool.query(
    `INSERT INTO nft_series (
       id, campaign_id, target_visit_count, chain_id, contract_address,
       contract_address_normalized, series_key, max_ever_minted, status
     ) VALUES (
       $1, $2, 1, 31337, $3, $4,
       decode(substr($5, 3), 'hex'), 1, 'ACTIVE'
     )`,
    [
      `series-outage-${options.suffix}`,
      campaignId,
      options.contractAddress,
      options.contractAddress.toLowerCase(),
      options.seriesKey,
    ],
  );
  await pool.query(
    `INSERT INTO claim_slots (
       id, merchant_id, customer_account_id, merchant_reference_hash,
       created_by_account_id, token_hash, status, expires_at, claimed_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3,
       decode(md5($3 || ':reference') || md5($3 || ':reference:2'), 'hex'),
       $4, decode(md5($3 || ':token') || md5($3 || ':token:2'), 'hex'), 'CLAIMED',
       $5::timestamptz + interval '15 minutes', $5, $5::timestamptz - interval '5 minutes', $5
     )`,
    [claimId, merchantId, customerId, `staff-outage-${options.suffix}`, createdAt],
  );
  await pool.query(
    `INSERT INTO visit_events (
       id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
       occurred_at, business_date, verification_level, status, progress_counted
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, '2026-09-19', 'MERCHANT_CONFIRMED', 'VALID', true
     )`,
    [visitId, claimId, merchantId, campaignId, customerId, createdAt],
  );
  await pool.query(
    `INSERT INTO reward_entitlements (
       id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
       status, policy_version, earned_at, claim_expires_at
     ) VALUES (
       $1, $2, $3, 1, $4, 'MINT_REQUESTED', 'fixed-1', $5,
       $5::timestamptz + interval '90 days'
     )`,
    [entitlementId, customerId, campaignId, visitId, createdAt],
  );
  await pool.query(
    `INSERT INTO wallet_bindings (
       id, account_id, address_checksum, address_normalized, chain_id,
       binding_version, status, verified_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 31337, 1, 'VERIFIED', $5, $5, $5)`,
    [bindingId, customerId, options.recipient, options.recipient.toLowerCase(), createdAt],
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
       'nft-mint-v1', $12, decode(repeat('66', 32), 'hex'), 'QUEUED', $13, $13
     )`,
    [
      jobId,
      entitlementId,
      customerId,
      `series-outage-${options.suffix}`,
      options.rewardKey,
      bindingId,
      options.recipient,
      options.recipient.toLowerCase(),
      options.contractAddress,
      options.contractAddress.toLowerCase(),
      options.seriesKey,
      `anvil-outage-idempotency-${options.suffix}`,
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

  return { jobId, entitlementId, outboxId };
}

async function readJobState(
  pool: Pool,
  jobId: string,
): Promise<{ status: string; last_error_code: string | null; attempt_count: number }> {
  const row = (
    await pool.query<{ status: string; last_error_code: string | null; attempt_count: number }>(
      'SELECT status, last_error_code, attempt_count FROM mint_jobs WHERE id = $1',
      [jobId],
    )
  ).rows[0];
  if (!row) throw new Error(`mint job ${jobId} not found`);
  return row;
}

async function readEntitlementStatus(pool: Pool, entitlementId: string): Promise<string> {
  const row = (
    await pool.query<{ status: string }>(
      'SELECT status FROM reward_entitlements WHERE id = $1',
      [entitlementId],
    )
  ).rows[0];
  if (!row) throw new Error(`entitlement ${entitlementId} not found`);
  return row.status;
}

async function readOutboxStatus(pool: Pool, outboxId: string): Promise<string> {
  const row = (
    await pool.query<{ status: string }>('SELECT status FROM outbox_events WHERE id = $1', [
      outboxId,
    ])
  ).rows[0];
  if (!row) throw new Error(`outbox event ${outboxId} not found`);
  return row.status;
}

async function countMintTxAttempts(pool: Pool, jobId: string): Promise<number> {
  const row = (
    await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM mint_tx_attempts WHERE mint_job_id = $1',
      [jobId],
    )
  ).rows[0];
  return row?.count ?? 0;
}

async function countNftAssets(pool: Pool, jobId: string): Promise<number> {
  const row = (
    await pool.query<{ count: number }>(
      'SELECT count(*)::integer AS count FROM nft_assets WHERE mint_job_id = $1',
      [jobId],
    )
  ).rows[0];
  return row?.count ?? 0;
}

async function assertMinted(
  provider: JsonRpcProvider,
  contractAddress: string,
  rewardKey: string,
  jobId: string,
  pool: Pool,
): Promise<void> {
  const contract = new Contract(
    contractAddress,
    ['function tokenByRewardKey(bytes32 rewardKey) view returns (uint256)'],
    provider,
  );
  const tokenId = (await contract.getFunction('tokenByRewardKey').staticCall(rewardKey)) as bigint;
  assert.notEqual(tokenId, 0n);
  assert.equal(await countNftAssets(pool, jobId), 1);
}

async function waitFor(transaction: { wait: () => Promise<{ status: number | null } | null> }): Promise<void> {
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error('local contract transaction failed');
}

function requiredAnvilRpcUrl(): string {
  const value = process.env.ANVIL_RPC_URL;
  if (!value) throw new Error('ANVIL_RPC_URL is required');
  return value;
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
