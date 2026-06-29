/**
 * Shared retry + exponential backoff + token-bucket rate limiter
 * for Sitemap-Warmup, Backfill drains and IndexNow submission flows.
 *
 * Goal: stabilize crawl/submit traffic, avoid provider rate-limit bans,
 * and ensure failed submissions are retried with jittered backoff.
 *
 * Usage:
 *   const limiter = new TokenBucket({ tokensPerInterval: 10, intervalMs: 1000 });
 *   await limiter.take();
 *   const res = await retry(() => fetch(url), { maxAttempts: 5 });
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return true if the error/result should trigger a retry. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional logger; defaults to console.warn. */
  onRetry?: (err: unknown, attempt: number, waitMs: number) => void;
}

const DEFAULTS: Required<Omit<RetryOptions, "shouldRetry" | "onRetry">> = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

function jitter(ms: number): number {
  // ±25% jitter to avoid thundering-herd retries
  const delta = ms * 0.25;
  return Math.max(0, Math.floor(ms + (Math.random() * 2 - 1) * delta));
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retry an async operation with exponential backoff + jitter.
 * Rethrows the last error if all attempts fail.
 */
export async function retry<T>(
  op: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const cfg = { ...DEFAULTS, ...opts };
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  const onRetry = opts.onRetry ?? defaultOnRetry;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (attempt === cfg.maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const expo = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** (attempt - 1));
      const wait = jitter(expo);
      onRetry(err, attempt, wait);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function defaultShouldRetry(err: unknown, _attempt: number): boolean {
  // Retry on network errors and 5xx / 429 responses.
  const msg = (err as Error)?.message ?? String(err);
  if (/HTTP\s+(5\d{2}|429)/i.test(msg)) return true;
  if (/network|fetch failed|timeout|aborted|ECONN/i.test(msg)) return true;
  return false;
}

function defaultOnRetry(err: unknown, attempt: number, waitMs: number): void {
  console.warn(
    `[retry] attempt=${attempt} wait=${waitMs}ms err=${(err as Error)?.message ?? err}`,
  );
}

/**
 * Token bucket rate limiter. Refills `tokensPerInterval` every `intervalMs`,
 * max bucket size = tokensPerInterval (no burst beyond one interval window).
 */
export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly tokensPerInterval: number;
  private readonly intervalMs: number;
  private lastRefill: number;

  constructor(opts: { tokensPerInterval: number; intervalMs: number; capacity?: number }) {
    this.tokensPerInterval = opts.tokensPerInterval;
    this.intervalMs = opts.intervalMs;
    this.capacity = opts.capacity ?? opts.tokensPerInterval;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const refill = (elapsed / this.intervalMs) * this.tokensPerInterval;
    if (refill >= 1) {
      this.tokens = Math.min(this.capacity, this.tokens + refill);
      this.lastRefill = now;
    }
  }

  /** Acquire 1 token, blocking via setTimeout until available. */
  async take(count = 1): Promise<void> {
    while (true) {
      this.refill();
      if (this.tokens >= count) {
        this.tokens -= count;
        return;
      }
      const deficit = count - this.tokens;
      const waitMs = Math.ceil((deficit / this.tokensPerInterval) * this.intervalMs);
      await sleep(Math.max(50, waitMs));
    }
  }
}

/** Helper: limited+retried fetch wrapper. */
export async function rateLimitedFetch(
  limiter: TokenBucket,
  input: string | URL,
  init?: RequestInit,
  retryOpts?: RetryOptions,
): Promise<Response> {
  await limiter.take();
  return retry(async () => {
    const res = await fetch(input, init);
    if (res.status >= 500 || res.status === 429) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${input}`);
    }
    return res;
  }, retryOpts);
}
