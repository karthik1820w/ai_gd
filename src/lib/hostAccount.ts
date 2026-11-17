import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The single host account. The email and password come from the deployment
 * environment (HOST_EMAIL and HOST_PASSWORD), so there is nothing to seed and
 * nothing hard-coded in the source. Everyone else who registers is a participant.
 */

export const HOST_PASSWORD_MIN = 8;
export const HOST_PASSWORD_MAX = 80; // matches the sign-in form limit

type Env = Record<string, string | undefined>;

export type HostConfig = { ok: true; email: string; password: string } | { ok: false; error: string };

export function readHostConfig(env: Env = process.env): HostConfig {
  const email = env.HOST_EMAIL?.trim().toLowerCase();
  const password = env.HOST_PASSWORD;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "HOST_EMAIL is missing or is not a valid email address." };
  if (!password || password.length < HOST_PASSWORD_MIN) return { ok: false, error: `HOST_PASSWORD must be at least ${HOST_PASSWORD_MIN} characters.` };
  if (password.length > HOST_PASSWORD_MAX) return { ok: false, error: `HOST_PASSWORD must be at most ${HOST_PASSWORD_MAX} characters.` };
  return { ok: true, email, password };
}

/** True when the email is the configured host email (whether or not the password is valid). */
export function isHostEmail(email: string, env: Env = process.env) {
  const host = env.HOST_EMAIL?.trim().toLowerCase();
  return Boolean(host) && email.trim().toLowerCase() === host;
}

/** Constant-time comparison that does not leak the password length. */
export function hostPasswordMatches(input: string, configured: string) {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(configured).digest();
  return timingSafeEqual(a, b);
}
