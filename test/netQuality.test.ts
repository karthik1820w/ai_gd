import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMeter, sample, classify } from "../src/server/netQuality.ts";

describe("network quality meter", () => {
  it("classifies RTT and packet loss thresholds correctly", () => {
    assert.equal(classify(50, 0), "good");
    assert.equal(classify(250, 0.01), "fair");
    assert.equal(classify(100, 0.05), "fair");
    assert.equal(classify(450, 0.01), "poor");
    assert.equal(classify(100, 0.12), "poor");
  });

  it("degrades to fair or poor after 2 consecutive samples", () => {
    const meter = createMeter();
    assert.equal(meter.level, "good");

    // First poor sample: pending changes but level stays good
    const res1 = sample(meter, { rtt: 900, loss: 0.2 });
    assert.equal(res1, null);
    assert.equal(meter.level, "good");

    // Second poor sample: threshold (2) reached, level changes to poor
    const res2 = sample(meter, { rtt: 900, loss: 0.2 });
    assert.equal(res2, "poor");
    assert.equal(meter.level, "poor");
  });

  it("recovers to good only after sustained good samples (EWMA + hysteresis)", () => {
    const meter = createMeter();
    sample(meter, { rtt: 900, loss: 0.2 });
    sample(meter, { rtt: 900, loss: 0.2 });
    assert.equal(meter.level, "poor");

    // One good sample should NOT immediately recover
    assert.equal(sample(meter, { rtt: 20, loss: 0 }), null);
    assert.equal(meter.level, "poor");

    // Repeated healthy samples allow EWMA to drop and 5-streak threshold to be met
    let recovered: string | null = null;
    for (let i = 0; i < 12 && !recovered; i++) {
      recovered = sample(meter, { rtt: 20, loss: 0 });
    }
    assert.equal(recovered, "good");
    assert.equal(meter.level, "good");
  });
});
