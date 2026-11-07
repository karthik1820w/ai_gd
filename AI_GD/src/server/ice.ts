import crypto from "crypto";

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Returns ICE servers for WebRTC media connections.
 * If TURN_SECRET is provided, dynamically generates coturn-compatible
 * time-limited HMAC-SHA1 credentials (TTL: 6 hours) keyed by user/client ID.
 */
export function getIceServers(userId = "anonymous"): IceServerConfig[] {
  const stunUrls = (process.env.STUN_URLS || "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const out: IceServerConfig[] = [];
  if (stunUrls.length > 0) {
    out.push({ urls: stunUrls });
  }

  const turnUrls = (process.env.TURN_URLS || process.env.TURN_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (turnUrls.length === 0) return out;

  const turnSecret = process.env.TURN_SECRET;
  if (turnSecret) {
    // 6-hour expiration timestamp
    const expiry = Math.floor(Date.now() / 1000) + 6 * 3600;
    const username = `${expiry}:${userId}`;
    const credential = crypto
      .createHmac("sha1", turnSecret)
      .update(username)
      .digest("base64");

    out.push({
      urls: turnUrls,
      username,
      credential,
    });
  } else if (process.env.TURN_USERNAME && (process.env.TURN_PASSWORD || process.env.TURN_CREDENTIAL)) {
    out.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_PASSWORD || process.env.TURN_CREDENTIAL,
    });
  }

  return out;
}

