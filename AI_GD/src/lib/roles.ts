import { isHostEmail } from "@/lib/hostAccount";

export type AccountRole = "HOST" | "PARTICIPANT";

/** The host role is only honoured for the email set in HOST_EMAIL. */
export function authorizedRole(email: string, storedRole: AccountRole, env: Record<string, string | undefined> = process.env): AccountRole {
  return storedRole === "HOST" && isHostEmail(email, env) ? "HOST" : "PARTICIPANT";
}
