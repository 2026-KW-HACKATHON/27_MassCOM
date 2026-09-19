import { pathToFileURL } from 'node:url';

import { Pool } from 'pg';

import { EthersMintChainGateway } from './ethers-chain-gateway.js';
import { MintWorker } from './mint-worker.js';
import { PostgresMintRepository } from './postgres-mint-repository.js';

export async function runConfiguredWorker(environment = process.env): Promise<boolean> {
  const databaseUrl = required(environment.DATABASE_URL, 'DATABASE_URL');
  const rpcUrl = required(environment.CHAIN_RPC_URL, 'CHAIN_RPC_URL');
  const chainId = requiredInteger(environment.CHAIN_ID, 'CHAIN_ID');
  const contractAddress = required(environment.NFT_CONTRACT_ADDRESS, 'NFT_CONTRACT_ADDRESS');
  const minterAddress = required(environment.MINTER_ADDRESS, 'MINTER_ADDRESS');
  const workerId = environment.WORKER_ID?.trim() || 'local-mint-worker';
  const confirmations = requiredInteger(
    environment.CHAIN_CONFIRMATIONS ?? '1',
    'CHAIN_CONFIRMATIONS',
  );
  const chainFromBlock = requiredNonNegativeInteger(
    environment.CHAIN_FROM_BLOCK ?? '0',
    'CHAIN_FROM_BLOCK',
  );
  const reorgMargin = requiredInteger(
    environment.CHAIN_REORG_MARGIN ?? '12',
    'CHAIN_REORG_MARGIN',
  );
  if (chainId !== 31337 || environment.ALLOW_UNLOCKED_LOCAL_MINTER !== 'true') {
    throw new Error('unlocked RPC worker is restricted to explicit local Anvil configuration');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repository = new PostgresMintRepository(pool, { chainFromBlock, reorgMargin });
    const scanFromBlock = await repository.getEventScanStart(chainId, contractAddress);
    const gateway = new EthersMintChainGateway({
      rpcUrl,
      chainId,
      contractAddress,
      minterAddress,
      confirmations,
      fromBlock: scanFromBlock,
      fallbackFromBlock: chainFromBlock,
    });
    return await new MintWorker(repository, gateway).runOnce(workerId);
  } finally {
    await pool.end();
  }
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function requiredInteger(value: string | undefined, name: string): number {
  const parsed = Number(required(value, name));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function requiredNonNegativeInteger(value: string | undefined, name: string): number {
  const parsed = Number(required(value, name));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const processed = await runConfiguredWorker();
  console.log(processed ? 'mint worker processed one job' : 'mint worker found no work');
}
