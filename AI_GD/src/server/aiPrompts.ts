import { AI_SECURITY } from "./ai.ts";

export type AliasEntry = { id: string; name: string };
export type Aliases = { byId: Map<string, string>; byAlias: Map<string, string> };

export function aliasPeople(people: AliasEntry[]): Aliases {
  const byId = new Map<string, string>();
  const byAlias = new Map<string, string>();
  for (const person of people) {
    if (byId.has(person.id)) continue;
    const alias = `P${byId.size + 1}`;
    byId.set(person.id, alias);
    byAlias.set(alias, person.name);
  }
  return { byId, byAlias };
}

export function aliasText(text: string, aliases: Aliases) {
  const names = [...aliases.byAlias.entries()]
    .map(([alias, name]) => ({ alias, name }))
    .filter(({ name }) => name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length);
  let result = text;
  for (const { alias, name } of names) {
    const escaped = escapeRegExp(name.trim()).replace(/\s+/g, "\\s+");
    const expression = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "giu");
    result = result.replace(expression, (_match, prefix: string) => `${prefix}${alias}`);
  }
  return result;
}

export function deAlias(text: string, aliases: Aliases) {
  let result = text;
  for (const [alias, name] of aliases.byAlias) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, "g"), name);
  }
  return result;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function taskPrompt(
  task: "BRIEF" | "UTTERANCE" | "EVALUATION" | "ANSWER" | "MODERATOR",
  instructions: string,
) {
  return `TASK: ${task}\n${instructions.trim()}\n\n${AI_SECURITY}`;
}

export const BRIEF_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    difficulty: { type: "STRING", enum: ["introductory", "intermediate", "advanced"] },
    key_concepts: { type: "ARRAY", items: { type: "OBJECT", properties: { term: { type: "STRING" }, definition: { type: "STRING" } }, required: ["term", "definition"] } },
    key_facts: { type: "ARRAY", items: { type: "STRING" } },
    arguments_for: { type: "ARRAY", items: { type: "STRING" } },
    arguments_against: { type: "ARRAY", items: { type: "STRING" } },
    misconceptions: { type: "ARRAY", items: { type: "STRING" } },
    rubric: { type: "ARRAY", items: { type: "STRING" } },
    discussion_questions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary", "difficulty", "key_concepts", "key_facts", "arguments_for", "arguments_against", "misconceptions", "rubric", "discussion_questions"],
};

export const UTTERANCE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    relevance: { type: "NUMBER", minimum: 0, maximum: 1 },
    accuracy: { type: "STRING", enum: ["accurate", "partly_accurate", "inaccurate", "opinion", "off_topic", "unverifiable"] },
    correction: { type: "STRING" },
    understanding: { type: "INTEGER", minimum: 1, maximum: 5 },
    reasoning: { type: "INTEGER", minimum: 1, maximum: 5 },
    originality: { type: "INTEGER", minimum: 1, maximum: 5 },
    stance: { type: "STRING", enum: ["for", "against", "balanced", "neutral"] },
    responds_to_others: { type: "BOOLEAN" },
    concepts: { type: "ARRAY", items: { type: "STRING" } },
    gist: { type: "STRING" },
  },
  required: ["relevance", "accuracy", "correction", "understanding", "reasoning", "originality", "stance", "responds_to_others", "concepts", "gist"],
};

export const ANSWER_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" },
    sources: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["answer", "sources"],
};

export const MODERATOR_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: { question: { type: "STRING" } },
  required: ["question"],
};

export const EVALUATION_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    participants: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          alias: { type: "STRING" },
          knowledge: { type: "NUMBER", minimum: 0, maximum: 100 },
          thinking: { type: "NUMBER", minimum: 0, maximum: 100 },
          strengths: { type: "ARRAY", items: { type: "STRING" } },
          improvements: { type: "ARRAY", items: { type: "STRING" } },
          concepts_covered: { type: "ARRAY", items: { type: "STRING" } },
          concepts_missed: { type: "ARRAY", items: { type: "STRING" } },
          accuracy_notes: { type: "ARRAY", items: { type: "STRING" } },
          feedback: { type: "STRING" },
        },
        required: ["alias", "knowledge", "thinking", "strengths", "improvements", "concepts_covered", "concepts_missed", "accuracy_notes", "feedback"],
      },
    },
    group: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        key_insights: { type: "ARRAY", items: { type: "STRING" } },
        agreements: { type: "ARRAY", items: { type: "STRING" } },
        disagreements: { type: "ARRAY", items: { type: "STRING" } },
        missed_topics: { type: "ARRAY", items: { type: "STRING" } },
        quality: { type: "NUMBER", minimum: 0, maximum: 100 },
        best_contribution: {
          type: "OBJECT",
          properties: { alias: { type: "STRING" }, why: { type: "STRING" } },
          required: ["alias", "why"],
        },
      },
      required: ["summary", "key_insights", "agreements", "disagreements", "missed_topics", "quality", "best_contribution"],
    },
  },
  required: ["participants", "group"],
};
