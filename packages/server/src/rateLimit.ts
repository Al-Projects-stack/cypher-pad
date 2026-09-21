export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

const buckets = new Map<string, number[]>();

export function checkRateLimit(key: string, opts: RateLimitOptions, now = Date.now()): boolean {
  const seen = buckets.get(key) ?? [];
  const cutoff = now - opts.windowMs;
  const fresh = seen.filter((t) => t > cutoff);
  if (fresh.length >= opts.limit) {
    buckets.set(key, fresh);
    return false;
  }
  fresh.push(now);
  buckets.set(key, fresh);
  return true;
}

export function clearRateLimits(): void {
  buckets.clear();
}

export const REGISTER_IP = { limit: 10, windowMs: 60 * 60 * 1000 };
export const LOGIN_IP = { limit: 30, windowMs: 60 * 1000 };
export const LOGIN_ACCOUNT = { limit: 10, windowMs: 60 * 1000 };
export const PRELOGIN_IP = { limit: 60, windowMs: 60 * 1000 };
export const SYNC_IP = { limit: 240, windowMs: 60 * 1000 };
