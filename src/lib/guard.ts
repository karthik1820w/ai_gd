import { readSession } from "@/lib/auth";
import { fail } from "@/lib/http";

export async function requireUser(role?: "HOST" | "PARTICIPANT") {
  const user = await readSession();
  if (!user) return { user: null, error: fail("Sign in required.", 401) };
  if (role && user.role !== role) return { user: null, error: fail("You do not have access to that.", 403) };
  return { user, error: null };
}
