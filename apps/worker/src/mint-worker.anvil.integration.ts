import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  getAddress,
  id,
  type ContractTransactionResponse,
  type InterfaceAbi,
} from 'ethers';
import { Pool } from 'pg';

import { EthersMintChainGateway } from './ethers-chain-gateway.js';
import {
  ChainConfigurationError,
  MintEventMismatchError,
  MintWorker,
  RetryableChainError,
  type MintWorkItem,
} from './mint-worker.js';
import { PostgresMintRepository } from './postgres-mint-repository.js';

const adminAddress = getAddress('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
const minterAddress = getAddress('0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
const pauserAddress = getAddress('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
const recipients = [
  getAddress('0x90F79bf6EB2c4f870365E785982E1f101E93b906'),
  getAddress('0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'),
  getAddress('0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'),
] as const;

test('W07 M01-M08 finalize once and reject an unconfirmed reorg event on Anvil', async (t) => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error('ANVIL_RPC_URL is required');
  const databaseUrl = requiredTestDatabaseUrl();
  const provider = new JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(async () => {
    await pool.end();
    await provider.destroy();
  });

  const artifact = JSON.parse(
    await readFile(
      new URL('../../../contracts/out/WolgyeMascot.sol/WolgyeMascot.json', import.meta.url),
      'utf8',
    ),
  ) as { abi: InterfaceAbi; bytecode: { object: string } };
  const adminSigner = await provider.getSigner(adminAddress);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, adminSigner);
  const contract = await factory.deploy(adminAddress, minterAddress, pauserAddress);
  await contract.waitForDeployment();
  const contractAddress = getAddress(await contract.getAddress());
  const seriesKey = id('worker-anvil-series');
  await waitFor(await contract.getFunction('createSeries').send(seriesKey, 'ipfs://worker/', 4));
  await waitFor(await contract.getFunction('activateSeries').send(seriesKey));

  const rewardKeys = [id('worker-reward-1'), id('worker-reward-2'), id('worker-reward-3')];
  await seedAnvilJobs(pool, contractAddress, seriesKey, rewardKeys);
  await pool.query(
    `UPDATE wallet_bindings
     SET status = 'DISCONNECTED', disconnected_at = now(), updated_at = now()
     WHERE account_id = 'worker-customer-1'`,
  );

  const gateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress,
    minterAddress,
    confirmations: 1,
    fromBlock: 0,
  });
  const validationItem: MintWorkItem = {
    jobId: 'validation-job',
    outboxId: 'validation-outbox',
    accountId: 'validation-account',
    entitlementId: 'validation-entitlement',
    rewardKey: rewardKeys[0]!,
    recipient: recipients[0],
    chainId: 31337,
    contractAddress,
    seriesKey,
  };
  const wrongChainGateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 84532,
    contractAddress,
    minterAddress,
    confirmations: 1,
    fromBlock: 0,
  });
  await assert.rejects(
    wrongChainGateway.validate({ ...validationItem, chainId: 84532 }),
    (error: unknown) =>
      error instanceof ChainConfigurationError && error.code === 'RPC_CHAIN_MISMATCH',
  );
  const missingContractGateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress: recipients[0],
    minterAddress,
    confirmations: 1,
    fromBlock: 0,
  });
  await assert.rejects(
    missingContractGateway.validate({ ...validationItem, contractAddress: recipients[0] }),
    (error: unknown) =>
      error instanceof ChainConfigurationError && error.code === 'CONTRACT_CODE_MISSING',
  );
  const wrongMinterGateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress,
    minterAddress: adminAddress,
    confirmations: 1,
    fromBlock: 0,
  });
  await assert.rejects(
    wrongMinterGateway.validate(validationItem),
    (error: unknown) =>
      error instanceof ChainConfigurationError && error.code === 'MINTER_ROLE_MISSING',
  );
  const repositoryA = new PostgresMintRepository(pool);
  const workerA = new MintWorker(repositoryA, gateway);

  assert.equal(await workerA.runOnce('anvil-worker-a'), true);
  assert.equal(
    getAddress(await contract.getFunction('ownerOf').staticCall(1n)),
    recipients[0],
  );

  const minterSigner = await provider.getSigner(minterAddress);
  const minterContract = contract.connect(minterSigner) as Contract;
  const externallySubmitted = await minterContract
    .getFunction('mintWithRewardKey')
    .send(recipients[1], seriesKey, rewardKeys[1]);
  const externallySubmittedReceipt = await externallySubmitted.wait();
  assert.equal(externallySubmittedReceipt?.status, 1);
  assert.ok(externallySubmittedReceipt);
  const fallbackGateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress,
    minterAddress,
    confirmations: 1,
    fromBlock: externallySubmittedReceipt.blockNumber + 1,
    fallbackFromBlock: 0,
  });
  const recoveredFromFallback = await fallbackGateway.findMintByRewardKey({
    ...validationItem,
    rewardKey: rewardKeys[1]!,
    recipient: recipients[1],
  });
  assert.equal(recoveredFromFallback?.transactionHash, externallySubmitted.hash.toLowerCase());
  await assert.rejects(
    gateway.confirmMint(
      {
        ...validationItem,
        rewardKey: rewardKeys[1]!,
        recipient: recipients[2],
      },
      externallySubmitted.hash,
    ),
    (error: unknown) =>
      error instanceof MintEventMismatchError && error.code === 'MINT_EVENT_MISMATCH',
  );
  assert.equal(await workerA.runOnce('anvil-worker-a'), true);
  assert.equal(
    getAddress(await contract.getFunction('ownerOf').staticCall(2n)),
    recipients[1],
  );

  const repositoryB = new PostgresMintRepository(pool);
  const workerB = new MintWorker(repositoryB, gateway);
  const leaseRace = await Promise.all([
    workerA.runOnce('anvil-worker-a'),
    workerB.runOnce('anvil-worker-b'),
  ]);
  assert.deepEqual([...leaseRace].sort(), [false, true]);
  assert.equal(
    getAddress(await contract.getFunction('ownerOf').staticCall(3n)),
    recipients[2],
  );
  await recoverRetryableJob(
    pool,
    workerA,
    '40000000-0000-4000-8001-000000000003',
  );

  for (let index = 0; index < rewardKeys.length; index++) {
    assert.equal(
      String(await contract.getFunction('tokenByRewardKey').staticCall(rewardKeys[index])),
      String(index + 1),
    );
    assert.equal(await contract.getFunction('locked').staticCall(BigInt(index + 1)), true);
  }

  const reorgRewardKey = id('worker-reward-reorg');
  const snapshotId = (await provider.send('evm_snapshot', [])) as string;
  await waitFor(
    await minterContract
      .getFunction('mintWithRewardKey')
      .send(recipients[0], seriesKey, reorgRewardKey),
  );
  const finalityGateway = new EthersMintChainGateway({
    rpcUrl,
    chainId: 31337,
    contractAddress,
    minterAddress,
    confirmations: 2,
    fromBlock: 0,
  });
  await assert.rejects(
    finalityGateway.findMintByRewardKey({
      ...validationItem,
      rewardKey: reorgRewardKey,
    }),
    (error: unknown) =>
      error instanceof RetryableChainError && error.code === 'MINT_EVENT_NOT_FINALIZED',
  );
  assert.equal(await provider.send('evm_revert', [snapshotId]), true);
  assert.equal(
    await finalityGateway.findMintByRewardKey({
      ...validationItem,
      rewardKey: reorgRewardKey,
    }),
    undefined,
  );
  assert.equal(await workerA.runOnce('anvil-worker-a'), false);

  const counts = await pool.query<{
    finalized_jobs: number;
    fulfilled_entitlements: number;
    published_outbox: number;
    assets: number;
    events: number;
    attempts: number;
  }>(
    `SELECT
       (SELECT count(*)::integer FROM mint_jobs WHERE status = 'FINALIZED') AS finalized_jobs,
       (SELECT count(*)::integer FROM reward_entitlements WHERE status = 'FULFILLED') AS fulfilled_entitlements,
       (SELECT count(*)::integer FROM outbox_events WHERE status = 'PUBLISHED') AS published_outbox,
       (SELECT count(*)::integer FROM nft_assets) AS assets,
       (SELECT count(*)::integer FROM chain_events) AS events,
       (SELECT count(*)::integer FROM mint_tx_attempts) AS attempts`,
  );
  assert.deepEqual(counts.rows[0], {
    finalized_jobs: 3,
    fulfilled_entitlements: 3,
    published_outbox: 3,
    assets: 3,
    events: 3,
    attempts: 2,
  });
});

