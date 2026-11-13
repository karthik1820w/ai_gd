import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FocusTracker, ringPositions, seatOrder, seatSizePercent, talkFill } from "../src/lib/stageLayout.ts";

describe("ring seating", () => {
  it("places every seat on the circle, inside the table", () => {
    for (const n of [1, 2, 3, 6, 12, 40]) {
      for (const p of ringPositions(n)) {
        assert.ok(Math.abs(Math.hypot(p.x - 50, p.y - 50) - 38) < 1e-9);
        assert.ok(p.x > 0 && p.x < 100 && p.y > 0 && p.y < 100);
      }
    }
  });
  it("puts the viewer's own seat at the bottom", () => {
    const seats = ringPositions(5, 2);
    assert.ok(Math.abs(seats[2].x - 50) < 1e-9 && seats[2].y > 50);
  });
  it("puts the first seat at the top for the unseated host", () => {
    const seats = ringPositions(4);
    assert.ok(Math.abs(seats[0].x - 50) < 1e-9 && seats[0].y < 50);
  });
  it("never overlaps neighbouring seats", () => {
    for (const n of [2, 3, 4, 6, 8, 12, 20, 40]) {
      const seats = ringPositions(n);
      const size = seatSizePercent(n);
      for (let i = 0; i < n; i++) {
        const next = seats[(i + 1) % n];
        if (n === 1) continue;
        const gap = Math.hypot(seats[i].x - next.x, seats[i].y - next.y);
        assert.ok(gap >= size * 0.95, `n=${n}: gap ${gap.toFixed(1)} < seat ${size}`);
      }
    }
  });
  it("orders seats identically for everyone", () => {
    const a = seatOrder([{ userId: "c" }, { userId: "a" }, { userId: "b" }]).map((p) => p.userId);
    assert.deepEqual(a, ["a", "b", "c"]);
  });
  it("is empty for no one", () => assert.deepEqual(ringPositions(0), []));
});

describe("talk-time ring", () => {
  it("is empty for a silent person and full at a fair share", () => {
    assert.equal(talkFill(0, 60_000, 3), 0);
    assert.equal(talkFill(20_000, 60_000, 3), 1);
    assert.equal(talkFill(10_000, 60_000, 3), 0.5);
    assert.equal(talkFill(50_000, 60_000, 3), 1);
    assert.equal(talkFill(0, 0, 3), 0);
  });
});

describe("speaker takes the centre", () => {
  it("centres a speaker after a moment, and holds it briefly after they stop", () => {
    const t = new FocusTracker(1500, 400);
    assert.equal(t.update(new Set(["a"]), 0), null);          // just started: not yet
    assert.equal(t.update(new Set(["a"]), 500), "a");         // sustained: centred
    assert.equal(t.update(new Set(), 1200), "a");             // stopped 700 ms ago: held
    assert.equal(t.update(new Set(), 2300), null);            // 1.8 s of quiet: released
  });
  it("ignores a brief interruption from someone else", () => {
    const t = new FocusTracker(1500, 400);
    t.update(new Set(["a"]), 0); t.update(new Set(["a"]), 500);
    assert.equal(t.update(new Set(["a", "b"]), 600), "a");    // a still speaking: keeps the centre
    assert.equal(t.update(new Set(["b"]), 700), "a");         // b only just started
    assert.equal(t.update(new Set(["b"]), 1200), "b");        // b sustained: takes over
  });
  it("does not let a one-off blip steal the centre", () => {
    const t = new FocusTracker(1500, 400);
    t.update(new Set(["a"]), 0); t.update(new Set(["a"]), 500);
    t.update(new Set(), 600);
    assert.equal(t.update(new Set(["b"]), 700), "a");
    assert.equal(t.update(new Set(), 800), "a");              // b's blip ended before taking over
  });
});
