// 256-dimensional signed feature hashing vectorizer (dependency-free)
// with cosine similarity and optional external embedding model endpoint.

const D = 256;
const STOP = new Set(
  "the and for are was but not you with this that have has from they will would there their what about which when your can its into than them then these those been were a an in of to on is at by".split(
    " ",
  ),
);

/**
 * Computes a deterministic 256-dimensional signed feature hashing embedding vector.
 * L2-normalized so dot product equals cosine similarity.
 */
export function embed(text: string): number[] {
  const v = new Array(D).fill(0);
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) || [];

  for (const w of words) {
    if (w.length < 3 || STOP.has(w)) continue;
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[(h >>> 0) % D] += (h >>> 16) & 1 ? 1 : -1;
  }

  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/**
 * Cosine similarity between two L2-normalized vectors.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  return a.reduce((sum, val, idx) => sum + val * b[idx], 0);
}

/**
 * Asynchronous embedding: attempts to query an external OpenAI-compatible
 * embeddings endpoint if EMBEDDINGS_URL is set, falling back seamlessly
 * to the internal hashed embedding.
 */
export async function embedAsync(text: string, fetchFn = fetch): Promise<number[]> {
  const url = process.env.EMBEDDINGS_URL;
  if (!url) return embed(text);

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.EMBEDDINGS_KEY ? { authorization: `Bearer ${process.env.EMBEDDINGS_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: process.env.EMBEDDINGS_MODEL || "text-embedding-3-small",
        input: text,
        dimensions: D,
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      const data = await res.json();
      const v = data?.data?.[0]?.embedding;
      if (Array.isArray(v) && v.length === D) {
        const norm = Math.hypot(...v) || 1;
        return v.map((x) => x / norm);
      }
    }
  } catch {
    // Fall back to local hash embedding
  }

  return embed(text);
}

/**
 * Computes semantic similarity (0 to 100) between an utterance and the discussion topic.
 */
export async function semanticRelevance(text: string, topicText: string): Promise<number> {
  const [vecText, vecTopic] = await Promise.all([embedAsync(text), embedAsync(topicText)]);
  const sim = cosine(vecText, vecTopic);
  // Map [-0.2, 0.8] range to [0, 100]
  const scaled = ((sim + 0.1) / 0.9) * 100;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}
