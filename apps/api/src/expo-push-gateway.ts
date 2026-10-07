import type { PushGateway, PushMessage, PushReceipt, PushTicket } from './social.js';

const sendEndpoint = 'https://exp.host/--/api/v2/push/send';
const receiptsEndpoint = 'https://exp.host/--/api/v2/push/getReceipts';
const expoBatchSize = 100;
const defaultTimeoutMs = 10_000;

type FetchFn = typeof fetch;

export class ExpoPushGateway implements PushGateway {
  private readonly bearerCredential: string | undefined;
  private readonly fetchFn: FetchFn;
  private readonly timeoutMs: number;

  constructor(options: {
    bearerCredential?: string | undefined;
    fetchFn?: FetchFn | undefined;
    timeoutMs?: number | undefined;
  } = {}) {
    this.bearerCredential = options.bearerCredential;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error('ExpoPushGateway timeoutMs must be a positive safe integer');
    }
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) return [];
    const tickets: PushTicket[] = [];
    for (const batch of chunks(messages, expoBatchSize)) {
      const response = await this.postJson(sendEndpoint, batch);
      if (response.kind === 'retryable') {
        tickets.push(...batch.map(() => ({ status: 'error' as const, code: response.code, retryable: true })));
        continue;
      }
      if (response.kind === 'fatal') {
        tickets.push(...batch.map(() => ({ status: 'error' as const, code: response.code, retryable: false })));
        continue;
      }
      if (response.kind === 'shape') {
        tickets.push(...batch.map(() => ({ status: 'error' as const, code: 'EXPO_TICKET_SHAPE', retryable: false })));
        continue;
      }
      const parsed = parseTicketResponse(response.body, batch.length);
      tickets.push(...parsed);
    }
    return tickets;
  }

  async getReceipts(ticketIds: string[]): Promise<Map<string, PushReceipt>> {
    const receipts = new Map<string, PushReceipt>();
    if (ticketIds.length === 0) return receipts;
    for (const batch of chunks(ticketIds, expoBatchSize)) {
      const response = await this.postJson(receiptsEndpoint, { ids: batch });
      if (response.kind !== 'ok') {
        const receipt = response.kind === 'retryable'
          ? { status: 'error' as const, code: response.code, retryable: true }
          : {
            status: 'error' as const,
            code: response.kind === 'shape' ? 'EXPO_RECEIPT_SHAPE' : response.code,
            retryable: false,
          };
        for (const id of batch) receipts.set(id, receipt);
        continue;
      }
      if (!isRecord(response.body) || !isRecord(response.body.data)) {
        for (const id of batch) {
          receipts.set(id, { status: 'error', code: 'EXPO_RECEIPT_SHAPE', retryable: false });
        }
        continue;
      }
      const parsed = parseReceiptResponse(response.body);
      for (const id of batch) {
        const receipt = parsed.get(id);
        if (receipt) receipts.set(id, receipt);
      }
    }
    return receipts;
  }

  private async postJson(url: string, body: unknown): Promise<
    | { kind: 'ok'; body: unknown }
    | { kind: 'retryable'; code: string }
    | { kind: 'fatal'; code: string }
    | { kind: 'shape' }
  > {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.bearerCredential ? { Authorization: `Bearer ${this.bearerCredential}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500) {
        await drainResponse(response);
        return { kind: 'retryable', code: `EXPO_HTTP_${response.status}` };
      }
      if (!response.ok) {
        await drainResponse(response);
        return { kind: 'fatal', code: `EXPO_HTTP_${response.status}` };
      }
      try {
        return { kind: 'ok', body: await response.json() };
      } catch (error) {
        if (controller.signal.aborted) throw error;
        return { kind: 'shape' };
      }
    } catch (error) {
      return { kind: 'retryable', code: controller.signal.aborted || isAbortError(error) ? 'EXPO_TIMEOUT' : 'EXPO_NETWORK' };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseTicketResponse(body: unknown, expected: number): PushTicket[] {
  if (!isRecord(body) || !Array.isArray(body.data) || body.data.length !== expected) {
    return Array.from({ length: expected }, () => ({
      status: 'error' as const,
      code: 'EXPO_TICKET_SHAPE',
      retryable: false,
    }));
  }
  return body.data.map(parseTicket);
}

function parseTicket(value: unknown): PushTicket {
  if (!isRecord(value) || typeof value.status !== 'string') {
    return { status: 'error', code: 'EXPO_TICKET_SHAPE', retryable: false };
  }
  if (value.status === 'ok' && typeof value.id === 'string' && value.id.length > 0) {
    return { status: 'ok', id: value.id };
  }
  if (value.status === 'error') {
    const code = expoErrorCode(value);
    return { status: 'error', code, retryable: isRetryableExpoError(code) };
  }
  return { status: 'error', code: 'EXPO_TICKET_SHAPE', retryable: false };
}

function parseReceiptResponse(body: unknown): Map<string, PushReceipt> {
  const receipts = new Map<string, PushReceipt>();
  if (!isRecord(body) || !isRecord(body.data)) return receipts;
  for (const [id, value] of Object.entries(body.data)) {
    if (!isRecord(value) || typeof value.status !== 'string') {
      receipts.set(id, { status: 'error', code: 'EXPO_RECEIPT_SHAPE', retryable: false });
      continue;
    }
    if (value.status === 'ok') {
      receipts.set(id, { status: 'ok' });
      continue;
    }
    if (value.status === 'error') {
      const code = expoErrorCode(value);
      receipts.set(id, {
        status: 'error',
        code,
        retryable: isRetryableExpoError(code),
        ...(code === 'DeviceNotRegistered' ? { deadToken: true } : {}),
      });
    }
  }
  return receipts;
}

function expoErrorCode(value: Record<string, unknown>): string {
  const details = value.details;
  if (isRecord(details) && typeof details.error === 'string' && details.error.length > 0) {
    return details.error;
  }
  return 'EXPO_ERROR';
}

function isRetryableExpoError(code: string): boolean {
  return code === 'MessageRateExceeded' || code === 'ExpoPushRateExceeded';
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function drainResponse(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch (error) {
    if (isAbortError(error)) throw error;
    // The caller only needs the HTTP class. Body parse failures must not expose response content.
  }
}
