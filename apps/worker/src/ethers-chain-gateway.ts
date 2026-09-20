import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
  isError,
  isHexString,
  type EventLog,
  type Log,
} from 'ethers';

import {
  ChainConfigurationError,
  MintEventMismatchError,
  RetryableChainError,
  SubmissionOutcomeUnknownError,
  type ChainMintResult,
  type MintChainGateway,
  type MintWorkItem,
} from './mint-worker.js';

const abi = [
  'function MINTER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32 role,address account) view returns (bool)',
  'function mintWithRewardKey(address recipient,bytes32 seriesId,bytes32 rewardKey) returns (uint256)',
  'function tokenByRewardKey(bytes32 rewardKey) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function seriesByToken(uint256 tokenId) view returns (bytes32)',
  'function locked(uint256 tokenId) view returns (bool)',
  'function paused() view returns (bool)',
  'event MascotMinted(bytes32 indexed rewardKey,uint256 indexed tokenId,address indexed recipient,bytes32 seriesId)',
] as const;

type GatewayOptions = {
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  minterAddress: string;
  confirmations: number;
  fromBlock: number;
  fallbackFromBlock?: number;
  minMinterBalanceWei?: bigint;
};

export class EthersMintChainGateway implements MintChainGateway {
  private readonly provider: JsonRpcProvider;
  private readonly contractAddress: string;
  private readonly minterAddress: string;
  private readonly contract: Contract;
  private readonly contractInterface = new Interface(abi);
  private readonly minMinterBalanceWei: bigint;

  constructor(private readonly options: GatewayOptions) {
    // cacheTimeout -1: a block number cached for 250ms can predate a just-mined receipt, and
    // waitForTransaction then waits for a next block that an automining chain never produces.
    this.provider = new JsonRpcProvider(options.rpcUrl, options.chainId, {
      staticNetwork: true,
      cacheTimeout: -1,
    });
    this.contractAddress = getAddress(options.contractAddress);
    this.minterAddress = getAddress(options.minterAddress);
    this.contract = new Contract(this.contractAddress, abi, this.provider);
    if (!Number.isSafeInteger(options.confirmations) || options.confirmations <= 0) {
      throw new Error('confirmations must be a positive safe integer');
    }
    if (!Number.isSafeInteger(options.fromBlock) || options.fromBlock < 0) {
      throw new Error('fromBlock must be a non-negative safe integer');
    }
    const fallbackFromBlock = options.fallbackFromBlock ?? options.fromBlock;
    if (
      !Number.isSafeInteger(fallbackFromBlock) ||
      fallbackFromBlock < 0 ||
      fallbackFromBlock > options.fromBlock
    ) {
      throw new Error('fallbackFromBlock must be between zero and fromBlock');
    }
    const minMinterBalanceWei = options.minMinterBalanceWei ?? 0n;
    if (minMinterBalanceWei < 0n) {
      throw new Error('minMinterBalanceWei must not be negative');
    }
    this.minMinterBalanceWei = minMinterBalanceWei;
  }

  async validate(item: MintWorkItem): Promise<void> {
    if (
      item.chainId !== this.options.chainId ||
      getAddress(item.contractAddress) !== this.contractAddress
    ) {
      throw new ChainConfigurationError('CHAIN_OR_CONTRACT_MISMATCH');
    }
    let rpcChainId: number;
    try {
      const chainIdHex = (await this.provider.send('eth_chainId', [])) as string;
      rpcChainId = Number(BigInt(chainIdHex));
    } catch (error) {
      throw new RetryableChainError('RPC_UNAVAILABLE', { cause: error });
    }
    if (rpcChainId !== this.options.chainId) {
      throw new ChainConfigurationError('RPC_CHAIN_MISMATCH');
    }
    let code: string;
    try {
      code = await this.provider.getCode(this.contractAddress);
    } catch (error) {
      throw new RetryableChainError('RPC_UNAVAILABLE', { cause: error });
    }
    if (code === '0x') throw new ChainConfigurationError('CONTRACT_CODE_MISSING');
    let hasMinterRole: boolean;
    try {
      const minterRole = (await this.contract.getFunction('MINTER_ROLE').staticCall()) as string;
      hasMinterRole = (await this.contract
        .getFunction('hasRole')
        .staticCall(minterRole, this.minterAddress)) as boolean;
    } catch (error) {
      throw contractCallError(error);
    }
    if (!hasMinterRole) throw new ChainConfigurationError('MINTER_ROLE_MISSING');
  }

