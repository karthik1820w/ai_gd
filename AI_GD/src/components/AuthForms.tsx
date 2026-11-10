"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

async function send(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const responseText = await response.text();
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    if (!response.ok) throw new Error(`The server could not complete the request (HTTP ${response.status}). Please try again.`);
  }
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : `The server could not complete the request (HTTP ${response.status}). Please try again.`;
    throw new Error(message);
  }
  if (!responseText || Object.keys(data).length === 0) throw new Error("The server returned an invalid response. Please try again.");
  return data;
}

function responseString(data: Record<string, unknown>, key: string) {
  const value = data[key];
  if (typeof value !== "string") throw new Error("The server returned an invalid response. Please try again.");
  return value;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const next = params.get("next");
      const data = await send(`/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ""}`, { email: form.get("email"), password: form.get("password") });
      router.push(responseString(data, "next"));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setPending(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="list">
      <label className="field">Email<input name="email" type="email" autoComplete="email" required /></label>
      <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [accountExists, setAccountExists] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAccountExists(false);
    const form = new FormData(event.currentTarget);
    try {
      const data = await send("/api/auth/register", { name: form.get("name"), email: form.get("email"), password: form.get("password") });
      router.push(responseString(data, "next"));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the account.";
      setError(message);
      setAccountExists(message.includes("already registered"));
    }
  }
  return (
    <form onSubmit={onSubmit} className="list">
      <label className="field">Name<input name="name" required minLength={2} /></label>
      <label className="field">Email<input name="email" type="email" required /></label>
      <label className="field">Password<input name="password" type="password" minLength={8} required /></label>
      <p className="muted">New accounts are participants. The host account is provisioned separately.</p>
      {error && <p className="error">{error}{accountExists && <> <a href="/login">Sign in to your existing account</a>.</>}</p>}
      <button className="btn btn-primary">Create account</button>
    </form>
  );
}

export function ForgotForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [devLink, setDevLink] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const data = await send("/api/auth/forgot", { email: form.get("email") });
      setMessage(responseString(data, "message"));
      setDevLink(typeof data.devResetUrl === "string" ? data.devResetUrl : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the reset.");
    }
  }
  return (
    <form onSubmit={onSubmit} className="list">
      <label className="field">Email<input name="email" type="email" required /></label>
      {message && <p>{message}</p>}
      {devLink && <p>Development reset link: <a href={devLink}>{devLink}</a></p>}
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary">Send reset link</button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await send("/api/auth/reset", { token, password: form.get("password") });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    }
  }
  return (
    <form onSubmit={onSubmit} className="list">
      <label className="field">New password<input name="password" type="password" minLength={8} required /></label>
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary">Update password</button>
    </form>
  );
}
