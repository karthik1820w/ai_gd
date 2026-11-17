"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function SettingsForm({ name, speechLang, email }: { name: string; speechLang: string; email: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), speechLang: form.get("speechLang") }) });
    const data = await response.json();
    setMessage(data.error || "Profile saved. Sign in again if your name in the meeting still looks old.");
    router.refresh();
  }
  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/me", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), nextPassword: form.get("nextPassword") }) });
    const data = await response.json();
    setMessage(data.error || "Password updated.");
  }
  return (
    <div className="list">
      <form onSubmit={saveProfile} className="card card-pad list">
        <h2 className="serif" style={{ margin: 0 }}>Profile</h2>
        <p className="muted">{email}</p>
        <label className="field">Name<input name="name" defaultValue={name} required /></label>
        <label className="field">Speech recognition language
          <select name="speechLang" defaultValue={speechLang}>
            <option value="en-IN">English (India)</option>
            <option value="en-US">English (United States)</option>
            <option value="en-GB">English (United Kingdom)</option>
            <option value="hi-IN">Hindi</option>
          </select>
        </label>
        <button className="btn btn-primary">Save profile</button>
      </form>
      <form onSubmit={savePassword} className="card card-pad list">
        <h2 className="serif" style={{ margin: 0 }}>Password</h2>
        <label className="field">Current password<input name="currentPassword" type="password" required /></label>
        <label className="field">New password<input name="nextPassword" type="password" minLength={8} required /></label>
        <button className="btn btn-ghost">Change password</button>
      </form>
      <form className="card card-pad list" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        if (!confirm("Delete your account and the discussions it owns?")) return;
        const response = await fetch("/api/me", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: form.get("password") }) });
        const data = await response.json();
        if (!response.ok) setMessage(data.error || "Could not delete the account.");
        else { await fetch("/api/auth/logout", { method: "POST" }); router.push("/"); }
      }}>
        <h2 className="serif" style={{ margin: 0 }}>Delete account</h2>
        <p className="muted">This removes your user, hosted discussions, and stored transcripts.</p>
        <label className="field">Password<input name="password" type="password" required /></label>
        <button className="btn btn-danger">Delete my data</button>
      </form>
      {message && <p>{message}</p>}
    </div>
  );
}