async function seedAnvilJobs(
  pool: Pool,
  contractAddress: string,
  seriesKey: string,
  rewardKeys: readonly string[],
): Promise<void> {
  await pool.query(
    'TRUNCATE chain_cursors, nft_assets, chain_events, mint_tx_attempts, outbox_events, mint_jobs, nft_series, wallet_bindings, reward_entitlements, visit_events, claim_slots, merchant_members, campaign_goals, campaigns, merchants CASCADE',
  );
  await pool.query(
    `INSERT INTO merchants
       (id, name, story, road_address, minimum_spend_won, status, is_demo)
     VALUES ('merchant-anvil', 'Anvil 데모 식당', '로컬 체인 시험용입니다.', '서울 노원구 데모로 10', 10000, 'ACTIVE', true)`,
  );
  await pool.query(
    `INSERT INTO merchant_members (merchant_id, account_id, role, status)
     VALUES ('merchant-anvil', 'staff-anvil', 'STAFF', 'ACTIVE')`,
  );
  await pool.query(
    `INSERT INTO campaigns
       (id, merchant_id, title, starts_at, ends_at, status, is_public, enrollment_capacity)
     VALUES ('campaign-anvil', 'merchant-anvil', 'Anvil 도감', '2026-09-01T00:00:00Z', '2026-10-31T23:59:59Z', 'ACTIVE', true, 10)`,
  );
  await pool.query(
    `INSERT INTO campaign_goals (campaign_id, target_visit_count, display_name)
     VALUES ('campaign-anvil', 1, 'Anvil 첫 잎새')`,
  );
  await pool.query(
    `INSERT INTO nft_series (
       id, campaign_id, target_visit_count, chain_id, contract_address,
       contract_address_normalized, series_key, max_ever_minted, status
     ) VALUES (
       'series-anvil', 'campaign-anvil', 1, 31337, $1, $2,
       decode(substr($3, 3), 'hex'), 3, 'ACTIVE'
     )`,
    [contractAddress, contractAddress.toLowerCase(), seriesKey],
  );

  for (let index = 0; index < recipients.length; index++) {
    const recipient = recipients[index]!;
    const rewardKey = rewardKeys[index]!;
    const suffix = String(index + 1).padStart(12, '0');
    const customerId = `worker-customer-${index + 1}`;
    const claimId = `00000000-0000-4000-8001-${suffix}`;
    const visitId = `10000000-0000-4000-8001-${suffix}`;
    const entitlementId = `20000000-0000-4000-8001-${suffix}`;
    const bindingId = `30000000-0000-4000-8001-${suffix}`;
    const jobId = `40000000-0000-4000-8001-${suffix}`;
    const outboxId = `50000000-0000-4000-8001-${suffix}`;
    const createdAt = new Date(Date.UTC(2026, 8, 19, 3, index));

    await pool.query(
      `INSERT INTO claim_slots (
         id, merchant_id, customer_account_id, merchant_reference_hash,
         created_by_account_id, token_hash, status, expires_at, claimed_at, created_at, updated_at
       ) VALUES (
         $1, 'merchant-anvil', $2,
         decode(md5($2 || ':reference') || md5($2 || ':reference:2'), 'hex'),
         'staff-anvil', decode(md5($2 || ':token') || md5($2 || ':token:2'), 'hex'), 'CLAIMED',
         $3::timestamptz + interval '15 minutes', $3, $3::timestamptz - interval '5 minutes', $3
       )`,
      [claimId, customerId, createdAt],
    );
    await pool.query(
      `INSERT INTO visit_events (
         id, claim_slot_id, merchant_id, campaign_id, customer_account_id,
         occurred_at, business_date, verification_level, status, progress_counted
       ) VALUES (
         $1, $2, 'merchant-anvil', 'campaign-anvil', $3,
         $4, '2026-09-19', 'MERCHANT_CONFIRMED', 'VALID', true
       )`,
      [visitId, claimId, customerId, createdAt],
    );
    await pool.query(
      `INSERT INTO reward_entitlements (
         id, customer_account_id, campaign_id, target_visit_count, source_visit_event_id,
         status, policy_version, earned_at, claim_expires_at
       ) VALUES (
         $1, $2, 'campaign-anvil', 1, $3, 'MINT_REQUESTED', 'fixed-1', $4,
         $4::timestamptz + interval '90 days'
       )`,
      [entitlementId, customerId, visitId, createdAt],
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
         $1, $2, $3, 'series-anvil', decode(substr($4, 3), 'hex'),
         $5, 1, $6, $7, 31337, $8, $9, decode(substr($10, 3), 'hex'),
         'nft-mint-v1', $11, decode(repeat('55', 32), 'hex'), 'QUEUED', $12, $12
       )`,
      [
        jobId,
        entitlementId,
        customerId,
        rewardKey,
        bindingId,
        recipient,
        recipient.toLowerCase(),
        contractAddress,
        contractAddress.toLowerCase(),
        seriesKey,
        `anvil-idempotency-${index + 1}`,
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

async function waitFor(transaction: ContractTransactionResponse): Promise<void> {
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error('local contract transaction failed');
}

async function recoverRetryableJob(
  pool: Pool,
  worker: MintWorker,
  jobId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const state = (
      await pool.query<{ status: string; last_error_code: string | null }>(
        `SELECT status, last_error_code
         FROM mint_jobs
         WHERE id = $1`,
        [jobId],
      )
    ).rows[0];
    if (state?.status === 'FINALIZED') return;
    assert.equal(state?.status, 'RETRYABLE');
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await worker.runOnce(`anvil-recovery-${attempt + 1}`);
  }
  const remaining = (
    await pool.query<{ status: string; last_error_code: string | null }>(
      `SELECT status, last_error_code
       FROM mint_jobs
       WHERE id = $1`,
      [jobId],
    )
  ).rows[0];
  assert.fail(
    `mint job did not recover: ${remaining?.status ?? 'missing'}:${remaining?.last_error_code ?? 'none'}`,
  );
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
