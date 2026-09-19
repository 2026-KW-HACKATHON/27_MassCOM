import {
  Contract,
  Interface,
  JsonRpcProvider,
  getAddress,
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
  'event MascotMinted(bytes32 indexed rewardKey,uint256 indexed tokenId,address indexed recipient,bytes32 seriesId)',
] as const;

type GatewayOptions = {
  rpcUrl: string;
  chainId: number;
  contractAddress: string;
  minterAddress: string;
  confirmations: number;
  fromBlock: number;
};

export class EthersMintChainGateway implements MintChainGateway {
  private readonly provider: JsonRpcProvider;
  private readonly contractAddress: string;
  private readonly minterAddress: string;
  private readonly contract: Contract;
  private readonly contractInterface = new Interface(abi);

  constructor(private readonly options: GatewayOptions) {
    this.provider = new JsonRpcProvider(options.rpcUrl, options.chainId, { staticNetwork: true });
    this.contractAddress = getAddress(options.contractAddress);
    this.minterAddress = getAddress(options.minterAddress);
    this.contract = new Contract(this.contractAddress, abi, this.provider);
    if (!Number.isSafeInteger(options.confirmations) || options.confirmations <= 0) {
      throw new Error('confirmations must be a positive safe integer');
    }
    if (!Number.isSafeInteger(options.fromBlock) || options.fromBlock < 0) {
      throw new Error('fromBlock must be a non-negative safe integer');
    }
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
    } catch {
      throw new ChainConfigurationError('RPC_CHAIN_MISMATCH');
    }
    if (rpcChainId !== this.options.chainId) {
      throw new ChainConfigurationError('RPC_CHAIN_MISMATCH');
    }
    const code = await this.provider.getCode(this.contractAddress);
    if (code === '0x') throw new ChainConfigurationError('CONTRACT_CODE_MISSING');
    const minterRole = (await this.contract.getFunction('MINTER_ROLE').staticCall()) as string;
    const hasMinterRole = (await this.contract
      .getFunction('hasRole')
      .staticCall(minterRole, this.minterAddress)) as boolean;
    if (!hasMinterRole) throw new ChainConfigurationError('MINTER_ROLE_MISSING');
  }

  async findMintByRewardKey(item: MintWorkItem): Promise<ChainMintResult | undefined> {
    let tokenId: bigint;
    try {
      tokenId = (await this.contract
        .getFunction('tokenByRewardKey')
        .staticCall(item.rewardKey)) as bigint;
    } catch {
      throw new RetryableChainError('REWARD_KEY_LOOKUP_FAILED');
    }
    if (tokenId === 0n) return undefined;

    const eventFragment = this.contractInterface.getEvent('MascotMinted');
    if (!eventFragment) throw new MintEventMismatchError('MINT_EVENT_ABI_MISSING');
    const logs = await this.provider.getLogs({
      address: this.contractAddress,
      fromBlock: this.options.fromBlock,
      toBlock: 'latest',
      topics: [eventFragment.topicHash, item.rewardKey],
    });
    const event = logs.at(-1);
    if (!event) throw new MintEventMismatchError('MINT_EVENT_NOT_FOUND');
    const latestBlock = Number(
      BigInt((await this.provider.send('eth_blockNumber', [])) as string),
    );
    const requiredLatestBlock = event.blockNumber + this.options.confirmations - 1;
    if (latestBlock < requiredLatestBlock) {
      throw new RetryableChainError('MINT_EVENT_NOT_FINALIZED');
    }
    return this.resultFromEvent(item, event, tokenId);
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