  async assertCanSubmit(_item: MintWorkItem): Promise<void> {
    let paused: boolean;
    try {
      paused = (await this.contract.getFunction('paused').staticCall()) as boolean;
    } catch (error) {
      throw contractCallError(error);
    }
    if (paused) throw new RetryableChainError('MINT_PAUSED');

    let minterBalance: bigint;
    try {
      minterBalance = await this.provider.getBalance(this.minterAddress);
    } catch (error) {
      throw new RetryableChainError('RPC_UNAVAILABLE', { cause: error });
    }
    if (minterBalance <= this.minMinterBalanceWei) {
      throw new RetryableChainError('MINTER_BALANCE_LOW');
    }
  }

  async findMintByRewardKey(item: MintWorkItem): Promise<ChainMintResult | undefined> {
    let tokenId: bigint;
    try {
      tokenId = (await this.contract
        .getFunction('tokenByRewardKey')
        .staticCall(item.rewardKey)) as bigint;
    } catch (error) {
      const classified = contractCallError(error);
      if (classified instanceof ChainConfigurationError) throw classified;
      // Keep the existing retryable code here (tests/logs depend on it) rather than the generic
      // RPC_UNAVAILABLE that contractCallError would otherwise produce.
      throw new RetryableChainError('REWARD_KEY_LOOKUP_FAILED', { cause: error });
    }
    if (tokenId === 0n) return undefined;

    const eventFragment = this.contractInterface.getEvent('MascotMinted');
    if (!eventFragment) throw new MintEventMismatchError('MINT_EVENT_ABI_MISSING');
    const latestBlock = Number(
      BigInt((await this.provider.send('eth_blockNumber', [])) as string),
    );
    let event = await this.findLatestMintEvent(
      item,
      eventFragment.topicHash,
      this.options.fromBlock,
      latestBlock,
    );
    const fallbackFromBlock = this.options.fallbackFromBlock ?? this.options.fromBlock;
    if (!event && fallbackFromBlock < this.options.fromBlock) {
      event = await this.findLatestMintEvent(
        item,
        eventFragment.topicHash,
        fallbackFromBlock,
        Math.min(latestBlock, this.options.fromBlock - 1),
      );
    }
    if (!event) throw new MintEventMismatchError('MINT_EVENT_NOT_FOUND');
    const requiredLatestBlock = event.blockNumber + this.options.confirmations - 1;
    if (latestBlock < requiredLatestBlock) {
      throw new RetryableChainError('MINT_EVENT_NOT_FINALIZED');
    }
    return this.resultFromEvent(item, event, tokenId);
  }

  private async findLatestMintEvent(
    item: MintWorkItem,
    topicHash: string,
    fromBlock: number,
    toBlock: number,
  ): Promise<Log | undefined> {
    if (fromBlock > toBlock) return undefined;
    try {
      const logs = await this.provider.getLogs({
        address: this.contractAddress,
        fromBlock,
        toBlock,
        topics: [topicHash, item.rewardKey],
      });
      return logs.at(-1);
    } catch (error) {
      throw new RetryableChainError('MINT_EVENT_LOOKUP_FAILED', { cause: error });
    }
  }

