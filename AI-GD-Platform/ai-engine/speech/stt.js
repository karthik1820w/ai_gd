// STT adapter: spawns the Python worker, auto-restarts it, times out stuck requests.
import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), worker = path.join(here, 'worker.py'), model = path.join(here, '../../models/sherpa-onnx-whisper-tiny.en');
const env = () => ({ ...process.env, STT_MODEL_DIR: process.env.STT_MODEL_DIR || (fs.existsSync(model) ? model : '') });
export function createSTT() {
  let proc, id = 0, crashes = 0, dead = false; const wait = new Map();
  const boot = () => {
    proc = spawn(process.env.PYTHON || 'python3', [worker], { env: env(), stdio: ['pipe', 'pipe', 'inherit'] }); let buf = '';
    proc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); wait.get(m.id)?.(m.text); wait.delete(m.id); } catch {} } });
    const t0 = Date.now();
    proc.on('exit', () => { wait.forEach(r => r('')); wait.clear(); crashes = Date.now() - t0 < 3000 ? crashes + 1 : 0; if (crashes >= 3) { dead = true; console.error('STT worker keeps crashing; server-side transcription disabled'); } else setTimeout(boot, 1000); });
  };
  boot();
  return { transcribe: pcm => new Promise(res => {
    if (dead) return res('');
    const rid = ++id, h = Buffer.alloc(8); h.writeUInt32BE(rid, 0); h.writeUInt32BE(pcm.length, 4); wait.set(rid, res);
    proc.stdin.write(Buffer.concat([h, pcm])); setTimeout(() => { if (wait.delete(rid)) res(''); }, 20000);
  }) };
}
