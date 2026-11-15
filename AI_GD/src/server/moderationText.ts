/** Plain-language wording for what the host did to a participant. Pure, shared by the report, the results screen and the PDF. */
export const MODERATION_KINDS = ["MIC_MUTED", "MIC_ALLOWED", "CAMERA_OFF", "CAMERA_ALLOWED", "REMOVED"] as const;
export type ModerationKind = (typeof MODERATION_KINDS)[number];

export function moderationText(kind: string, detail?: string | null) {
  switch (kind) {
    case "MIC_MUTED": return "The host muted this person's microphone.";
    case "MIC_ALLOWED": return "The host allowed this person to use their microphone again.";
    case "CAMERA_OFF": return "The host turned off this person's camera.";
    case "CAMERA_ALLOWED": return "The host allowed this person to use their camera again.";
    case "REMOVED": return `The host removed this person from the discussion${detail ? `. Reason: ${detail}` : ""}.`;
    default: return "A host action was recorded.";
  }
}

export type ModerationRow = { kind: string; detail: string | null; at: string; text: string };

export function moderationRows(events: Array<{ kind: string; detail: string | null; createdAt: Date }>): ModerationRow[] {
  return events.map((event) => ({ kind: event.kind, detail: event.detail, at: event.createdAt.toISOString(), text: moderationText(event.kind, event.detail) }));
}
