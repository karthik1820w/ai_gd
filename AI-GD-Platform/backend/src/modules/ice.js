// ICE servers for the mesh fallback. TURN uses coturn-style time-limited HMAC credentials (use-auth-secret) when TURN_SECRET is set.
import crypto from 'crypto';
export function servers(id) {
  const e = process.env, out = [{ urls: 'stun:stun.l.google.com:19302' }], urls = (e.TURN_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (urls.length && e.TURN_SECRET) { const username = `${Math.floor(Date.now() / 1000) + 6 * 3600}:${id}`; out.push({ urls, username, credential: crypto.createHmac('sha1', e.TURN_SECRET).update(username).digest('base64') }); }
  else if (urls.length && e.TURN_USERNAME) out.push({ urls, username: e.TURN_USERNAME, credential: e.TURN_CREDENTIAL });
  return out;
}
