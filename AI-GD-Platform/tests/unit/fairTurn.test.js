import test from 'node:test'; import assert from 'node:assert';
import { pickNextSpeaker } from '../../ai-engine/moderation/fairTurn.js';
test('quietest participant is invited first', () => {
  const ps = [{ id: 'a', talkMs: 60000, turns: 4, invites: 0, lastSpokeAt: 5 }, { id: 'b', talkMs: 2000, turns: 1, invites: 0, lastSpokeAt: 1 }];
  assert.equal(pickNextSpeaker(ps).id, 'b');
});
test('repeat invitations rotate to the next quiet person', () => {
  const ps = [{ id: 'a', talkMs: 0, turns: 0, invites: 2, lastSpokeAt: 0 }, { id: 'b', talkMs: 3000, turns: 1, invites: 0, lastSpokeAt: 1 }];
  assert.equal(pickNextSpeaker(ps).id, 'b');
});
