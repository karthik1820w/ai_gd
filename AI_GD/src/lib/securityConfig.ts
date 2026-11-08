export function secureCookie(request: Request | undefined, override: string | undefined, production: boolean) {
  const configured = override?.trim().toLowerCase();
  if (configured) {
    if (["1", "true", "on"].includes(configured)) return true;
    if (["0", "false", "off"].includes(configured)) return false;
    throw new Error("COOKIE_SECURE must be true or false.");
  }
  if (!request) return production;
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}
