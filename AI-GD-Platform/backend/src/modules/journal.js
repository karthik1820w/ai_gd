// Append-only journal (one JSONL file per room) + atomic final snapshot. Transcripts survive crashes and restarts.
import fs from 'fs'; import path from 'path';
const dir = process.env.DATA_DIR || path.resolve('data'); fs.mkdirSync(dir, { recursive: true });
const open = new Map();
export function log(code, type, data = {}) {
  let s = open.get(code);
  if (!s) { s = fs.createWriteStream(path.join(dir, `${code}.jsonl`), { flags: 'a' }); open.set(code, s); }
  s.write(JSON.stringify({ t: Date.now(), type, ...data }) + '\n');
}
export function finalize(code, obj) {
  const f = path.join(dir, `${code}.final.json`);
  fs.writeFileSync(f + '.tmp', JSON.stringify(obj, null, 1)); fs.renameSync(f + '.tmp', f); // atomic
  open.get(code)?.end(); open.delete(code);
}
