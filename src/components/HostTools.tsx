"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function HostActions({ id, status, meetingId }: { id: string; status: string; meetingId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // Every action shows at once that it is working, and cannot be double-clicked.
  async function act(path: string, label = "Working…") {
    if (busy) return;
    setBusy(path);
    setMessage(label);
    try {
      const response = await fetch(path, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setMessage(data.error || "Request failed.");
      else { setMessage("Updated."); router.refresh(); }
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="list">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a className="btn btn-primary" href={`/meeting/${meetingId}`}>{status === "LIVE" ? "Rejoin meeting" : "Open meeting"}</a>
        {status !== "COMPLETED" && status !== "CANCELLED" && <button className="btn btn-ghost" disabled={busy !== null} onClick={() => act(`/api/discussions/${id}/code`, "Making a new code…")}>{busy === `/api/discussions/${id}/code` ? "Working…" : "Regenerate code"}</button>}
        {status === "LIVE" && <button className="btn btn-danger" disabled={busy !== null} onClick={() => act(`/api/discussions/${id}/end`, "Ending and scoring…")}>{busy === `/api/discussions/${id}/end` ? "Scoring…" : "End and score"}</button>}
        {status === "COMPLETED" && <button className="btn btn-ghost" disabled={busy !== null} onClick={async () => {
          if (busy) return;
          setBusy("transcript");
          setMessage("Generating transcript from recordings…");
          try {
            const response = await fetch(`/api/discussions/${id}/transcript`, { method: "POST" });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) { setMessage(data.error || "Request failed."); return; }
            const notes = (data.participants ?? []).filter((item: { note?: string }) => item.note).map((item: { name: string; note: string }) => `${item.name}: ${item.note}`);
            setMessage([data.detail, ...notes].join(" "));
            router.refresh();
          } catch {
            setMessage("Could not reach the server. Check your connection and try again.");
          } finally {
            setBusy(null);
          }
        }}>{busy === "transcript" ? "Generating…" : "Generate from recordings"}</button>}
        {status === "COMPLETED" && <button className="btn btn-ghost" disabled={busy !== null} onClick={() => act(`/api/discussions/${id}/evaluate`, "Recalculating scores…")}>{busy === `/api/discussions/${id}/evaluate` ? "Recalculating…" : "Recalculate scores"}</button>}
        {status !== "LIVE" && <button className="btn btn-ghost" onClick={async () => { if (!confirm("Delete this discussion and its transcript?")) return; await fetch(`/api/discussions/${id}`, { method: "DELETE" }); router.push("/host"); router.refresh(); }}>Delete</button>}
      </div>
      <form onSubmit={async (event: FormEvent) => { event.preventDefault(); if (busy) return; setBusy("invite"); setMessage("Sending invitation…"); try { const response = await fetch(`/api/discussions/${id}/invite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }); const data = await response.json().catch(() => ({})); setMessage(data.error || "Invitation sent in the app."); if (response.ok) setEmail(""); } catch { setMessage("Could not reach the server."); } finally { setBusy(null); } }}>
        <label className="field">Invite an existing account by email
          <div style={{ display: "flex", gap: 8 }}><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required /><button className="btn btn-ghost" disabled={busy !== null}>{busy === "invite" ? "Sending…" : "Invite"}</button></div>
        </label>
      </form>
      {message && <p>{message}</p>}
    </div>
  );
}

export function HostFeedback({ discussionId, evaluationId }: { discussionId: string; evaluationId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/discussions/${discussionId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evaluationId, score: form.get("score"), reason: form.get("reason") }),
    });
    const data = await response.json();
    setMessage(data.error || "Correction saved. The original score stays visible.");
    if (response.ok) router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="list" style={{ marginTop: 8 }}>
      <label className="field">Correct the score<input name="score" type="number" min={0} max={100} step="0.1" required /></label>
      <label className="field">Reason for the correction<textarea name="reason" minLength={8} required rows={2} /></label>
      <button className="btn btn-ghost">Save host correction</button>
      {message && <p className="muted">{message}</p>}
    </form>
  );
}
