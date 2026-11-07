// Network Quality Meter: EWMA smoothing + hysteresis (degrade fast, recover slowly)
// so real-time network fluctuations do not cause UI flapping.

export type NetQualityLevel = "good" | "fair" | "poor";

export const RANK: Record<NetQualityLevel, number> = {
  good: 0,
  fair: 1,
  poor: 2,
};

export const NOTICE: Record<NetQualityLevel, string> = {
  poor: "Your connection is weak. Video is paused to keep your audio clear.",
  fair: "Your connection is unstable.",
  good: "Your connection has recovered.",
};

export interface NetMeter {
  rtt: number | null;
  loss: number;
  level: NetQualityLevel;
  pending: NetQualityLevel;
  streak: number;
  at: number;
}

export function classify(rtt: number, loss: number): NetQualityLevel {
  if (rtt > 400 || loss > 0.08) return "poor";
  if (rtt > 200 || loss > 0.03) return "fair";
  return "good";
}

export function createMeter(): NetMeter {
  return {
    rtt: null,
    loss: 0,
    level: "good",
    pending: "good",
    streak: 0,
    at: Date.now(),
  };
}

/**
 * Feeds a telemetry sample (RTT in ms, packet loss ratio 0..1).
 * Returns the new level ONLY when an authoritative transition occurs.
 */
export function sample(
  meter: NetMeter,
  data: { rtt?: number | null; loss?: number | null },
): NetQualityLevel | null {
  const alpha = 0.4;
  if (data.rtt != null && Number.isFinite(data.rtt)) {
    meter.rtt = meter.rtt == null ? data.rtt : meter.rtt * (1 - alpha) + data.rtt * alpha;
  }
  if (data.loss != null && Number.isFinite(data.loss)) {
    meter.loss = meter.loss * (1 - alpha) + Math.max(0, Math.min(1, data.loss)) * alpha;
  }
  meter.at = Date.now();

  const next = classify(meter.rtt ?? 0, meter.loss);
  if (next === meter.level) {
    meter.streak = 0;
    meter.pending = next;
    return null;
  }

  meter.streak = next === meter.pending ? meter.streak + 1 : 1;
  meter.pending = next;

  // Degrade quickly (2 samples), recover slowly (5 samples)
  const threshold = RANK[next] > RANK[meter.level] ? 2 : 5;
  if (meter.streak >= threshold) {
    meter.level = next;
    meter.streak = 0;
    return next;
  }

  return null;
}

