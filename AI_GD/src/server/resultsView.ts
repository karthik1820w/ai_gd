/**
 * Shapes saved results for the finished-discussion screen. Pure, so the privacy
 * rules can be tested: a participant must never receive another person's words,
 * score, or ranking.
 */

export type SummaryPointRow = { kind: string; body: string; sortOrder: number };
export type NoteRow = { kind: string; body: string };

export type GroupSummaryView = {
  source: string;
  conclusion: string;
  quality: string | null;
  keyInsights: string[];
  agreements: string[];
  disagreements: string[];
  missedTopics: string[];
  /** Host only: naming one person's contribution is a comparison between people. */
  bestContribution: string | null;
};

const ordered = (rows: SummaryPointRow[], kind: string) =>
  rows.filter((row) => row.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.body);

export function groupSummaryView(source: string, points: SummaryPointRow[], isHost: boolean): GroupSummaryView {
  // Without Gemini, insights and agreements are copied lines from the transcript, which
  // would show a participant what other people said. They are group-level only when AI wrote them.
  const abstractive = source === "gemini";
  const showLines = isHost || abstractive;
  return {
    source,
    conclusion: ordered(points, "CONCLUSION")[0] ?? "",
    quality: ordered(points, "QUALITY")[0] ?? null,
    keyInsights: showLines ? ordered(points, "IDEA") : [],
    agreements: showLines ? ordered(points, "AGREEMENT") : [],
    disagreements: showLines ? ordered(points, "DISAGREEMENT") : [],
    missedTopics: ordered(points, "MISSED_TOPIC"),
    bestContribution: isHost ? ordered(points, "BEST_CONTRIBUTION")[0] ?? null : null,
  };
}

export type PersonView = {
  participantId: string;
  name: string;
  score: number | null;
  category: string;
  incomplete: boolean;
  incompleteReason: string | null;
  speakingMs: number;
  contributions: number;
  parameters: Array<{ key: string; label: string; weight: number; score: number | null }>;
  strengths: string[];
  improvements: string[];
  covered: string[];
  missed: string[];
};

const COVERED = "Concept covered: ";
const MISSED = "Concept to explore: ";

export function personView(input: {
  participantId: string;
  name: string;
  overallScore: number | null;
  adjustedScore: number | null;
  category: string;
  incomplete: boolean;
  incompleteReason: string | null;
  speakingMs: number;
  contributionCount: number;
  parameters: Array<{ key: string; label: string; weight: number; score: number | null }>;
  notes: NoteRow[];
}): PersonView {
  const notes = (kind: string) => input.notes.filter((note) => note.kind === kind).map((note) => note.body);
  const remarks = notes("REMARK");
  return {
    participantId: input.participantId,
    name: input.name,
    score: input.adjustedScore ?? input.overallScore,
    category: input.category,
    incomplete: input.incomplete,
    incompleteReason: input.incompleteReason,
    speakingMs: input.speakingMs,
    contributions: input.contributionCount,
    parameters: input.parameters,
    strengths: notes("STRENGTH"),
    improvements: notes("IMPROVEMENT"),
    covered: remarks.filter((text) => text.startsWith(COVERED)).map((text) => text.slice(COVERED.length)),
    missed: remarks.filter((text) => text.startsWith(MISSED)).map((text) => text.slice(MISSED.length)),
  };
}

/** "Overall = 25% topic relevance + 20% communication ..." from the saved weights. */
export function formulaText(parameters: Array<{ label: string; weight: number }>) {
  if (!parameters.length) return "";
  return `Overall = ${parameters.map((parameter) => `${Math.round(parameter.weight * 100)}% ${parameter.label.toLowerCase()}`).join(" + ")}`;
}
