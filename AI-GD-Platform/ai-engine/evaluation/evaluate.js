// Participant Evaluation Engine: participation (computed) + knowledge (LLM when a key is set, keyword heuristic otherwise).
const clamp = n => Math.max(0, Math.min(100, Math.round(n)));

function heuristic(room, p) {
  const text = p.transcript.join(' ').toLowerCase();
  const kws = room.keywords.map(k => k.toLowerCase());
  const hit = kws.filter(k => text.includes(k)).length;
  const coverage = kws.length ? hit / kws.length : 0.5;
  const depth = Math.min(1, text.split(/\s+/).filter(Boolean).length / 120);
  return { knowledge: clamp(coverage * 60 + depth * 40), feedback: kws.length ? `Covered ${hit}/${kws.length} key concepts.` : 'Add topic keywords for sharper scoring.' };
}

async function llm(room, p) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.LLM_MODEL || 'claude-sonnet-5-5', max_tokens: 400,
      messages: [{ role: 'user', content: `Group discussion topic: "${room.topic}". Score this participant's subject knowledge 0-100 for accuracy, depth and relevance. Reply ONLY JSON {"knowledge":number,"feedback":"two sentences"}.\nTranscript:\n${p.transcript.join('\n') || '(said nothing)'}` }]
    })
  });
  const data = await res.json();
  return JSON.parse(data.content[0].text.replace(/```json|```/g, '').trim());
}

export async function evaluateRoom(room) {
  const ps = [...room.participants.values()];
  const total = ps.reduce((s, p) => s + p.talkMs, 0) || 1;
  const fair = 1 / Math.max(ps.length, 1);
  return Promise.all(ps.map(async p => {
    const share = p.talkMs / total;
    const participation = clamp(Math.min(share / fair, 1) * 70 + Math.min(p.turns, 3) / 3 * 30);
    let k;
    try { k = process.env.ANTHROPIC_API_KEY ? await llm(room, p) : heuristic(room, p); } catch { k = heuristic(room, p); }
    const mine = room.transcript.filter(x => x.id === p.id), relevance = mine.length ? clamp(100 * mine.reduce((t, x) => t + (x.relevance || 0), 0) / mine.length) : 0;
    return { id: p.id, name: p.name, relevance, talkSeconds: Math.round(p.talkMs / 1000), turns: p.turns, invites: p.invites,
      participation, knowledge: clamp(k.knowledge), overall: clamp(participation * 0.4 + k.knowledge * 0.6), feedback: k.feedback };
  }));
}
