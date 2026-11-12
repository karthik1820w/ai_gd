import { communicationScore, wordCount } from "./scoring.ts";

/**
 * Transcript generator (pure, no database access).
 *
 * Speech recognition emits a new "segment" at every pause, so a single
 * thought often arrives as three or four short fragments. This module turns
 * those fragments into readable, speaker-labelled turns with timestamps, and
 * derives per-speaker figures from the result. The scoring code reads the
 * merged turns, which is closer to how a person would judge the discussion.
 */

export type RawSegment = {
  id?: string;
  participantId: string;
  name: string;
  text: string;
  startedAt: Date | string | number;
  endedAt: Date | string | number;
  /** "live" (browser speech recognition) or "recording" (server-side STT). */
  source?: string;
  relevance?: string;
};

export type Turn = {
  index: number;
  speakerId: string;
  speaker: string;
  startMs: number;
  endMs: number;
  /** Seconds since the discussion started; never negative. */
  offsetSec: number;
  text: string;
  words: number;
  segmentIds: string[];
  source: "live" | "recording" | "mixed";
};

export type SpeakerSummary = {
  speakerId: string;
  speaker: string;
  turns: number;
  words: number;
  speakingMs: number;
  /** Share of all captured speaking time, 0-100. */
  sharePercent: number;
  avgWordsPerTurn: number;
  fillerCount: number;
  /** Word-weighted clarity over merged turns, 0-100; null when there is no speech. */
  clarity: number | null;
};

export type TranscriptDoc = {
  title: string;
  topic: string;
  startedAtMs: number;
  generatedAt: string;
  turns: Turn[];
  speakers: SpeakerSummary[];
  totals: { turns: number; words: number; speakingMs: number };
};

export type BuildOptions = {
  title: string;
  topic: string;
  /** Discussion start; defaults to the first segment. */
  startedAt?: Date | string | number | null;
  segments: RawSegment[];
  /** Same-speaker segments closer than this are one turn. Default 4 s. */
  mergeGapMs?: number;
  /** A turn is closed once it reaches this many words. Default 220. */
  maxTurnWords?: number;
  now?: Date;
};

const FILLER = /\b(um+|uh+|er+|hmm+)\b/gi;
/** Matches evaluate.ts, which caps one segment's speaking time at 60 s. */
const MAX_SEGMENT_MS = 60_000;

function ms(value: Date | string | number) {
  const n = value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
  return Number.isFinite(n) ? n : 0;
}

