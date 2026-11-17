// 256-dimensional signed feature hashing vectorizer (dependency-free).
const D = 256;
const STOP = new Set(
  "the and for are was but not you with this that have has from they will would there their what about which when your can its into than them then these those been were a an in of to on is at by".split(" "),
);

/**
 * Computes a deterministic 256-dimensional signed feature hashing embedding vector.
 * L2-normalized so dot product equals cosine similarity.
 */
export function embed(text: string): number[] {
  const v = new Array(D).fill(0);
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const word of words) {
    if (word.length < 3 || STOP.has(word)) continue;
    let hash = 2166136261;
    for (let index = 0; index < word.length; index += 1) {
      hash ^= word.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    v[(hash >>> 0) % D] += (hash >>> 16) & 1 ? 1 : -1;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((value) => value / norm);
}

/** Cosine similarity between two L2-normalized vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

/** Use Gemini embeddings when configured and fall back to local feature hashing. */
export async function embedAsync(text: string, fetchFn = fetch): Promise<number[]> {
  const key = process.env.GEMINI_API_KEY || process.env.GEMINI_FLASH_API_KEY;
  if (!key || process.env.AI_ENABLED?.toLowerCase() === "off") return embed(text);
  try {
    const base = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    const response = await fetchFn(`${base}/v1beta/models/gemini-embedding-001:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: D }),
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const data = await response.json() as { embedding?: { values?: unknown } };
      const vector = data.embedding?.values;
      if (Array.isArray(vector) && vector.length === D && vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
        const values = vector as number[];
        const norm = Math.hypot(...values) || 1;
        return values.map((value) => value / norm);
      }
    }
  } catch {
    // Local feature hashing is the intentional offline fallback.
  }
  return embed(text);
}

/** Computes semantic similarity (0 to 100) between text and the discussion topic. */
export async function semanticRelevance(text: string, topicText: string): Promise<number> {
  const [textVector, topicVector] = await Promise.all([embedAsync(text), embedAsync(topicText)]);
  const similarity = cosine(textVector, topicVector);
  const scaled = ((similarity + 0.1) / 0.9) * 100;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}
