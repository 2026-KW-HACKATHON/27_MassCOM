
export type AuthLoginLimiter = {
  consume(key: string): { allowed: boolean; retryAfterSeconds: number };
};

type LoginLimiterOptions = {
  maxAttempts: number;
  windowMs: number;
  maxEntries?: number;
  now?: () => Date;
};

export class FixedWindowAuthLoginLimiter implements AuthLoginLimiter {
  private readonly buckets = new Map<string, { count: number; startedAt: number }>();
  private readonly maxEntries: number;
  private readonly now: () => Date;

  constructor(private readonly options: LoginLimiterOptions) {
    if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts <= 0) {
      throw new Error('auth login max attempts must be a positive safe integer');
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
      throw new Error('auth login window must be a positive safe integer');
    }
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? (() => new Date());
  }

  consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now().getTime();
    const existing = this.buckets.get(key);
    if (!existing || now - existing.startedAt >= this.options.windowMs) {
      if (!existing && this.buckets.size >= this.maxEntries) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (oldest) this.buckets.delete(oldest);
      }
      this.buckets.set(key, { count: 1, startedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= this.options.maxAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.startedAt + this.options.windowMs - now) / 1000),
        ),
      };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
