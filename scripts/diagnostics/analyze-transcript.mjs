import fs from "node:fs";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const confidenceArg = args.find((arg) => arg.startsWith("--min-confidence="))?.split("=")[1];
const minConfidence = confidenceArg == null ? 0.5 : Number(confidenceArg);
if (!file || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
  console.error("Usage: node scripts/diagnostics/analyze-transcript.mjs <meeting.jsonl> [--min-confidence=0.5]");
  process.exit(2);
}

const rows = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); }
  catch { return { _invalidLine: index + 1 }; }
});
const valid = rows.filter((row) => typeof row.stage === "string");
const examples = (items) => items.slice(0, 5);
const normalise = (text) => String(text ?? "").toLocaleLowerCase().replace(/\s+/g, " ").trim();

const finals = valid.filter((row) => row.eventType === "final" && normalise(row.text));
const finalGroups = new Map();
for (const row of finals.filter((item) => item.stage === "stt" || item.stage === "captured")) {
  const key = `${row.stage}|${row.speakerId}|${normalise(row.text)}`;
  finalGroups.set(key, [...(finalGroups.get(key) ?? []), row]);
}
const duplicateFinals = [...finalGroups.values()].filter((group) => group.length > 1).map((group) => ({ count: group.length, speakerId: group[0].speakerId, stage: group[0].stage, text: group[0].text, segmentIds: group.map((row) => row.segmentId) }));

const persisted = valid.filter((row) => row.stage === "persisted" && row.eventType === "final" && Date.parse(row.startedAt) < Date.parse(row.endedAt)).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
const overlap = [];
for (let i = 0; i < persisted.length; i += 1) {
  const left = persisted[i];
  const leftStart = Date.parse(left.startedAt);
  const leftEnd = Date.parse(left.endedAt);
  for (let j = i + 1; j < persisted.length; j += 1) {
    const right = persisted[j];
    const rightStart = Date.parse(right.startedAt);
    if (rightStart >= leftEnd) break;
    if (left.speakerId === right.speakerId && rightStart < leftEnd && Date.parse(right.endedAt) > leftStart) {
      overlap.push({ speakerId: left.speakerId, leftSegmentId: left.segmentId, rightSegmentId: right.segmentId, left: [left.startedAt, left.endedAt], right: [right.startedAt, right.endedAt] });
    }
  }
}

const outOfOrder = [];
const bySpeakerStage = new Map();
for (const row of valid.filter((item) => item.startedAt && item.stage !== "displayed")) {
  const key = `${row.stage}|${row.speakerId}`;
  const previous = bySpeakerStage.get(key);
  const start = Date.parse(row.startedAt);
  if (Number.isFinite(start) && previous && start < previous.start) outOfOrder.push({ stage: row.stage, speakerId: row.speakerId, previousSegmentId: previous.segmentId, segmentId: row.segmentId, previousStart: previous.startedAt, startedAt: row.startedAt });
  if (Number.isFinite(start)) bySpeakerStage.set(key, row);
}

const speakersBySegment = new Map();
for (const row of valid.filter((item) => item.segmentId && item.stage !== "stt")) {
  speakersBySegment.set(row.segmentId, new Set([...(speakersBySegment.get(row.segmentId) ?? []), row.speakerId]));
}
const speakerChanges = [...speakersBySegment.entries()].filter(([, speakers]) => speakers.size > 1).map(([segmentId, speakers]) => ({ segmentId, speakerIds: [...speakers] }));

const textDuringSilence = valid.filter((row) => row.silence === true && normalise(row.text));
const lowConfidence = valid.filter((row) => typeof row.confidence === "number" && row.confidence < minConfidence && normalise(row.text));
const timestampDeltas = valid.flatMap((row) => {
  const arrival = Date.parse(row.arrivalAt);
  const end = Date.parse(row.endedAt);
  return Number.isFinite(arrival) && Number.isFinite(end) ? [{ stage: row.stage, speakerId: row.speakerId, segmentId: row.segmentId, deltaMs: arrival - end }] : [];
}).sort((a, b) => a.deltaMs - b.deltaMs);

const report = {
  file,
  records: { total: rows.length, valid: valid.length, invalidJsonLines: rows.length - valid.length },
  confidenceThresholdUsedForDiagnosticOnly: minConfidence,
  findings: {
    duplicateFinalCandidates: { count: duplicateFinals.length, examples: examples(duplicateFinals) },
    overlappingPersistedRangesSameSpeaker: { count: overlap.length, examples: examples(overlap) },
    outOfOrderStartsWithinStageAndSpeaker: { count: outOfOrder.length, examples: examples(outOfOrder) },
    speakerChangesForSameSegmentId: { count: speakerChanges.length, examples: examples(speakerChanges) },
    textMarkedDuringSilence: { count: textDuringSilence.length, examples: examples(textDuringSilence.map(({ speakerId, segmentId, text, arrivalAt }) => ({ speakerId, segmentId, text, arrivalAt }))) },
    lowConfidenceText: { count: lowConfidence.length, examples: examples(lowConfidence.map(({ speakerId, segmentId, text, confidence, arrivalAt }) => ({ speakerId, segmentId, text, confidence, arrivalAt }))) },
    arrivalMinusEndTimestampMs: {
      count: timestampDeltas.length,
      interpretation: "Includes network and processing delay plus any client/server clock offset; it is not a pure clock-drift measurement.",
      min: timestampDeltas[0]?.deltaMs ?? null,
      max: timestampDeltas.at(-1)?.deltaMs ?? null,
      examples: examples(timestampDeltas),
    },
  },
};
console.log(JSON.stringify(report, null, 2));
