import { clock, type Turn } from "@/server/transcript";

/** One person's lines, in order, with time since the discussion started. */
export function TranscriptBlock({ turns }: { turns: Turn[] }) {
  if (!turns.length) return <p className="muted">No speech was captured for this person.</p>;
  return (
    <div className="list" style={{ gap: 6 }}>
      {turns.map((turn) => (
        <p key={turn.index} style={{ margin: 0 }}>
          <span className="muted">[{clock(turn.offsetSec)}]{turn.source === "live" ? "" : " (from recording)"}</span> {turn.text}
        </p>
      ))}
    </div>
  );
}
