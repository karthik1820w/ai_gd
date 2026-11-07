// Imported first: refuses to boot in production with unsafe defaults.
if (process.env.NODE_ENV === 'production') {
  const e = process.env, bad = [];
  if (!e.JWT_SECRET || e.JWT_SECRET.length < 32) bad.push('JWT_SECRET must be set (32+ characters)');
  if (!e.ADMIN_PASSWORD || e.ADMIN_PASSWORD.length < 12 || e.ADMIN_PASSWORD === 'admin123') bad.push('ADMIN_PASSWORD must be set (12+ characters, not the default)');
  if (e.LIVEKIT_URL && (!e.LIVEKIT_API_SECRET || e.LIVEKIT_API_SECRET.length < 32 || e.LIVEKIT_API_SECRET === 'secret')) bad.push('LIVEKIT_API_SECRET must be 32+ characters, not the dev default');
  if (!e.DATABASE_URL) bad.push('DATABASE_URL is required (data would be lost on restart)');
  if (!e.REDIS_URL) bad.push('REDIS_URL is required (rate limiting and crash recovery)');
  if (bad.length) throw new Error('Refusing to start in production:\n - ' + bad.join('\n - '));
}
