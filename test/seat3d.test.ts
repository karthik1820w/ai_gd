import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLayoutMode, LAYOUTS, ringPositions } from "../src/lib/stageLayout.ts";
import { seatName, shortTime } from "../src/components/meeting/seatLabel.ts";
import {
  ACCESSORIES, appearanceFor, damp, FOCUS_DISTANCE, focusPose, fovForAspect, HAIR_COLORS, HAIR_STYLES, HEAD_HEIGHT,
  initialTier, labelDensity, MIN_RING_RADIUS, nextTier, overviewPose, ringRadius, SEAT_SPACING, SHIRT_COLORS, seatWorldPositions, SKIN_TONES,
} from "../src/components/meeting/table3d/seat3d.ts";

const COUNTS = [0, 1, 2, 3, 6, 12, 40];

describe("3D table seating", () => {
  it("puts every seat on the ring, with no NaN", () => {
    for (const count of COUNTS) {
      for (const seat of seatWorldPositions(count, count > 1 ? 1 : null)) {
        assert.ok(Number.isFinite(seat.x) && Number.isFinite(seat.z) && Number.isFinite(seat.yaw));
        assert.ok(Math.abs(Math.hypot(seat.x, seat.z) - ringRadius(count)) < 1e-9);
      }
    }
  });

  it("returns nothing for an empty table", () => {
    assert.deepEqual(seatWorldPositions(0, null), []);
  });

  it("puts the viewer's own seat nearest the camera (+z), like the 2D round table", () => {
    for (const count of [2, 3, 6, 12, 40]) {
      for (const self of [0, 1, count - 1]) {
        const seats = seatWorldPositions(count, self);
        assert.ok(seats[self].z > 0, `count ${count}, self ${self}`);
        assert.ok(Math.abs(seats[self].x) < 1e-9);
      }
    }
  });

  it("uses the same cyclic order as ringPositions", () => {
    const flat = ringPositions(7, 3);
    const world = seatWorldPositions(7, 3);
    flat.forEach((point, index) => {
      const angle2d = Math.atan2(point.y - 50, point.x - 50);
      const angle3d = Math.atan2(world[index].z, world[index].x);
      assert.ok(Math.abs(Math.atan2(Math.sin(angle2d - angle3d), Math.cos(angle2d - angle3d))) < 1e-9);
    });
  });

  it("keeps neighbours at least the minimum spacing apart", () => {
    for (const count of [2, 3, 6, 12, 25, 40]) {
      const seats = seatWorldPositions(count, 0);
      for (let i = 0; i < count; i += 1) {
        const next = seats[(i + 1) % count];
        assert.ok(Math.hypot(seats[i].x - next.x, seats[i].z - next.z) >= SEAT_SPACING - 1e-6, `count ${count}`);
      }
    }
  });

  it("never shrinks the ring as people arrive", () => {
    let previous = 0;
    for (let count = 0; count <= 40; count += 1) {
      const radius = ringRadius(count);
      assert.ok(radius >= previous && radius >= MIN_RING_RADIUS);
      previous = radius;
    }
  });

  it("turns every character to face the table centre", () => {
    for (const seat of seatWorldPositions(9, 4)) {
      const forward = { x: Math.sin(seat.yaw), z: Math.cos(seat.yaw) };
      const toCentre = { x: -seat.x / Math.hypot(seat.x, seat.z), z: -seat.z / Math.hypot(seat.x, seat.z) };
      assert.ok(Math.abs(forward.x - toCentre.x) < 1e-9 && Math.abs(forward.z - toCentre.z) < 1e-9);
    }
  });
});

describe("3D table camera", () => {
  it("frames the whole table from the viewer's side, further back as it grows", () => {
    const small = overviewPose(4);
    const large = overviewPose(40);
    assert.ok(small.position[2] > 0 && small.position[1] > 0);
    assert.ok(large.position[2] > small.position[2]);
    assert.ok(small.position.every(Number.isFinite) && small.target.every(Number.isFinite));
  });

  it("looks at the speaker's face from a fixed distance, above head height, from the table side", () => {
    for (const count of [1, 2, 6, 40]) {
      for (const seat of seatWorldPositions(count, count > 1 ? 0 : null)) {
        const pose = focusPose(seat);
        assert.ok(pose.position.every(Number.isFinite) && pose.target.every(Number.isFinite));
        assert.ok(pose.position[1] > HEAD_HEIGHT);
        assert.equal(pose.target[1], HEAD_HEIGHT);
        const horizontal = Math.hypot(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2]);
        assert.ok(Math.abs(horizontal - FOCUS_DISTANCE) < 1e-9);
        // The camera is closer to the table centre than the speaker is.
        assert.ok(Math.hypot(pose.position[0], pose.position[2]) < Math.hypot(seat.x, seat.z));
      }
    }
  });

  it("damps towards the target without overshooting, at any frame rate", () => {
    let value = 0;
    for (let i = 0; i < 20; i += 1) {
      const next = damp(value, 10, 4.5, 1 / 60);
      assert.ok(next > value && next < 10);
      value = next;
    }
    const slow = damp(damp(0, 10, 4.5, 1 / 30), 10, 4.5, 1 / 30);
    const fast = damp(damp(damp(damp(0, 10, 4.5, 1 / 60), 10, 4.5, 1 / 60), 10, 4.5, 1 / 60), 10, 4.5, 1 / 60);
    assert.ok(Math.abs(slow - fast) < 1e-9);
  });

  it("widens the field of view on tall screens", () => {
    assert.equal(fovForAspect(1.6), 40);
    assert.ok(fovForAspect(0.8) > fovForAspect(1.2));
    assert.ok(fovForAspect(0.1) <= 72);
    assert.equal(fovForAspect(Number.NaN), 40);
  });
});

