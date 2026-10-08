import {
  Contract,
  Interface,
  JsonRpcProvider,
  Transaction,
  getAddress,
  isError,
  isHexString,
  type EventLog,
  type Log,
  type Signer,
  type TransactionReceipt,
} from 'ethers';

import {
  ChainConfigurationError,
  MintEventMismatchError,
  RetryableChainError,
  SubmissionOutcomeUnknownError,
  type ChainMintResult,
  type MintChainGateway,
  type MintWorkItem,
  type MintTransactionIntent,
  type RecordedSubmission,
  type UnconfirmedSignedTransaction,
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
  /** Service signer only: refuse to sign when the RPC's fee quote makes one mint cost more than this. */
  maxTransactionFeeWei?: bigint;
  /**
   * A locally held signer for the minter address (service-signer path only). When present,
   * submitMint builds, signs, and records a transaction before ever broadcasting it. When
   * absent, the gateway keeps the existing local-Anvil behaviour: the node itself signs and
   * broadcasts an unlocked account's transaction in one call.
   */
  signer?: Signer;
  /** confirmMint가 영수증과 확인 깊이를 기다리는 상한(ms). 기본 30초. */
  receiptWaitMs?: number;
  /** confirmMint가 영수증을 다시 조회하기까지의 간격(ms). 기본 2초. */
  receiptPollMs?: number;
};

export class EthersMintChainGateway implements MintChainGateway {
  private readonly provider: JsonRpcProvider;
  private readonly contractAddress: string;
  readonly minterAddress: string;
  private readonly contract: Contract;
  private readonly contractInterface = new Interface(abi);
  private readonly minMinterBalanceWei: bigint;
  private readonly maxTransactionFeeWei: bigint;
  // 기록된 커서에서 다시 계산한 이벤트 조회 시작 블록. 상시 실행 Worker는 반복마다 갱신해 조회 범위가 시작 시점부터 계속 늘지 않게 한다.
  private scanFromBlock: number;

  constructor(private readonly options: GatewayOptions) {
    // cacheTimeout -1: a block number cached for 250ms can predate a just-mined receipt, which
    // would make the confirmation-depth check in waitForReceipt see a head older than the receipt.
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
    // 0.01 ETH per mint: far above a Base Sepolia mint, far below a drained wallet.
    this.scanFromBlock = options.fromBlock;
    this.maxTransactionFeeWei = options.maxTransactionFeeWei ?? 10_000_000_000_000_000n;
    if (this.maxTransactionFeeWei <= 0n) {
      throw new Error('maxTransactionFeeWei must be positive');
    }
    const minMinterBalanceWei = options.minMinterBalanceWei ?? 0n;
    if (minMinterBalanceWei < 0n) {
      throw new Error('minMinterBalanceWei must not be negative');
    }
    this.minMinterBalanceWei = minMinterBalanceWei;
  }

