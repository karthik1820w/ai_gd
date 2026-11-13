"use client";

import { useEffect, useState } from "react";
import { clockLabel, shortTime } from "@/lib/meetingView";
import type { Results as ResultsData, ResultsPerson } from "./types";

const MAX_TRIES = 90; // about three minutes

function ScoreRing({ score }: { score: number | null }) {
  return (
    <div className="rt-ring-score" style={{ ["--v" as string]: score ?? 0 }} aria-label={score == null ? "Not scored" : `Score ${Math.round(score)}`}>
      <span>{score == null ? "–" : Math.round(score)}</span>
    </div>
  );
}

function PersonCard({ person, mine }: { person: ResultsPerson; mine: boolean }) {
  return (
    <article className={`rt-person${mine ? " mine" : ""}`}>
      <ScoreRing score={person.incomplete ? null : person.score} />
      <h3>{person.name}{mine ? " (you)" : ""}</h3>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {shortTime(person.speakingMs)} · {person.contributions} {person.contributions === 1 ? "turn" : "turns"} · {person.category}
      </p>
      {person.incomplete && person.incompleteReason && <p className="rt-note">{person.incompleteReason}</p>}
      {person.parameters.map((parameter) => (
        <div className="rt-crit" key={parameter.key}>
          <span>{parameter.label} <span className="muted">({Math.round(parameter.weight * 100)}%)</span></span>
          <b>{parameter.score == null ? "–" : Math.round(parameter.score)}</b>
          <div className="rt-meter"><span style={{ width: `${Math.max(0, Math.min(100, parameter.score ?? 0))}%` }} /></div>
        </div>
      ))}
      {person.strengths.length > 0 && <div><strong style={{ fontSize: 13 }}>Strengths</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>{person.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {person.improvements.length > 0 && <div><strong style={{ fontSize: 13 }}>To improve</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>{person.improvements.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {(person.covered.length > 0 || person.missed.length > 0) && (
        <div className="rt-chips">
          {person.covered.map((item) => <span key={`c-${item}`} className="rt-chip good">Covered {item}</span>)}
          {person.missed.map((item) => <span key={`m-${item}`} className="rt-chip">Missed {item}</span>)}
        </div>
      )}
    </article>
  );
}

/**
 * What the discussion produced. The server decides what each viewer may see: the host gets every
 * person's score and transcript, a participant gets only their own. This component renders what it is given.
 */
export function Results({ discussionId, refreshKey }: { discussionId: string; refreshKey: number }) {
  const [data, setData] = useState<ResultsData | null>(null);
  const [tries, setTries] = useState(0);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attempt = 0;
    const load = async () => {
      attempt += 1;
      try {
        const response = await fetch(`/api/discussions/${discussionId}/results`, { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) { setFailed(body.error || "Could not load the results."); return; }
        if (body.ready) { setData(body as ResultsData); setFailed(""); return; }
      } catch {
        if (cancelled) return;
      }
      setTries(attempt);
      if (attempt < MAX_TRIES) timer = window.setTimeout(load, 2000);
    };
    void load();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [discussionId, refreshKey]);

  if (failed) return <section className="rt-results"><p className="rt-note" role="alert">{failed}</p></section>;
  if (!data?.ready) {
    return (
      <section className="rt-results" aria-live="polite">
        <h2>Preparing your results</h2>
        <p className="muted">{tries >= MAX_TRIES ? "This is taking longer than usual. Reload this page in a minute." : "Scores and the transcript are being prepared. This updates by itself."}</p>
      </section>
    );
  }

  const isHost = data.role === "host";
  const people = data.people ?? [];
  const mineId = !isHost ? people[0]?.participantId : undefined;
  const summary = data.summary;
  const turns = data.transcript?.turns ?? [];

  return (
    <section className="rt-results">
      {summary && (
        <div className="rt-panel" style={{ gap: 12 }}>
          <h2>Group summary</h2>
          <p className="muted" style={{ margin: 0 }}>Evaluated by {data.evaluatedBy}{data.formula ? ` · Overall = ${data.formula}` : ""}</p>
          {summary.conclusion && <p style={{ margin: 0 }}>{summary.conclusion}</p>}
          <div className="rt-summary">
            <div><strong>Key insights</strong><ul>{summary.keyInsights.length ? summary.keyInsights.map((item) => <li key={item}>{item}</li>) : <li>None recorded</li>}</ul></div>
            <div><strong>Agreed on</strong><ul>{summary.agreements.length ? summary.agreements.map((item) => <li key={item}>{item}</li>) : <li>None recorded</li>}</ul></div>
            <div><strong>Disagreed on</strong><ul>{summary.disagreements.length ? summary.disagreements.map((item) => <li key={item}>{item}</li>) : <li>None recorded</li>}</ul></div>
            <div><strong>Missed topics</strong><ul>{summary.missedTopics.length ? summary.missedTopics.map((item) => <li key={item}>{item}</li>) : <li>None recorded</li>}</ul></div>
          </div>
          {summary.bestContribution && <p style={{ margin: 0 }}><strong>Best contribution:</strong> {summary.bestContribution}</p>}
          <div className="rt-actions">
            {isHost
              ? <a className="rt-btn primary" href={`/api/discussions/${discussionId}/pdf?type=COMBINED&download=1`}>Download full report</a>
              : mineId && <a className="rt-btn primary" href={`/api/discussions/${discussionId}/pdf?type=INDIVIDUAL&participantId=${mineId}&download=1`}>Download my feedback</a>}
          </div>
        </div>
      )}

      <div>
        <h2 style={{ marginBottom: 10 }}>{isHost ? "Scores for everyone" : "Your score"}</h2>
        <div className="rt-people">
          {people.map((person) => <PersonCard key={person.participantId} person={person} mine={person.participantId === mineId} />)}
        </div>
      </div>

      <div className="rt-transcript">
        <h2>{isHost ? "Meeting transcript" : "Your transcript"}</h2>
        <p className="muted" style={{ border: 0, paddingBottom: 0 }}>{isHost ? "Everyone who took part. Only you can see all of it." : "Only you can see this. It is what your score was based on."}</p>
        <div className="rt-actions">
          <a className="rt-btn primary" href={`/api/discussions/${discussionId}/transcript?format=txt&download=1`}>{isHost ? "Download full transcript" : "Download my transcript"}</a>
        </div>
        {turns.length === 0 && <p className="muted">No speech was captured.</p>}
        {turns.map((turn) => (
          <p key={turn.index}>
            <time>[{clockLabel(turn.offsetSec)}]</time>
            {isHost && <strong>{turn.speaker}: </strong>}
            {turn.text}{turn.source !== "live" ? " (from recording)" : ""}
          </p>
        ))}
      </div>
    </section>
  );
}
