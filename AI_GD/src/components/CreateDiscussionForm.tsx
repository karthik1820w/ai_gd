"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

const STANDARD_RULES = "Let the current speaker finish during a moderated turn. Disagree with the point, not the person. Stay on the announced topic. Support claims with an example when you can. Evaluation uses the transcript only — not appearance, accent, or personality.";

export function CreateDiscussionForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [rules, setRules] = useState(STANDARD_RULES);
  const [pending, setPending] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  useEffect(() => {
    void fetch("/api/config").then((response) => response.json()).then((data: { ai?: boolean }) => setAiOn(Boolean(data.ai))).catch(() => setAiOn(false));
  }, []);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const retention = String(form.get("retentionDays") || "");
    const body = {
      title: form.get("title"),
      topic: form.get("topic"),
      description: form.get("description"),
      context: form.get("context"),
      rules,
      date: form.get("date"),
      time: form.get("time"),
      durationMin: Number(form.get("durationMin")),
      maxParticipants: Number(form.get("maxParticipants")),
      speakingTimeSec: Number(form.get("speakingTimeSec")),
      silencePromptSec: Number(form.get("silencePromptSec")),
      mode: form.get("mode"),
      moderatorEnabled: form.get("moderatorEnabled") === "on",
      transcriptionEnabled: form.get("transcriptionEnabled") === "on",
      recordingEnabled: form.get("recordingEnabled") === "on",
      retentionDays: retention ? Number(retention) : null,
    };
    const response = await fetch("/api/discussions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not create the discussion.");
      setPending(false);
      return;
    }
    router.push(`/host/sessions/${data.id}`);
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="card card-pad list">
      <label className="field">GD title<input name="title" required minLength={3} placeholder="Morning admissions round" /></label>
      <label className="field">Discussion topic<input name="topic" required minLength={3} placeholder="Impact of artificial intelligence on education" /></label>
      <label className="field">Topic description<textarea name="description" required minLength={10} rows={4} placeholder="What should the group examine?" /></label>
      {aiOn && <label className="field">Background or scope for the AI (optional)<textarea name="context" maxLength={2000} rows={3} placeholder="Add context that should constrain the briefing and analysis." /></label>}
      <label className="field">Discussion rules<textarea value={rules} onChange={(event) => setRules(event.target.value)} required minLength={10} rows={4} /></label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label className="field">Date<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label className="field">Starting time<input name="time" type="time" required defaultValue="10:00" /></label>
        <label className="field">Expected duration (minutes)<input name="durationMin" type="number" min={5} max={180} defaultValue={20} required /></label>
        <label className="field">Maximum participants<input name="maxParticipants" type="number" min={2} max={40} defaultValue={12} required /></label>
        <label className="field">Speaking time per turn (seconds)<input name="speakingTimeSec" type="number" min={15} max={300} defaultValue={60} required /></label>
        <label className="field">Silence before a prompt (seconds)<input name="silencePromptSec" type="number" min={10} max={180} defaultValue={25} required /></label>
      </div>
      <fieldset className="list" style={{ border: "1px solid var(--line)", borderRadius: 16, padding: 12 }}>
        <legend>Discussion mode</legend>
        <label><input type="radio" name="mode" value="FREE_FLOW" defaultChecked /> Free-flow — people speak when they are ready</label>
        <label><input type="radio" name="mode" value="AI_MODERATED" /> AI-moderated — quiet participants get a timed speaking turn</label>
      </fieldset>
      <label><input type="checkbox" name="moderatorEnabled" defaultChecked /> AI moderator prompts</label>
      <label><input type="checkbox" name="transcriptionEnabled" defaultChecked /> Record a transcript and score it</label>
      <label><input type="checkbox" name="recordingEnabled" /> Save each participant's microphone audio</label>
      <label className="field">Delete transcript after (days, optional)<input name="retentionDays" type="number" min={1} placeholder="Leave blank to keep until you delete the session" /></label>
      {aiOn && <p className="muted">AI is enabled. Transcripts and the topic context may be sent to Google Gemini for analysis and evaluation.</p>}
      <p className="muted">Video is forwarded through the local media server, so a room can hold up to 40 people. Gemini analysis uses the configured Gemini key; otherwise the built-in lexical model is used.</p>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Create discussion"}</button>
    </form>
  );
}
