// Token bucket: protects the room from flooding (bursty ICE candidates allowed, sustained spam rejected).
export const bucket = (rate = 40, burst = 80) => ({ tokens: burst, t: Date.now(), rate, burst });
export function take(b, cost = 1) {
  const n = Date.now(); b.tokens = Math.min(b.burst, b.tokens + (n - b.t) / 1000 * b.rate); b.t = n;
  if (b.tokens < cost) return false; b.tokens -= cost; return true;
}
