// Dependency-free hashed bag-of-words embedding (256-d, signed feature hashing, L2-normalised).
// Good enough for topic-relevance on shared vocabulary; swap embed() for a real embedding model without changing callers.
const D = 256, STOP = new Set('the and for are was but not you with this that have has from they will would there their what about which when your can its into than them then these those been were'.split(' '));
export function embed(text) {
  const v = new Array(D).fill(0);
  for (const w of (String(text).toLowerCase().match(/[a-z0-9]+/g) || [])) {
    if (w.length < 3 || STOP.has(w)) continue;
    let h = 2166136261; for (const c of w) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    v[(h >>> 0) % D] += (h >>> 16) & 1 ? 1 : -1;
  }
  const n = Math.hypot(...v) || 1; return v.map(x => x / n);
}
export async function embedAsync(text) { // optional OpenAI-compatible embeddings endpoint; falls back to the local hash embedding on any failure
  const u = process.env.EMBEDDINGS_URL; if (!u) return embed(text);
  try {
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.EMBEDDINGS_KEY ? { authorization: 'Bearer ' + process.env.EMBEDDINGS_KEY } : {}) }, body: JSON.stringify({ model: process.env.EMBEDDINGS_MODEL, input: text, dimensions: D }), signal: AbortSignal.timeout(4000) });
    const v = (await r.json()).data?.[0]?.embedding;
    if (Array.isArray(v) && v.length === D) { const n = Math.hypot(...v) || 1; return v.map(x => x / n); }
  } catch {}
  return embed(text);
}
export const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
