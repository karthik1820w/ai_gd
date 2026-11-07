import crypto from 'crypto'; import jwt from 'jsonwebtoken'; import * as db from '../modules/db.js';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production');
if (!process.env.JWT_SECRET) console.warn('JWT_SECRET not set: using a random secret, admin sessions will not survive a restart');
const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'), mem = new Map();
export const hash = pw => { const s = crypto.randomBytes(16); return `s1:${s.toString('hex')}:${crypto.scryptSync(pw, s, 32).toString('hex')}`; };
export const verify = (pw, h) => { const [, s, d] = h.split(':'); return crypto.timingSafeEqual(crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32), Buffer.from(d, 'hex')); };
export const sign = u => jwt.sign({ sub: String(u.id), email: u.email, role: 'admin' }, SECRET, { expiresIn: '8h' });
export const check = t => { try { const p = jwt.verify(String(t || ''), SECRET); return p.role === 'admin' ? p : null; } catch { return null; } };
export async function seed() { // first admin comes from the environment; no open registration
  if (process.env.NODE_ENV === 'production' && db.enabled) for (const u of (await db.q('SELECT email,password_hash FROM users')).rows) if (verify('admin123', u.password_hash)) throw new Error(`Refusing to start in production: account ${u.email} still uses the default password`);
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase(), pw = process.env.ADMIN_PASSWORD || 'admin123';
  if (db.enabled) await db.q("INSERT INTO users (email,password_hash,role) VALUES ($1,$2,'admin') ON CONFLICT (email) DO NOTHING", [email, hash(pw)]);
  else mem.set(email, { id: 0, email, password_hash: hash(pw) });
}
export async function login(email, pw) {
  email = email.toLowerCase().trim();
  const u = db.enabled ? (await db.q('SELECT id,email,password_hash FROM users WHERE email=$1', [email])).rows[0] : mem.get(email);
  try { return u && verify(pw, u.password_hash) ? u : null; } catch { return null; }
}
