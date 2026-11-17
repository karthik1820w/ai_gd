"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export function JoinForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get("link") || "").trim();
    let meetingId = String(form.get("meetingId") || "").trim();
    let code = String(form.get("code") || "").trim();
    if (raw) {
      try {
        const url = new URL(raw);
        meetingId = url.pathname.split("/").filter(Boolean).pop() || meetingId;
        code = url.searchParams.get("code") || code;
      } catch {
        setError("Paste a full meeting link, or enter the ID and code.");
        return;
      }
    }
    if (!meetingId || !code) {
      setError("A meeting ID and access code are both required.");
      return;
    }
    router.push(`/meeting/${meetingId}?code=${encodeURIComponent(code)}`);
  }
  return (
    <form onSubmit={onSubmit} className="card card-pad list">
      <label className="field">Meeting link<textarea name="link" rows={2} placeholder="https://…/meeting/abc?code=123456" /></label>
      <p className="muted">Or enter the two parts separately.</p>
      <label className="field">Meeting ID<input name="meetingId" /></label>
      <label className="field">Access code<input name="code" inputMode="numeric" /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary">Continue to device check</button>
    </form>
  );
}

export function CopyLine({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <input readOnly value={value} aria-label={label} />
        <button type="button" className="btn btn-ghost" onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); }}>{done ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}
