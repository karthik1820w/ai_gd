import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { consumeHand, dropRoom, handQueue, otherSpeaker, room, setPresence, speakStart, speakStop, clearPresence } from "../src/server/activity.ts";
import { AUTO_END_SPEAKER_GRACE_MS, FIRST_INVITE_AFTER_MS, HOST_AWAY_GRACE_MS, INVITE_AFTER_MS, nextHostWatch, secondsUntilInvite, shouldAutoEnd, type HostWatch } from "../src/lib/floor.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const media = (socketId: string, over: Partial<{ audio: boolean; hand: boolean }> = {}) => ({ socketId, audio: false, video: false, hand: false, screen: false, connected: true, ...over });

describe("hand queue: first raised, first served", () => {
  const id = "test-hand-queue";
  beforeEach(() => {
    dropRoom(id);
    for (const user of ["a", "b", "c"]) setPresence(id, user, media(`s-${user}`));
  });

  it("orders people by when their hand first went up", async () => {
    setPresence(id, "b", media("s-b", { hand: true }));
    await wait(5);
    setPresence(id, "c", media("s-c", { hand: true }));
    await wait(5);
    setPresence(id, "a", media("s-a", { hand: true }));
    assert.deepEqual(handQueue(id).map((entry) => entry.userId), ["b", "c", "a"]);
  });

  it("never moves someone back when their media state is re-sent", async () => {
    setPresence(id, "b", media("s-b", { hand: true }));
    await wait(5);
    setPresence(id, "c", media("s-c", { hand: true }));
    await wait(5);
    // b toggles their microphone: the hand is still up, and the place is kept.
    setPresence(id, "b", media("s-b", { hand: true, audio: true }));
    assert.deepEqual(handQueue(id).map((entry) => entry.userId), ["b", "c"]);
  });

  it("drops a person who lowers their hand, and lets them rejoin at the back", async () => {
    setPresence(id, "b", media("s-b", { hand: true }));
    await wait(5);
    setPresence(id, "c", media("s-c", { hand: true }));
    setPresence(id, "b", media("s-b", { hand: false }));
    assert.deepEqual(handQueue(id).map((entry) => entry.userId), ["c"]);
    await wait(5);
    setPresence(id, "b", media("s-b", { hand: true }));
    assert.deepEqual(handQueue(id).map((entry) => entry.userId), ["c", "b"]);
  });

  it("removes people who leave the room", () => {
    setPresence(id, "b", media("s-b", { hand: true }));
    clearPresence(id, "b", "s-b");
    assert.deepEqual(handQueue(id), []);
  });

  it("consumeHand lowers the hand and reports whether one was up", () => {
    setPresence(id, "b", media("s-b", { hand: true }));
    assert.equal(consumeHand(id, "b"), true);
    assert.deepEqual(handQueue(id), []);
    assert.equal(room(id).presence.get("b")?.hand, false);
    assert.equal(consumeHand(id, "b"), false);
  });
});

describe("nobody talks over a speaker", () => {
  const id = "test-no-interrupt";
  beforeEach(() => {
    dropRoom(id);
    for (const user of ["a", "b"]) setPresence(id, user, media(`s-${user}`, { audio: true }));
  });

  it("reports the person holding the floor to everyone else, never to themselves", () => {
    speakStart(id, "a");
    assert.equal(otherSpeaker(id, "b"), "a");
    assert.equal(otherSpeaker(id, "a"), null);
  });

  it("is free again once the speaker stops", () => {
    speakStart(id, "a");
    speakStop(id, "a");
    assert.equal(otherSpeaker(id, "b"), null);
  });

  it("is free if the speaker disconnects", () => {
    speakStart(id, "a");
    clearPresence(id, "a", "s-a");
    assert.equal(otherSpeaker(id, "b"), null);
  });
});

describe("floor timing", () => {
  it("invites someone after the floor has been open for 5 seconds", () => {
    assert.equal(INVITE_AFTER_MS, 5_000);
    assert.equal(secondsUntilInvite(1_000, 3_000), 3);
    assert.equal(secondsUntilInvite(1_000, 6_000), 0);
  });

  it("keeps the other timings sensible", () => {
    assert.ok(FIRST_INVITE_AFTER_MS >= INVITE_AFTER_MS);
    assert.ok(HOST_AWAY_GRACE_MS >= 5_000, "a network blink must not count as the host leaving");
    assert.ok(AUTO_END_SPEAKER_GRACE_MS <= 60_000, "a speaker may finish a sentence, not a speech");
  });
});

describe("automatic end when time is up", () => {
  const start = 1_000_000;
  const base = { startedAt: start, durationMin: 10, someoneSpeaking: false };

  it("does not end early", () => {
    assert.equal(shouldAutoEnd({ ...base, now: start + 10 * 60_000 - 1 }), false);
  });

  it("ends the moment the time is up", () => {
    assert.equal(shouldAutoEnd({ ...base, now: start + 10 * 60_000 }), true);
  });

  it("lets a speaker finish, but only for a few seconds", () => {
    const over = start + 10 * 60_000;
    assert.equal(shouldAutoEnd({ ...base, someoneSpeaking: true, now: over + 5_000 }), false);
    assert.equal(shouldAutoEnd({ ...base, someoneSpeaking: true, now: over + AUTO_END_SPEAKER_GRACE_MS }), true);
  });

  it("never ends a discussion that has not started", () => {
    assert.equal(shouldAutoEnd({ ...base, startedAt: null, now: start + 99 * 60_000 }), false);
  });
});

describe("host drops out: the AI takes over, the meeting goes on", () => {
  const present: HostWatch = { missingSince: null, away: false };

  it("a short blink is not an absence", () => {
    let watch = nextHostWatch(present, false, 1_000);
    assert.equal(watch.away, false);
    watch = nextHostWatch(watch, true, 1_000 + HOST_AWAY_GRACE_MS - 1);
    assert.equal(watch.away, false);
    assert.equal(watch.changed, false);
  });

  it("the AI takes over once the host has been gone past the grace period", () => {
    let watch = nextHostWatch(present, false, 1_000);
    watch = nextHostWatch(watch, false, 1_000 + HOST_AWAY_GRACE_MS);
    assert.equal(watch.away, true);
    assert.equal(watch.changed, true);
  });

  it("only reports the change once, then stays away until the host is back", () => {
    let watch: HostWatch & { changed: boolean } = nextHostWatch(present, false, 0);
    watch = nextHostWatch(watch, false, HOST_AWAY_GRACE_MS);
    watch = nextHostWatch(watch, false, HOST_AWAY_GRACE_MS + 60_000);
    assert.equal(watch.away, true);
    assert.equal(watch.changed, false);
  });

  it("hands back when the host returns", () => {
    let watch: HostWatch & { changed: boolean } = nextHostWatch(present, false, 0);
    watch = nextHostWatch(watch, false, HOST_AWAY_GRACE_MS);
    watch = nextHostWatch(watch, true, HOST_AWAY_GRACE_MS + 5_000);
    assert.equal(watch.away, false);
    assert.equal(watch.changed, true);
    assert.equal(watch.missingSince, null);
  });
});
