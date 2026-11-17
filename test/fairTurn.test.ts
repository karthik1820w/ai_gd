import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickNextSpeaker, INVITE_PENALTY_MS, type ParticipantTurnState } from "../src/server/fairTurn.ts";

describe("fair turn scheduler", () => {
  it("picks the participant with the least talk time", () => {
    const participants: ParticipantTurnState[] = [
      { id: "1", name: "Alice", talkMs: 25000, turns: 2, invites: 0, lastSpokeAt: 1000, online: true },
      { id: "2", name: "Bob", talkMs: 5000, turns: 1, invites: 0, lastSpokeAt: 2000, online: true },
      { id: "3", name: "Charlie", talkMs: 30000, turns: 3, invites: 0, lastSpokeAt: 3000, online: true },
    ];

    const next = pickNextSpeaker(participants);
    assert.equal(next?.id, "2");
  });

  it("applies invite penalty to avoid badgering the same quiet person", () => {
    const participants: ParticipantTurnState[] = [
      // Bob has spoken 0 ms but was invited twice: score = 0 + 2 * 8000 = 16000
      { id: "2", name: "Bob", talkMs: 0, turns: 0, invites: 2, lastSpokeAt: 0, online: true },
      // Alice has spoken 10000 ms with 0 invites: score = 10000
      { id: "1", name: "Alice", talkMs: 10000, turns: 1, invites: 0, lastSpokeAt: 5000, online: true },
    ];

    const next = pickNextSpeaker(participants);
    assert.equal(next?.id, "1");
  });

  it("ignores offline participants", () => {
    const participants: ParticipantTurnState[] = [
      { id: "1", name: "Alice", talkMs: 10000, turns: 1, invites: 0, lastSpokeAt: 5000, online: true },
      { id: "2", name: "Bob", talkMs: 0, turns: 0, invites: 0, lastSpokeAt: 0, online: false },
    ];

    const next = pickNextSpeaker(participants);
    assert.equal(next?.id, "1");
  });

  it("breaks ties with turns and then lastSpokeAt", () => {
    const participants: ParticipantTurnState[] = [
      { id: "1", name: "Alice", talkMs: 5000, turns: 2, invites: 0, lastSpokeAt: 1000, online: true },
      { id: "2", name: "Bob", talkMs: 5000, turns: 1, invites: 0, lastSpokeAt: 2000, online: true },
    ];

    const next = pickNextSpeaker(participants);
    assert.equal(next?.id, "2");
  });
});

