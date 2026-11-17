import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_BURST_MS, voiceStart, voiceStop, type VoiceClock } from "../src/server/speakingClock.ts";
import { reportFilename } from "../src/server/reportPdf.ts";
import { createRealtimeBuckets, take } from "../src/server/rateLimit.ts";

describe("speaking clock", () => {
  it("credits the real length of a burst when it ends", () => {
    const clock: VoiceClock = new Map();
    voiceStart(clock, "a", 1_000);
    assert.equal(voiceStop(clock, "a", 7_500), 6_500);
  });

  it("adds up several bursts, so six lines are not three seconds", () => {
    const clock: VoiceClock = new Map();
    let total = 0;
    for (let i = 0; i < 6; i += 1) {
      voiceStart(clock, "a", i * 20_000);
      total += voiceStop(clock, "a", i * 20_000 + 4_000);
    }
    assert.equal(total, 24_000);
  });

  it("ignores a repeated start and a stop with no start", () => {
    const clock: VoiceClock = new Map();
    voiceStart(clock, "a", 1_000);
    voiceStart(clock, "a", 3_000); // does not restart the clock
    assert.equal(voiceStop(clock, "a", 5_000), 4_000);
    assert.equal(voiceStop(clock, "a", 9_000), 0);
  });

  it("caps a stuck 'speaking' flag", () => {
    const clock: VoiceClock = new Map();
    voiceStart(clock, "a", 0);
    assert.equal(voiceStop(clock, "a", 10 * 60_000), MAX_BURST_MS);
  });

  it("keeps people separate", () => {
    const clock: VoiceClock = new Map();
    voiceStart(clock, "a", 0);
    voiceStart(clock, "b", 2_000);
    assert.equal(voiceStop(clock, "b", 5_000), 3_000);
    assert.equal(voiceStop(clock, "a", 6_000), 6_000);
  });
});

describe("report file names", () => {
  it("differs for each person so a host can save them side by side", () => {
    const a = reportFilename("ABC-123", "INDIVIDUAL", "Aarav Sharma");
    const b = reportFilename("ABC-123", "INDIVIDUAL", "Meera Rao");
    assert.equal(a, "quorum-abc-123-individual-aarav-sharma.pdf");
    assert.notEqual(a, b);
  });

  it("has no person for group reports and is safe on every system", () => {
    assert.equal(reportFilename("ABC-123", "COMBINED"), "quorum-abc-123-combined.pdf");
    assert.match(reportFilename("x/y", "TRANSCRIPT", "../../etc: José \"Q\""), /^[a-z0-9.-]+$/);
  });
});

describe("live caption rate limit", () => {
  it("allows normal captions but stops a flood", () => {
    const { interim } = createRealtimeBuckets();
    let allowed = 0;
    for (let i = 0; i < 100; i += 1) if (take(interim)) allowed += 1;
    assert.ok(allowed >= 10 && allowed <= 14);
  });
});
