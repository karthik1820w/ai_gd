import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { complete } from "../src/server/ai.ts";
import { taskPrompt } from "../src/server/aiPrompts.ts";

function geminiResponse(text: string, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  }), { status, headers });
}

describe("Gemini REST client", () => {
  it("uses the server key, configured flash model, JSON mode, and strips response fences", async () => {
    const savedFetch = globalThis.fetch;
    const saved = {
      AI_ENABLED: process.env.AI_ENABLED,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GEMINI_FLASH_API_KEY: process.env.GEMINI_FLASH_API_KEY,
      GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
      GEMINI_FLASH_MODEL: process.env.GEMINI_FLASH_MODEL,
      GEMINI_FINAL_MODEL: process.env.GEMINI_FINAL_MODEL,
    };
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    process.env.AI_ENABLED = "on";
    process.env.GEMINI_API_KEY = "server-test-key";
    delete process.env.GEMINI_FLASH_API_KEY;
    process.env.GEMINI_BASE_URL = "https://gemini.test";
    process.env.GEMINI_FLASH_MODEL = "gemini-2.5-flash";
    process.env.GEMINI_FINAL_MODEL = "gemini-final-test";
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return geminiResponse("```json\n{\"ok\":true}\n```");
    }) as typeof fetch;
    try {
      const result = await complete(taskPrompt("UTTERANCE", "Analyze a statement."), "text");
      assert.equal(result, "{\"ok\":true}");
      assert.match(requestUrl, /\/v1beta\/models\/gemini-2\.5-flash:generateContent$/);
      assert.equal(new Headers(requestInit?.headers).get("x-goog-api-key"), "server-test-key");
      const body = JSON.parse(String(requestInit?.body)) as {
        systemInstruction: { parts: Array<{ text: string }> };
        generationConfig: { responseMimeType: string; thinkingConfig?: { thinkingBudget: number } };
      };
      assert.match(body.systemInstruction.parts[0].text, /SECURITY:/);
      assert.equal(body.generationConfig.responseMimeType, "application/json");
      assert.equal(body.generationConfig.thinkingConfig?.thinkingBudget, 0);
    } finally {
      globalThis.fetch = savedFetch;
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("retries transient server errors but does not retry other client errors", async () => {
    const savedFetch = globalThis.fetch;
    const savedKey = process.env.GEMINI_API_KEY;
    const savedAI = process.env.AI_ENABLED;
    process.env.AI_ENABLED = "on";
    process.env.GEMINI_API_KEY = "server-test-key";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? geminiResponse("", 500, { "Retry-After": "0" })
        : geminiResponse("{\"ok\":true}");
    }) as typeof fetch;
    try {
      assert.equal(await complete(taskPrompt("BRIEF", "Make a brief."), "topic"), "{\"ok\":true}");
      assert.equal(calls, 2);
      calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return geminiResponse("", 400);
      }) as typeof fetch;
      await assert.rejects(complete(taskPrompt("BRIEF", "Make a brief."), "topic"), /400/);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = savedFetch;
      if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = savedKey;
      if (savedAI === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = savedAI;
    }
  });

  it("does not call Gemini when AI is explicitly disabled", async () => {
    const savedAI = process.env.AI_ENABLED;
    process.env.AI_ENABLED = "off";
    try {
      assert.equal(await complete(taskPrompt("ANSWER", "Answer."), "question"), null);
    } finally {
      if (savedAI === undefined) delete process.env.AI_ENABLED;
      else process.env.AI_ENABLED = savedAI;
    }
  });
});
