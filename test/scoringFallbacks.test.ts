import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const scorePaths = ["../src/server/scoring.ts", "../src/server/aiScoring.ts", "../src/server/segments.ts", "../src/server/evaluate.ts"];

describe("score paths have no silent numeric fallback", () => {
  it("has no 55 participation assignment or 50/70 missing-score fallback", () => {
    const sources = scorePaths.map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
    assert.doesNotMatch(sources, /\bparticipation\s*=\s*55\b/);
    assert.doesNotMatch(sources, /\b(?:communication|knowledge|reasoning|understanding|originality)\w*\s*\?\?\s*(?:50|70)\b/);
    assert.doesNotMatch(sources, /\b(?:communication|knowledge|reasoning|understanding|originality)\s*:\s*[^,\n]*\?\?\s*(?:50|70)\b/);
  });

  it("does not render null criteria as zero-valued bars", () => {
    const report = readFileSync(new URL("../src/app/participant/reports/[id]/page.tsx", import.meta.url), "utf8");
    const liveResults = readFileSync(new URL("../src/components/meeting/Results.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(report, /parameter\.score\s*\?\?\s*0/);
    assert.doesNotMatch(liveResults, /parameter\.score\s*\?\?\s*0/);
    assert.match(report, /Not enough data/);
    assert.match(liveResults, /Not enough data/);
  });
});
