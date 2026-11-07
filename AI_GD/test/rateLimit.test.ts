import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBucket, take } from "../src/server/rateLimit.ts";

describe("token bucket rate limiter", () => {
  it("allows bursts up to capacity", () => {
    const bucket = createBucket(10, 5); // capacity: 5
    for (let i = 0; i < 5; i++) {
      assert.equal(take(bucket, 1), true);
    }
    // 6th take should be rejected immediately
    assert.equal(take(bucket, 1), false);
  });

  it("refills tokens over time", async () => {
    const bucket = createBucket(20, 2); // 20 tokens per sec, capacity 2
    assert.equal(take(bucket, 2), true);
    assert.equal(take(bucket, 1), false);

    // Wait 100ms: should have refilled ~2 tokens
    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(take(bucket, 1), true);
  });
});

