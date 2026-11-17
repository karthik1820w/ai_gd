import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSpeakingDetector } from "../src/lib/speakingDetector.ts";

describe("local speaking detector", () => {
  it("requires sustained audio to start and sustained quiet to stop", () => {
    const detector = createSpeakingDetector();
    assert.equal(detector.update(0.08, true, 0), null);
    assert.equal(detector.update(0.08, true, 149), null);
    assert.equal(detector.update(0.08, true, 150), true);
    assert.equal(detector.update(0, true, 200), null);
    assert.equal(detector.update(0, true, 799), null);
    assert.equal(detector.update(0, true, 800), false);
  });

  it("emits no more than twice per second and does not repeat unchanged state", () => {
    const detector = createSpeakingDetector({ attackMs: 0, releaseMs: 0 });
    assert.equal(detector.update(0.08, true, 0), true);
    assert.equal(detector.update(0, true, 100), null);
    assert.equal(detector.update(0, true, 499), null);
    assert.equal(detector.update(0, true, 500), false);
    assert.equal(detector.update(0, true, 900), null);
  });

  it("transitions to quiet when the microphone is disabled", () => {
    const detector = createSpeakingDetector({ attackMs: 0, releaseMs: 0 });
    assert.equal(detector.update(0.08, true, 0), true);
    assert.equal(detector.update(0.08, false, 500), false);
  });
});
