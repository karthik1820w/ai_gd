import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

const pythonBinary = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const workerScript = path.join(process.cwd(), "scripts", "stt", "worker.py");
const defaultModelPath = path.join(process.cwd(), "models", "sherpa-onnx-whisper-tiny.en");

export interface STTWorkerClient {
  transcribe: (pcm: Buffer) => Promise<string>;
  close: () => void;
}

/**
 * Binary protocol encoder: [u32 id][u32 byte_length][pcm data]
 */
export function encodeSTTPacket(id: number, pcm: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(id, 0);
  header.writeUInt32BE(pcm.length, 4);
  return Buffer.concat([header, pcm]);
}

/**
 * Binary protocol decoder: parses the 8-byte header and extracts PCM payload
 */
export function decodeSTTPacket(buffer: Buffer): { id: number; length: number; pcm: Buffer } | null {
  if (buffer.length < 8) return null;
  const id = buffer.readUInt32BE(0);
  const length = buffer.readUInt32BE(4);
  if (buffer.length < 8 + length) return null;
  const pcm = buffer.subarray(8, 8 + length);
  return { id, length, pcm };
}

let activeClient: STTWorkerClient | null = null;

/**
 * Creates or retrieves the STT worker client that communicates over stdin/stdout
 * with an offline Whisper / sherpa-onnx Python process.
 */
export function getSTTClient(): STTWorkerClient | null {
  if (activeClient) return activeClient;
  if (!fs.existsSync(workerScript)) return null;

  let proc: ChildProcess | null = null;
  let requestId = 0;
  let crashCount = 0;
  let isDead = false;
  const pendingRequests = new Map<number, (text: string) => void>();

  const startWorker = () => {
    const modelDir = process.env.STT_MODEL_DIR || (fs.existsSync(defaultModelPath) ? defaultModelPath : "");
    proc = spawn(pythonBinary, [workerScript], {
      env: { ...process.env, STT_MODEL_DIR: modelDir },
      stdio: ["pipe", "pipe", "inherit"],
    });

    let buffer = "";
    proc.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        try {
          const res = JSON.parse(line);
          const resolve = pendingRequests.get(res.id);
          if (resolve) {
            resolve(res.text || "");
            pendingRequests.delete(res.id);
          }
        } catch {
          // ignore malformed lines
        }
      }
    });

    const startTime = Date.now();
    proc.on("exit", () => {
      pendingRequests.forEach((res) => res(""));
      pendingRequests.clear();
      crashCount = Date.now() - startTime < 3000 ? crashCount + 1 : 0;
      if (crashCount >= 3) {
        isDead = true;
        console.warn("[STT] Worker exited repeatedly; server-side STT disabled.");
      } else if (!isDead) {
        setTimeout(startWorker, 1000);
      }
    });
  };

  startWorker();

  activeClient = {
    transcribe: (pcm: Buffer): Promise<string> => {
      return new Promise((resolve) => {
        if (isDead || !proc || !proc.stdin) {
          return resolve("");
        }
        const id = ++requestId;
        const header = Buffer.alloc(8);
        header.writeUInt32BE(id, 0);
        header.writeUInt32BE(pcm.length, 4);

        pendingRequests.set(id, resolve);
        proc.stdin.write(Buffer.concat([header, pcm]));

        setTimeout(() => {
          if (pendingRequests.delete(id)) {
            resolve("");
          }
        }, 20_000);
      });
    },
    close: () => {
      isDead = true;
      proc?.kill();
      activeClient = null;
    },
  };

  return activeClient;
}