describe("3D table characters", () => {
  it("gives the same person the same look every time", () => {
    for (const id of ["u1", "a-long-user-id-123", ""]) assert.deepEqual(appearanceFor(id), appearanceFor(id));
    assert.notDeepEqual(appearanceFor("alice"), appearanceFor("bob"));
  });

  it("does not depend on the display name, only on the user id", () => {
    assert.equal(appearanceFor("same-id").skin, appearanceFor("same-id").skin);
  });

  it("uses every palette entry, none of them rarely", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `user-${i}-${(i * 7919) % 10007}`);
    const looks = ids.map(appearanceFor);
    const check = (palette: readonly string[], read: (look: ReturnType<typeof appearanceFor>) => string) => {
      for (const entry of new Set(palette)) {
        const share = looks.filter((look) => read(look) === entry).length / looks.length;
        assert.ok(share >= 0.02, `${entry} used ${(share * 100).toFixed(1)}%`);
      }
    };
    check(SKIN_TONES, (look) => look.skin);
    check(HAIR_COLORS, (look) => look.hair);
    check(SHIRT_COLORS, (look) => look.shirt);
    check(HAIR_STYLES, (look) => look.hairStyle);
    check(ACCESSORIES, (look) => look.accessory);
  });

  it("keeps the animation phase in 0 to 1", () => {
    for (let i = 0; i < 200; i += 1) {
      const { phase } = appearanceFor(`p${i}`);
      assert.ok(phase >= 0 && phase < 1);
    }
  });
});

describe("3D table label density", () => {
  it("thins the labels out as the room grows", () => {
    assert.equal(labelDensity(0), "full");
    assert.equal(labelDensity(12), "full");
    assert.equal(labelDensity(13), "compact");
    assert.equal(labelDensity(24), "compact");
    assert.equal(labelDensity(25), "dense");
    assert.equal(labelDensity(40), "dense");
  });
});

describe("3D table quality tiers", () => {
  it("starts big tables on a cheaper tier", () => {
    assert.equal(initialTier(6), "high");
    assert.equal(initialTier(16), "high");
    assert.equal(initialTier(17), "medium");
  });

  it("steps down on slow frames and never back up", () => {
    assert.equal(nextTier("high", 16), "high");
    assert.equal(nextTier("high", 30), "medium");
    assert.equal(nextTier("medium", 30), "low");
    assert.equal(nextTier("low", 30), "low");
    assert.equal(nextTier("medium", 10), "medium");
  });
});

describe("the fourth layout", () => {
  it("is a valid layout and is listed with the other three", () => {
    assert.equal(isLayoutMode("table3d"), true);
    assert.equal(isLayoutMode("nope"), false);
    assert.equal(LAYOUTS.length, 4);
    assert.ok(LAYOUTS.some((layout) => layout.id === "table3d" && layout.label === "3D table"));
  });

  it("keeps the three saved values from before valid", () => {
    for (const old of ["round", "speaker", "gallery"]) assert.equal(isLayoutMode(old), true);
  });
});

describe("seat labels shared by 2D and 3D", () => {
  it("formats talk time", () => {
    assert.equal(shortTime(0), "0s");
    assert.equal(shortTime(59_999), "59s");
    assert.equal(shortTime(65_000), "1:05");
  });

  it("marks the viewer and the host, unless the name already says host", () => {
    assert.equal(seatName({ name: "Meera", isSelf: true, isHost: false }), "Meera (you)");
    assert.equal(seatName({ name: "Ravi", isSelf: false, isHost: true }), "Ravi · host");
    assert.equal(seatName({ name: "Host", isSelf: false, isHost: true }), "Host");
  });
});
