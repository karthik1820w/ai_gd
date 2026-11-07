// Write-behind persistence: the real-time path never waits on the database. Writes are serialised on one queue, in order.
import * as db from './db.js';
let chain = Promise.resolve();
const run = fn => { if (db.enabled) chain = chain.then(fn).catch(e => console.error('persist:', e.message)); };
const ts = ms => (ms || null) && new Date(ms);
export const onRoom = (r, adminId) => run(() => db.q('INSERT INTO sessions (code,topic,keywords,admin_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [r.code, r.topic, r.keywords, adminId || null]));
export const onStart = r => run(() => db.q("UPDATE sessions SET status='live', started_at=$2 WHERE code=$1", [r.code, ts(r.startedAt)]));
export const onJoin = (r, p) => run(() => db.q('INSERT INTO session_participants (session_code,pid,name,token_hash) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [r.code, p.id, p.name, p.tokenHash]));
export const onTalk = (r, p) => p && run(() => db.q('UPDATE session_participants SET talk_ms=$3, turns=$4, invites=$5 WHERE session_code=$1 AND pid=$2', [r.code, p.id, Math.round(p.talkMs), p.turns, p.invites]));
export const onSpeech = (r, e, emb) => run(() => db.q('INSERT INTO utterances (session_code,pid,seq,text,relevance,embedding,spoken_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [r.code, e.id, e.seq, e.text, e.relevance, '[' + emb.join(',') + ']', ts(e.t)]));
export const onEnd = (r, report) => run(async () => {
  await db.q("UPDATE sessions SET status='ended', ended_at=$2 WHERE code=$1", [r.code, ts(r.endedAt)]);
  for (const p of r.participants.values()) await db.q('UPDATE session_participants SET talk_ms=$3, turns=$4, invites=$5 WHERE session_code=$1 AND pid=$2', [r.code, p.id, Math.round(p.talkMs), p.turns, p.invites]);
  for (const x of report) await db.q('INSERT INTO evaluations VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (session_code,pid) DO UPDATE SET participation=$3, knowledge=$4, overall=$5, relevance=$6, feedback=$7', [r.code, x.id, x.participation, x.knowledge, x.overall, x.relevance, x.feedback]);
});
