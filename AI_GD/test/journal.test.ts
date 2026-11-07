import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { logEvent, finalizeJournal } from "../src/server/journal.ts";

describe("append-only event journaling", () => {
  const testId = `test-journal-${Date.now()}`;
  const journalDir = path.join(process.cwd(), "data", "journal");

  after(() => {
    // Clean up test files
    const jsonl = path.join(journalDir, `${testId}.jsonl`);
    const finalJson = path.join(journalDir, `${testId}.final.json`);
    try { fs.unlinkSync(jsonl); } catch {}
    try { fs.unlinkSync(finalJson); } catch {}
  });

  it("appends structured events to .jsonl file", async () => {
    logEvent(testId, "join", { userId: "user-1", name: "Alice" });
    logEvent(testId, "speech", { userId: "user-1", text: "Hello everyone" });

    const jsonlPath = path.join(journalDir, `${testId}.jsonl`);
    const deadline = Date.now() + 2000;
    let content: string[] = [];
    while (Date.now() < deadline) {
      if (fs.existsSync(jsonlPath)) {
        content = fs.readFileSync(jsonlPath, "utf8").trim().split("\n");
        if (content.length === 2) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.ok(fs.existsSync(jsonlPath));
    assert.equal(content.length, 2);

    const event1 = JSON.parse(content[0]);
    assert.equal(event1.type, "join");
    assert.equal(event1.userId, "user-1");

    const event2 = JSON.parse(content[1]);
    assert.equal(event2.type, "speech");
    assert.equal(event2.text, "Hello everyone");
  });

  it("writes atomic final snapshot file", () => {
    const summary = {
      topic: "Future of AI",
      participants: 3,
      totalTurns: 12,
    };

    finalizeJournal(testId, summary);

    const finalPath = path.join(journalDir, `${testId}.final.json`);
    assert.ok(fs.existsSync(finalPath));

    const data = JSON.parse(fs.readFileSync(finalPath, "utf8"));
    assert.equal(data.topic, "Future of AI");
    assert.equal(data.totalTurns, 12);

    // Verify temp file was cleaned up
    assert.equal(fs.existsSync(`${finalPath}.tmp`), false);
  });
});