function tidy(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function joinText(left: string, right: string) {
  if (!left) return right;
  // Speech recognition rarely punctuates; a space is enough to join pieces.
  return `${left} ${right}`;
}

export function buildTranscript(options: BuildOptions): TranscriptDoc {
  const gap = options.mergeGapMs ?? 4_000;
  const maxWords = options.maxTurnWords ?? 220;
  const usable = options.segments
    .map((segment) => ({ ...segment, text: tidy(segment.text), start: ms(segment.startedAt), end: ms(segment.endedAt) }))
    .filter((segment) => segment.text && segment.start > 0)
    .map((segment) => ({ ...segment, end: Math.max(segment.end, segment.start) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const startedAtMs = (options.startedAt != null ? ms(options.startedAt) : 0) || (usable[0]?.start ?? 0);

  const turns: Turn[] = [];
  const speakingBySpeaker = new Map<string, number>();
  let open: (Turn & { sources: Set<string> }) | null = null;

  const close = () => {
    if (!open) return;
    const { sources, ...turn } = open;
    turn.source = sources.size > 1 ? "mixed" : sources.has("recording") ? "recording" : "live";
    turns.push({ ...turn, index: turns.length });
    open = null;
  };

  for (const segment of usable) {
    const source = segment.source === "recording" ? "recording" : "live";
    speakingBySpeaker.set(
      segment.participantId,
      (speakingBySpeaker.get(segment.participantId) ?? 0) + Math.min(segment.end - segment.start, MAX_SEGMENT_MS),
    );
    const words = wordCount(segment.text);
    const continues =
      open &&
      open.speakerId === segment.participantId &&
      segment.start - open.endMs <= gap &&
      open.words + words <= maxWords;
    if (open && continues) {
      open.text = joinText(open.text, segment.text);
      open.words += words;
      open.endMs = Math.max(open.endMs, segment.end);
      if (segment.id) open.segmentIds.push(segment.id);
      open.sources.add(source);
      continue;
    }
    close();
    open = {
      index: 0,
      speakerId: segment.participantId,
      speaker: segment.name,
      startMs: segment.start,
      endMs: segment.end,
      offsetSec: Math.max(0, Math.round((segment.start - startedAtMs) / 1000)),
      text: segment.text,
      words,
      segmentIds: segment.id ? [segment.id] : [],
      source,
      sources: new Set([source]),
    };
  }
  close();

  const totalSpeaking = [...speakingBySpeaker.values()].reduce((sum, value) => sum + value, 0);
  const bySpeaker = new Map<string, Turn[]>();
  for (const turn of turns) bySpeaker.set(turn.speakerId, [...(bySpeaker.get(turn.speakerId) ?? []), turn]);

  const speakers: SpeakerSummary[] = [...bySpeaker.entries()].map(([speakerId, own]) => {
    const words = own.reduce((sum, turn) => sum + turn.words, 0);
    const speakingMs = speakingBySpeaker.get(speakerId) ?? 0;
    return {
      speakerId,
      speaker: own[0].speaker,
      turns: own.length,
      words,
      speakingMs,
      sharePercent: totalSpeaking > 0 ? Math.round((speakingMs / totalSpeaking) * 1000) / 10 : 0,
      avgWordsPerTurn: own.length ? Math.round((words / own.length) * 10) / 10 : 0,
      fillerCount: own.reduce((sum, turn) => sum + (turn.text.match(FILLER)?.length ?? 0), 0),
      clarity: turnClarity(own),
    };
  }).sort((a, b) => b.speakingMs - a.speakingMs);

  return {
    title: options.title,
    topic: options.topic,
    startedAtMs,
    generatedAt: (options.now ?? new Date()).toISOString(),
    turns,
    speakers,
    totals: { turns: turns.length, words: turns.reduce((sum, turn) => sum + turn.words, 0), speakingMs: totalSpeaking },
  };
}

/** Word-weighted clarity of a speaker's merged turns, or null when they said nothing. */
export function turnClarity(turns: Array<Pick<Turn, "text" | "words">>): number | null {
  const weight = turns.reduce((sum, turn) => sum + Math.max(turn.words, 1), 0);
  if (!turns.length || !weight) return null;
  const total = turns.reduce((sum, turn) => sum + communicationScore(turn.text) * Math.max(turn.words, 1), 0);
  return Math.round((total / weight) * 10) / 10;
}

export function clock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function srtClock(totalMs: number) {
  const t = Math.max(0, Math.round(totalMs));
  const h = String(Math.floor(t / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((t % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((t % 60_000) / 1000)).padStart(2, "0");
  const milli = String(t % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${milli}`;
}

const SOURCE_NOTE = "(from recording)";

export function formatText(doc: TranscriptDoc) {
  const lines = [
    doc.title,
    `Topic: ${doc.topic}`,
    `Generated: ${doc.generatedAt}`,
    "",
  ];
  if (!doc.turns.length) lines.push("No speech was captured for this discussion.");
  for (const turn of doc.turns) {
    const note = turn.source === "live" ? "" : ` ${SOURCE_NOTE}`;
    lines.push(`[${clock(turn.offsetSec)}] ${turn.speaker}${note}: ${turn.text}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatMarkdown(doc: TranscriptDoc) {
  const lines = [`# ${doc.title}`, "", `**Topic:** ${doc.topic}`, `**Generated:** ${doc.generatedAt}`, ""];
  if (doc.speakers.length) {
    lines.push("## Speakers", "", "| Speaker | Turns | Words | Speaking time | Share |", "| --- | ---: | ---: | ---: | ---: |");
    for (const speaker of doc.speakers) {
      lines.push(`| ${speaker.speaker} | ${speaker.turns} | ${speaker.words} | ${clock(speaker.speakingMs / 1000)} | ${speaker.sharePercent}% |`);
    }
    lines.push("");
  }
  lines.push("## Transcript", "");
  if (!doc.turns.length) lines.push("No speech was captured for this discussion.");
  for (const turn of doc.turns) {
    const note = turn.source === "live" ? "" : ` *${SOURCE_NOTE}*`;
    lines.push(`**[${clock(turn.offsetSec)}] ${turn.speaker}**${note}`, "", turn.text, "");
  }
  return `${lines.join("\n")}\n`;
}

export function formatJson(doc: TranscriptDoc) {
  return {
    title: doc.title,
    topic: doc.topic,
    generatedAt: doc.generatedAt,
    totals: doc.totals,
    speakers: doc.speakers,
    turns: doc.turns.map((turn) => ({
      index: turn.index,
      speaker: turn.speaker,
      offsetSec: turn.offsetSec,
      startedAt: new Date(turn.startMs).toISOString(),
      endedAt: new Date(turn.endMs).toISOString(),
      words: turn.words,
      source: turn.source,
      text: turn.text,
    })),
  };
}

/** SubRip captions: one cue per turn, relative to the discussion start. */
export function formatSrt(doc: TranscriptDoc) {
  return doc.turns
    .map((turn, index) => {
      const start = Math.max(0, turn.startMs - doc.startedAtMs);
      const end = Math.max(start + 500, turn.endMs - doc.startedAtMs);
      return `${index + 1}\n${srtClock(start)} --> ${srtClock(end)}\n${turn.speaker}: ${turn.text}\n`;
    })
    .join("\n");
}

export const TRANSCRIPT_FORMATS = ["txt", "md", "json", "srt"] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

export function renderTranscript(doc: TranscriptDoc, format: TranscriptFormat) {
  switch (format) {
    case "md":
      return { body: formatMarkdown(doc), contentType: "text/markdown; charset=utf-8", extension: "md" };
    case "json":
      return { body: JSON.stringify(formatJson(doc), null, 2), contentType: "application/json; charset=utf-8", extension: "json" };
    case "srt":
      return { body: formatSrt(doc), contentType: "application/x-subrip; charset=utf-8", extension: "srt" };
    default:
      return { body: formatText(doc), contentType: "text/plain; charset=utf-8", extension: "txt" };
  }
}
