import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  room,
  dropRoom,
  speakStart,
  speakStop,
  raiseHand,
  lowerHand,
  checkFloorTimeout,
  setPresence,
} from "../src/server/activity.ts";

describe("authoritative floor controller & end-of-turn detection", () => {
  const dId = "test-discussion-floor";

  beforeEach(() => {
    dropRoom(dId);
    // Setup 2 participants
    setPresence(dId, "user-A", { socketId: "s-a", audio: true, video: true, hand: false, screen: false, connected: true });
    setPresence(dId, "user-B", { socketId: "s-b", audio: true, video: true, hand: false, screen: false, connected: true });
  });

  it("grants floor to first speaker and rejects simultaneous floor takeover", () => {
    // User A takes the floor
    const okA = speakStart(dId, "user-A");
    assert.equal(okA, true);

    const r = room(dId);
    assert.equal(r.floor?.userId, "user-A");

    // User B tries to take the floor while User A is speaking -> REJECTED
    const okB = speakStart(dId, "user-B");
    assert.equal(okB, false);
    assert.equal(r.floor?.userId, "user-A");
  });

  it("releases floor cleanly when speaker finishes", () => {
    speakStart(dId, "user-A");
    assert.equal(room(dId).floor?.userId, "user-A");

    const stopped = speakStop(dId, "user-A");
    assert.equal(stopped, true);
    assert.equal(room(dId).floor, null);

    // Now User B can take the floor
    const okB = speakStart(dId, "user-B");
    assert.equal(okB, true);
    assert.equal(room(dId).floor?.userId, "user-B");
  });

  it("manages hand raising priority and clears hand when floor is granted", () => {
    raiseHand(dId, "user-B");
    raiseHand(dId, "user-A");

    const r = room(dId);
    assert.deepEqual(r.hands, ["user-B", "user-A"]);

    // When User B speaks, their hand is lowered automatically
    speakStart(dId, "user-B");
    assert.deepEqual(r.hands, ["user-A"]);

    lowerHand(dId, "user-A");
    assert.deepEqual(r.hands, []);
  });

  it("auto-releases silent floor holder after timeout (end-of-turn detection)", async () => {
    speakStart(dId, "user-A");
    assert.equal(room(dId).floor?.userId, "user-A");

    // Immediately check: should not time out
    const releasedImmediately = checkFloorTimeout(dId, 50);
    assert.equal(releasedImmediately, null);
    assert.equal(room(dId).floor?.userId, "user-A");

    // Wait 60ms and check with 50ms timeout threshold
    await new Promise((resolve) => setTimeout(resolve, 60));
    const releasedTimedOut = checkFloorTimeout(dId, 50);
    assert.equal(releasedTimedOut, "user-A");
    assert.equal(room(dId).floor, null); // Floor is now free!
  });
});