  async submitMint(item: MintWorkItem): Promise<{ transactionHash: string }> {
    try {
      const signer = await this.provider.getSigner(this.minterAddress);
      const writable = this.contract.connect(signer) as Contract;
      const transaction = await writable
        .getFunction('mintWithRewardKey')
        .send(item.recipient, item.seriesKey, item.rewardKey);
      return { transactionHash: String(transaction.hash).toLowerCase() };
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'transactionHash' in error &&
        typeof error.transactionHash === 'string'
      ) {
        throw new SubmissionOutcomeUnknownError('MINT_SUBMISSION_RESPONSE_LOST');
      }
      throw new RetryableChainError('MINT_SUBMISSION_FAILED');
    }
  }

  async confirmMint(item: MintWorkItem, transactionHash: string): Promise<ChainMintResult> {
    let receipt;
    try {
      receipt = await this.provider.waitForTransaction(
        transactionHash,
        this.options.confirmations,
        30_000,
      );
    } catch {
      throw new RetryableChainError('RECEIPT_LOOKUP_FAILED');
    }
    if (!receipt) throw new RetryableChainError('RECEIPT_NOT_READY');
    if (receipt.status !== 1) throw new MintEventMismatchError('MINT_TRANSACTION_REVERTED');

    const eventFragment = this.contractInterface.getEvent('MascotMinted');
    if (!eventFragment) throw new MintEventMismatchError('MINT_EVENT_ABI_MISSING');
    const matching = receipt.logs.filter(
      (log) =>
        log.address.toLowerCase() === this.contractAddress.toLowerCase() &&
        log.topics[0] === eventFragment.topicHash,
    );
    if (matching.length !== 1) throw new MintEventMismatchError('MINT_EVENT_COUNT_MISMATCH');
    return this.resultFromEvent(item, matching[0]!, undefined);
  }

  private async resultFromEvent(
    item: MintWorkItem,
    event: EventLog | Log,
    expectedTokenId: bigint | undefined,
  ): Promise<ChainMintResult> {
    const parsed = this.contractInterface.parseLog(event);
    if (!parsed) throw new MintEventMismatchError('MINT_EVENT_PARSE_FAILED');
    const rewardKey = String(parsed.args.rewardKey).toLowerCase();
    const tokenId = parsed.args.tokenId as bigint;
    const recipient = getAddress(String(parsed.args.recipient));
    const seriesKey = String(parsed.args.seriesId).toLowerCase();
    if (
      rewardKey !== item.rewardKey.toLowerCase() ||
      recipient !== getAddress(item.recipient) ||
      seriesKey !== item.seriesKey.toLowerCase() ||
      (expectedTokenId !== undefined && tokenId !== expectedTokenId)
    ) {
      throw new MintEventMismatchError('MINT_EVENT_MISMATCH');
    }

    const [owner, storedSeries, locked, block] = await Promise.all([
      this.contract.getFunction('ownerOf').staticCall(tokenId) as Promise<string>,
      this.contract.getFunction('seriesByToken').staticCall(tokenId) as Promise<string>,
      this.contract.getFunction('locked').staticCall(tokenId) as Promise<boolean>,
      this.provider.getBlock(event.blockNumber),
    ]);
    if (
      getAddress(owner) !== recipient ||
      String(storedSeries).toLowerCase() !== seriesKey ||
      locked !== true ||
      !block ||
      !block.hash
    ) {
      throw new MintEventMismatchError('MINT_STATE_MISMATCH');
    }

    return {
      transactionHash: event.transactionHash.toLowerCase(),
      blockNumber: event.blockNumber,
      blockHash: block.hash.toLowerCase(),
      logIndex: event.index,
      tokenId: tokenId.toString(),
      rewardKey,
      recipient,
      seriesKey,
      contractAddress: this.contractAddress,
      chainId: item.chainId,
    };
  }
}

// A contract that answers but not with our interface is a deployment mistake that retrying cannot
// fix. ethers labels every JSON-RPC error returned for eth_call as CALL_EXCEPTION, including rate
// limits and node timeouts, so only a CALL_EXCEPTION that carries EVM return data is a real revert.
export function contractCallError(error: unknown): ChainConfigurationError | RetryableChainError {
  const reverted = isError(error, 'CALL_EXCEPTION') && error.data != null;
  // The provider also raises BAD_DATA for a missing entry in a batched response; only a decode
  // failure carries the returned hex data as its value.
  const undecodable = isError(error, 'BAD_DATA') && isHexString(error.value);
  if (reverted || undecodable) {
    return new ChainConfigurationError('CONTRACT_INTERFACE_MISMATCH');
  }
  return new RetryableChainError('RPC_UNAVAILABLE', { cause: error });
}
