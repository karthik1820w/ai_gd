export const HOST_EMAIL = "karthiksathish1820@gmail.com";

export type AccountRole = "HOST" | "PARTICIPANT";

export function authorizedRole(email: string, storedRole: AccountRole): AccountRole {
  return storedRole === "HOST" && email.trim().toLowerCase() === HOST_EMAIL
    ? "HOST"
    : "PARTICIPANT";
}
