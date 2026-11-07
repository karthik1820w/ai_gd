// Network quality meter: EWMA smoothing + hysteresis (degrade fast, recover slowly) so the UI never flaps.
const RANK = { good: 0, fair: 1, poor: 2 };
const classify = (rtt, loss) => (rtt > 400 || loss > 0.08 ? 'poor' : rtt > 200 || loss > 0.03 ? 'fair' : 'good');
export const createMeter = () => ({ rtt: null, loss: 0, level: 'good', pending: 'good', streak: 0, at: 0 });
export function sample(m, { rtt, loss }) { // returns the new level only when it changes
  const a = 0.4;
  if (rtt != null) m.rtt = m.rtt == null ? rtt : m.rtt * (1 - a) + rtt * a;
  if (loss != null) m.loss = m.loss * (1 - a) + loss * a;
  m.at = Date.now();
  const next = classify(m.rtt ?? 0, m.loss);
  if (next === m.level) { m.streak = 0; m.pending = next; return null; }
  m.streak = next === m.pending ? m.streak + 1 : 1; m.pending = next;
  if (m.streak >= (RANK[next] > RANK[m.level] ? 2 : 5)) { m.level = next; m.streak = 0; return next; }
  return null;
}
