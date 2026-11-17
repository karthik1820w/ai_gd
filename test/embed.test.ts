import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { embed, cosine, embedAsync } from "../src/server/embed.ts";

describe("hashed bag-of-words embedding", () => {
  it("produces a 256-dimensional unit vector", () => {
    const v = embed("Artificial intelligence in higher education systems");
    assert.equal(v.length, 256);
    const norm = Math.hypot(...v);
    assert.ok(Math.abs(norm - 1.0) < 1e-4);
  });

  it("yields higher cosine similarity for on-topic text than off-topic text", () => {
    const topic = embed("regulation of artificial intelligence bias safety");
    const onTopic = embed("Regulation reduces bias and improves safety");
    const offTopic = embed("My favourite pizza has mushrooms");

    const simOn = cosine(onTopic, topic);
    const simOff = cosine(offTopic, topic);

    assert.ok(simOn > simOff);
    assert.ok(Math.abs(cosine(topic, topic) - 1.0) < 1e-9);
  });

  it("uses Gemini embeddings when valid and falls back when broken", async () => {
    const mockVec = Array.from({ length: 256 }, (_, i) => (i === 7 ? 3 : 0));
    let mode = "good";
    let requestUrl = "";
    let requestInit: RequestInit | undefined;

    const mockFetch = (async (url: any, init: any) => {
      requestUrl = String(url);
      requestInit = init;
      if (mode === "good") {
        return {
          ok: true,
          json: async () => ({ embedding: { values: mockVec } }),
        } as Response;
      }
      throw new Error("endpoint failed");
    }) as unknown as typeof fetch;

    const previousKey = process.env.GEMINI_API_KEY;
    const previousAIEnabled = process.env.AI_ENABLED;
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.AI_ENABLED;

    try {
      const v = await embedAsync("hello world", mockFetch);
      assert.equal(v[7], 1); // Normalized (3 / 3 = 1)
      assert.match(requestUrl, /gemini-embedding-001:embedContent$/);
      assert.equal(new Headers(requestInit?.headers).get("x-goog-api-key"), "test-key");

      mode = "bad";
      const fallback = await embedAsync("hello world", mockFetch);
      assert.equal(fallback.length, 256);
      assert.ok(Math.abs(Math.hypot(...fallback) - 1) < 1e-4);
      assert.notEqual(fallback[7], 1); // Local hash fallback
    } finally {
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
      if (previousAIEnabled === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = previousAIEnabled;
    }
  });
});
