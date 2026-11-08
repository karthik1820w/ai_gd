type ProxyHeaders = {
  forwardedFor?: string | string[];
  realIp?: string | string[];
};

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeAddress(value?: string) {
  const address = value?.split(",")[0]?.trim();
  if (!address) return "unknown";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function resolveClientAddress(
  remoteAddress: string | undefined,
  proxyHeaders: ProxyHeaders,
  trustProxy: boolean,
) {
  const remote = normalizeAddress(remoteAddress);
  if (!trustProxy) return remote;
  const forwarded = normalizeAddress(firstHeader(proxyHeaders.forwardedFor));
  if (forwarded !== "unknown") return forwarded;
  const realIp = normalizeAddress(firstHeader(proxyHeaders.realIp));
  return realIp !== "unknown" ? realIp : remote;
}

export function loginRateLimitKeys(request: Request, email: string) {
  const ip = request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
  return {
    ip: `login:ip:${ip}`,
    email: `login:email:${email.trim().toLowerCase()}`,
  };
}
