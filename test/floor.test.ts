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
  endFloor,
  setPresence,
  hasFloorAccess,
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

  it("keeps the floor across a short pause until an explicit end action", () => {
    speakStart(dId, "user-A");
    assert.equal(room(dId).floor?.userId, "user-A");

    const stopped = speakStop(dId, "user-A");
    assert.equal(stopped, true);
    assert.equal(room(dId).floor?.userId, "user-A");
    assert.equal(endFloor(dId, "user-A"), true);

    // Now User B can take the floor
    const okB = speakStart(dId, "user-B");
    assert.equal(okB, true);
    assert.equal(room(dId).floor?.userId, "user-B");
  });

  it("requires a current host or AI invitation before a participant can use the floor", () => {
    const live = room(dId);
    assert.equal(hasFloorAccess(dId, "user-A"), false);
    assert.equal(hasFloorAccess(dId, "user-A", true), true);

    live.invites.set("user-A", { participantId: "participant-A", until: 2_000, sawUnmute: false, windowSec: 20 });
    assert.equal(hasFloorAccess(dId, "user-A", false, 1_999), true);
    assert.equal(hasFloorAccess(dId, "user-A", false, 2_000), false);
  });

  it("lets the host take the floor while a participant is speaking", () => {
    assert.equal(speakStart(dId, "user-A"), true);
    assert.equal(speakStart(dId, "user-B", true), true);
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

  it("does not release a silent floor before the server turn timer expires", async () => {
    speakStart(dId, "user-A");
    assert.equal(room(dId).floor?.userId, "user-A");

    // Immediately check: should not time out
    const releasedImmediately = checkFloorTimeout(dId, 50);
    assert.equal(releasedImmediately, null);
    assert.equal(room(dId).floor?.userId, "user-A");

    room(dId).floor!.graceUntil = Date.now() - 1;
    const releasedTimedOut = checkFloorTimeout(dId);
    assert.equal(releasedTimedOut, "user-A");
    assert.equal(room(dId).floor, null); // Floor is now free!
  });
});

