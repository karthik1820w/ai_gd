// Token Bucket Rate Limiter: protects real-time WebSocket signaling
// from packet flooding, spamming, and denial of service.

export interface TokenBucket {
  tokens: number;
  t: number;
  rate: number;
  burst: number;
}

/**
 * Creates a token bucket.
 * @param rate Refill rate in tokens per second (default: 40)
 * @param burst Maximum token burst capacity (default: 80)
 */
export function createBucket(rate = 40, burst = 80): TokenBucket {
  return {
    tokens: burst,
    t: Date.now(),
    rate,
    burst,
  };
}

export function createRealtimeBuckets() {
  return {
    speaking: createBucket(2, 4),
    transcript: createBucket(10, 30),
  };
}

/**
 * Attempts to take `cost` tokens from the bucket.
 * Returns true if allowed, false if rate limited.
 */
export function take(bucket: TokenBucket, cost = 1): boolean {
  const now = Date.now();
  bucket.tokens = Math.min(bucket.burst, bucket.tokens + ((now - bucket.t) / 1000) * bucket.rate);
  bucket.t = now;

  if (bucket.tokens < cost) {
    return false;
  }

  bucket.tokens -= cost;
  return true;
}
