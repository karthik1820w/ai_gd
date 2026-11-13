import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSeats, centerMessage, clockLabel, connectionText, qualityLabel, shortTime, spacedCode } from "../src/lib/meetingView.ts";
import type { RosterEntry } from "../src/components/meeting/types.ts";

const person = (userId: string, extra: Partial<RosterEntry> = {}): RosterEntry => ({
  userId, name: userId.toUpperCase(), isHost: false, connected: true, audio: true, video: true, hand: false,
  speaking: false, micLocked: false, speakingMs: 0, contributions: 0, invites: 0, q: "good", ...extra,
});
const base = {
  overrides: {}, peers: new Map(), qualities: {}, layout: "round" as const, focusId: null, inviteUserId: null,
  local: { camOn: false, micOn: true, hand: false, speaking: false, stream: null },
};

describe("seats", () => {
  const roster = [person("host", { isHost: true }), person("a", { speakingMs: 30_000 }), person("b", { speakingMs: 0 }), person("c", { connected: false })];

  it("seats connected participants only, and not the host, in the round layout", () => {
    const { seats, selfIndex } = buildSeats({ ...base, roster, self: { userId: "host", name: "Host", isHost: true } });
    assert.deepEqual(seats.map((s) => s.userId), ["a", "b"]);
    assert.equal(selfIndex, null);
  });

  it("puts a participant's own seat in the ring, even before the roster lists them", () => {
    const { seats, selfIndex } = buildSeats({ ...base, roster: [person("host", { isHost: true })], self: { userId: "z", name: "Zed", isHost: false } });
    assert.equal(seats.length, 1);
    assert.equal(selfIndex, 0);
    assert.equal(seats[0].isSelf, true);
  });

  it("brings the host to the centre while the host speaks, and shows the host in other layouts", () => {
    const round = buildSeats({ ...base, roster, focusId: "host", self: { userId: "a", name: "A", isHost: false } });
    assert.ok(round.seats.some((s) => s.userId === "host"));
    const gallery = buildSeats({ ...base, roster, layout: "gallery", self: { userId: "a", name: "A", isHost: false } });
    assert.ok(gallery.seats.some((s) => s.isHost));
  });

  it("shows video only when the camera is on AND a video track exists", () => {
    const track = {} as never;
    const peers = new Map([["a", { userId: "a", name: "A", videoTrack: track, audioTrack: null, camOn: true, micOn: true }]]);
    const on = buildSeats({ ...base, roster, peers, self: { userId: "host", name: "Host", isHost: true } });
    assert.equal(on.seats.find((s) => s.userId === "a")!.camOn, true);
    const off = buildSeats({ ...base, roster: [person("host", { isHost: true }), person("a", { video: false })], peers, self: { userId: "host", name: "Host", isHost: true } });
    assert.equal(off.seats.find((s) => s.userId === "a")!.camOn, false);
    const noTrack = buildSeats({ ...base, roster, self: { userId: "host", name: "Host", isHost: true } });
    assert.equal(noTrack.seats.find((s) => s.userId === "a")!.camOn, false);
  });

  it("lets live socket events override a stale roster", () => {
    const { seats } = buildSeats({ ...base, roster, overrides: { b: { speaking: true, audio: false } }, self: { userId: "host", name: "Host", isHost: true } });
    const b = seats.find((s) => s.userId === "b")!;
    assert.equal(b.speaking, true);
    assert.equal(b.micOn, false);
  });

  it("fills the talk ring by fair share, so a quiet person is nearly empty", () => {
    const { seats } = buildSeats({ ...base, roster, self: { userId: "host", name: "Host", isHost: true } });
    assert.ok(seats.find((s) => s.userId === "a")!.fill > seats.find((s) => s.userId === "b")!.fill);
    assert.equal(seats.find((s) => s.userId === "b")!.fill, 0);
  });

  it("marks the invited person", () => {
    const { seats } = buildSeats({ ...base, roster, inviteUserId: "b", self: { userId: "host", name: "Host", isHost: true } });
    assert.deepEqual(seats.filter((s) => s.invited).map((s) => s.userId), ["b"]);
  });
});

describe("centre message", () => {
  const input = { status: "LIVE", isHost: false, moderated: true, invite: null, selfId: "a", inviteSeconds: 0, secondsToInvite: 5 };
  it("counts down to the AI invitation", () => assert.equal(centerMessage(input).sub, "AI invites someone in 5s"));
  it("says the AI is choosing when the countdown reaches zero", () => assert.match(centerMessage({ ...input, secondsToInvite: 0 }).sub, /choosing/));
  it("tells the invited person the floor is theirs", () => {
    const m = centerMessage({ ...input, invite: { userId: "a", name: "A", until: 0 }, inviteSeconds: 20 });
    assert.equal(m.title, "The floor is yours");
    assert.match(m.sub, /20s/);
  });
  it("tells everyone else who was invited", () => assert.equal(centerMessage({ ...input, invite: { userId: "b", name: "Bea", until: 0 }, inviteSeconds: 9 }).title, "Bea is invited"));
  it("handles waiting and finished states", () => {
    assert.equal(centerMessage({ ...input, status: "SCHEDULED" }).title, "Waiting");
    assert.equal(centerMessage({ ...input, status: "COMPLETED" }).title, "Finished");
    assert.match(centerMessage({ ...input, status: "COMPLETED", isHost: true }).sub, /Everyone's/);
  });
  it("does not promise an invitation in a free-flow room", () => assert.equal(centerMessage({ ...input, moderated: false }).sub, "The floor is open. Press Speak."));
});

describe("small helpers", () => {
  it("maps LiveKit quality names", () => {
    assert.equal(qualityLabel("excellent"), "good");
    assert.equal(qualityLabel("lost"), "poor");
    assert.equal(connectionText("poor"), "Weak");
  });
  it("formats time and codes", () => {
    assert.equal(shortTime(3000), "3s");
    assert.equal(shortTime(65_000), "1:05");
    assert.equal(spacedCode("3JR1"), "3 J R 1");
    assert.equal(clockLabel(6), "00:06");
    assert.equal(clockLabel(3725), "1:02:05");
  });
});