  /**
   * 기록된 커서에서 다시 계산한 이벤트 조회 시작 블록으로 바꾼다. 상시 실행 Worker가 반복마다 부르며,
   * 생성자와 같은 범위 규칙(0 이상의 안전한 정수, 조회 하한 이상)을 지킨다.
   */
  setScanFromBlock(fromBlock: number): void {
    if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
      throw new Error('fromBlock must be a non-negative safe integer');
    }
    const fallbackFromBlock = this.options.fallbackFromBlock ?? fromBlock;
    if (fallbackFromBlock > fromBlock) {
      throw new Error('fallbackFromBlock must be between zero and fromBlock');
    }
    this.scanFromBlock = fromBlock;
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
      this.scanFromBlock,
      latestBlock,
    );
    const fallbackFromBlock = this.options.fallbackFromBlock ?? this.scanFromBlock;
    if (!event && fallbackFromBlock < this.scanFromBlock) {
      event = await this.findLatestMintEvent(
        item,
        eventFragment.topicHash,
        fallbackFromBlock,
        Math.min(latestBlock, this.scanFromBlock - 1),
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

  async submitMint(
    item: MintWorkItem,
    persistBeforeBroadcast: (record: RecordedSubmission) => Promise<void>,
    unconfirmedSignedTransactions: UnconfirmedSignedTransaction[] = [],
  ): Promise<{ transactionHash: string }> {
    if (this.options.signer) {
      return this.submitMintWithServiceSigner(
        item,
        this.options.signer,
        persistBeforeBroadcast,
        unconfirmedSignedTransactions,
      );
    }
    try {
      const signer = await this.provider.getSigner(this.minterAddress);
      const writable = this.contract.connect(signer) as Contract;
      const transaction = await writable
        .getFunction('mintWithRewardKey')
        .send(item.recipient, item.seriesKey, item.rewardKey);
      const transactionHash = String(transaction.hash).toLowerCase();
      // The unlocked node signs and broadcasts in the same call, so the hash is only known
      // after the fact: record it right away, matching the previous behaviour exactly.
      await persistBeforeBroadcast({ transactionHash });
      return { transactionHash };
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

  private async submitMintWithServiceSigner(
    item: MintWorkItem,
    signer: Signer,
    persistBeforeBroadcast: (record: RecordedSubmission) => Promise<void>,
    unconfirmedSignedTransactions: UnconfirmedSignedTransaction[],
  ): Promise<{ transactionHash: string }> {
    const data = this.contractInterface.encodeFunctionData('mintWithRewardKey', [
      item.recipient,
      item.seriesKey,
      item.rewardKey,
    ]);
    let latestNonce: number;
    let pendingNonce: number;
    let feeData: Awaited<ReturnType<JsonRpcProvider['getFeeData']>>;
    let estimatedGas: bigint;
    try {
      // Take the max of 'latest' and 'pending': some RPC providers track a connected account's
      // mempool nonce poorly, and a stale 'pending' response must never move the nonce backward.
      [latestNonce, pendingNonce] = await Promise.all([
        this.provider.getTransactionCount(this.minterAddress, 'latest'),
        this.provider.getTransactionCount(this.minterAddress, 'pending'),
      ]);
      feeData = await this.provider.getFeeData();
      estimatedGas = await this.provider.estimateGas({
        to: this.contractAddress,
        data,
        from: this.minterAddress,
      });
    } catch (error) {
      throw new RetryableChainError('RPC_UNAVAILABLE', { cause: error });
    }
    // A further floor: one past the highest nonce among this chain's own recorded-but-unconfirmed
    // signed attempts (decoded from the signed payload itself, not trusted metadata). The sweep
    // that runs before this already tried to rebroadcast every one of them, but the RPC's nonce
    // view can still lag a moment behind that — this worker's own records must win that race.
    let recordedNonceFloor = 0;
    for (const pending of unconfirmedSignedTransactions) {
      try {
        recordedNonceFloor = Math.max(recordedNonceFloor, Transaction.from(pending.signedTransaction).nonce + 1);
      } catch {
        // An unparsable recorded payload contributes no floor; rebroadcastIfNeeded already tried
        // it above regardless of whether we can decode it here.
      }
    }
    const nonce = Math.max(latestNonce, pendingNonce, recordedNonceFloor);
    // A null or non-positive maxFeePerGas would sign a transaction the network can never accept
    // (or, worse, one with an unbounded fee): fail closed before anything is signed or recorded,
    // rather than let `?? null` silently paper over missing fee data.
    if (
      feeData.maxFeePerGas == null ||
      feeData.maxPriorityFeePerGas == null ||
      feeData.maxFeePerGas <= 0n ||
      feeData.maxPriorityFeePerGas <= 0n ||
      feeData.maxPriorityFeePerGas > feeData.maxFeePerGas
    ) {
      throw new RetryableChainError('FEE_DATA_UNAVAILABLE');
    }
    // 20% headroom over the estimate: an estimate taken slightly before signing can be too tight
    // by the time the transaction actually executes, and an out-of-gas revert is far more
    // expensive to recover from than a slightly larger gas limit.
    const gasLimit = (estimatedGas * 12n) / 10n;
    // The fee quote comes from the RPC endpoint. A faulty or hostile one could otherwise get a
    // transaction signed that spends the minter's whole balance on gas.
    if (gasLimit * feeData.maxFeePerGas > this.maxTransactionFeeWei) {
      throw new RetryableChainError('FEE_ABOVE_CEILING');
    }
    let signedTransaction: string;
    try {
      signedTransaction = await signer.signTransaction({
        type: 2,
        to: this.contractAddress,
        data,
        nonce,
        chainId: this.options.chainId,
        gasLimit,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      });
    } catch (error) {
      throw new RetryableChainError('MINT_SIGNING_FAILED', { cause: error });
    }
    const signed = this.checkedServiceTransaction(signedTransaction, item);
    const transactionHash = signed.hash;
    if (!transactionHash) throw new RetryableChainError('MINT_SIGNING_FAILED');
    const normalizedHash = transactionHash.toLowerCase();
    // Record before broadcasting: a crash or a lost response after this point never needs a new
    // transaction — restart recovery re-broadcasts this exact signed transaction instead.
    await persistBeforeBroadcast({ transactionHash: normalizedHash, signedTransaction });
    await this.broadcastSigned(signedTransaction, 'fresh');
    return { transactionHash: normalizedHash };
  }

  /**
   * Restart recovery for a job that already recorded a signed transaction: re-broadcasts it only
   * if the network does not already know it, so a crash between recording and broadcasting (or a
   * lost broadcast response) never needs a new transaction or a new nonce.
   */
  async rebroadcastIfNeeded(
    intent: MintTransactionIntent,
    transactionHash: string,
    signedTransaction: string,
  ): Promise<void> {
    this.checkedServiceTransaction(signedTransaction, intent, transactionHash);
    try {
      const existing = await this.provider.getTransaction(transactionHash);
      if (existing) return;
    } catch (error) {
      throw new RetryableChainError('RPC_UNAVAILABLE', { cause: error });
    }
    await this.broadcastSigned(signedTransaction, 'rebroadcast');
  }

  private checkedServiceTransaction(
    signedTransaction: string,
    intent: MintTransactionIntent,
    expectedHash?: string,
  ): Transaction {
    let transaction: Transaction;
    try {
      transaction = Transaction.from(signedTransaction);
    } catch (error) {
      throw new RetryableChainError('MINT_SIGNED_TRANSACTION_INVALID', { cause: error });
    }
    if (!transaction.from || getAddress(transaction.from) !== this.minterAddress) {
      throw new RetryableChainError('MINTER_SIGNER_MISMATCH');
    }
    const expectedData = this.contractInterface.encodeFunctionData('mintWithRewardKey', [
      intent.recipient,
      intent.seriesKey,
      intent.rewardKey,
    ]);
    if (
      transaction.chainId !== BigInt(intent.chainId) ||
      !transaction.to ||
      getAddress(transaction.to) !== getAddress(intent.contractAddress) ||
      transaction.data.toLowerCase() !== expectedData.toLowerCase()
    ) {
      throw new RetryableChainError('MINT_SIGNED_TRANSACTION_MISMATCH');
    }
    if (
      expectedHash &&
      (!transaction.hash || transaction.hash.toLowerCase() !== expectedHash.toLowerCase())
    ) {
      throw new RetryableChainError('MINT_SIGNED_TRANSACTION_MISMATCH');
    }
    return transaction;
  }

  /**
   * `mode` distinguishes a brand-new submission from resending a transaction already recorded on
   * an earlier attempt: "nonce too low" means something different in each case.
   * - rebroadcast: the recorded transaction's nonce was already consumed — by an earlier
   *   broadcast of this exact transaction, or by this same signed payload sent previously — so
   *   there is nothing left to do.
   * - fresh: this transaction was just signed against a nonce this worker believed was free. A
   *   nonce-too-low response here means that belief was wrong and this exact transaction can
   *   never mine, which is a real problem worth surfacing (not silently swallowing).
   */
  private async broadcastSigned(
    signedTransaction: string,
    mode: 'fresh' | 'rebroadcast',
  ): Promise<void> {
    try {
      await this.provider.broadcastTransaction(signedTransaction);
    } catch (error) {
      if (isAlreadyKnown(error)) return;
      if (isNonceTooLow(error)) {
        if (mode === 'rebroadcast') return;
        // Never log the raw provider error here: it can echo back the signed transaction payload.
        console.error('mint worker: fresh submission nonce rejected', {
          name: (error as { name?: unknown })?.name,
          code: (error as { code?: unknown })?.code,
        });
        throw new RetryableChainError('MINT_BROADCAST_NONCE_CONFLICT', { cause: error });
      }
      throw new RetryableChainError('MINT_BROADCAST_FAILED', { cause: error });
    }
  }

  /** Releases the provider's network resources (pending requests, polling). Call once on shutdown. */
  close(): void {
    this.provider.destroy();
  }

  async confirmMint(item: MintWorkItem, transactionHash: string): Promise<ChainMintResult> {
    const receipt = await this.waitForReceipt(transactionHash);
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

  /**
   * Bounded poll for a receipt that is at least `confirmations` deep. This replaces ethers'
   * provider.waitForTransaction (6.17), which console.logs receipt-fetch errors with the full RPC
   * URL (API key included), throws from inside an async Promise executor so a getBlockNumber
   * failure becomes an unhandled rejection that kills the process, and leaves its block listener
   * running after the timeout. RPC errors are swallowed here on purpose: they embed the RPC URL,
   * so only a code-only RetryableChainError ever leaves this method.
   */
  private async waitForReceipt(transactionHash: string): Promise<TransactionReceipt> {
    const waitMs = this.options.receiptWaitMs ?? 30_000;
    const pollMs = this.options.receiptPollMs ?? 2_000;
    const deadline = Date.now() + waitMs;
    for (;;) {
      try {
        const receipt = await this.provider.getTransactionReceipt(transactionHash);
        if (receipt) {
          const head = await this.provider.getBlockNumber();
          if (head - receipt.blockNumber + 1 >= this.options.confirmations) return receipt;
        }
      } catch {
        // Retry until the deadline; see the method comment for why the error is dropped.
      }
      const remaining = deadline - Date.now();
      // Same code the old waitForTransaction timeout (and any lookup failure) produced.
      if (remaining <= 0) throw new RetryableChainError('RECEIPT_LOOKUP_FAILED');
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
    }
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

    let block;
    try {
      block = await this.provider.getBlock(event.blockNumber);
    } catch (error) {
      throw new RetryableChainError('RPC_UNAVAILABLE', { cause: error });
    }
    if (!block?.hash || !event.blockHash || block.hash.toLowerCase() !== event.blockHash.toLowerCase()) {
      throw new RetryableChainError('MINT_EVENT_NOT_FINALIZED');
    }

    const [owner, storedSeries, locked] = await Promise.all([
      this.contract.getFunction('ownerOf').staticCall(tokenId) as Promise<string>,
      this.contract.getFunction('seriesByToken').staticCall(tokenId) as Promise<string>,
      this.contract.getFunction('locked').staticCall(tokenId) as Promise<boolean>,
    ]);
    if (
      getAddress(owner) !== recipient ||
      String(storedSeries).toLowerCase() !== seriesKey ||
      locked !== true
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

// The node already has this exact transaction (a retried broadcast of the same payload): not a
// failure either way, so this check does not depend on fresh vs rebroadcast.
function isAlreadyKnown(error: unknown): boolean {
  return errorMessage(error).includes('already known');
}

// Prefer ethers' own classification over message sniffing; fall back to the message only when
// the provider does not tag the error. NONCE_EXPIRED is the direct "nonce too low" case;
// REPLACEMENT_UNDERPRICED means a transaction already occupies that nonce and this one does not
// out-bid it — for our purposes (this exact nonce is spoken for) that is the same situation.
function isNonceTooLow(error: unknown): boolean {
  if (isError(error, 'NONCE_EXPIRED') || isError(error, 'REPLACEMENT_UNDERPRICED')) return true;
  return errorMessage(error).includes('nonce too low');
}

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message).toLowerCase()
    : '';
}
