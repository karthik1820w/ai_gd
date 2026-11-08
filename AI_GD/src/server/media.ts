import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { RoomServiceClient } from "livekit-server-sdk";

export type MediaStatus = {
  ready: boolean;
  managed: boolean;
  error: string | null;
};

const status: MediaStatus = {
  ready: false,
  managed: false,
  error: "Media server has not started yet.",
};

let child: ChildProcess | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let stopping = false;
let restartCount = 0;
let lastMediaProbe: { checkedAt: number; ready: boolean } | null = null;
let mediaProbe: Promise<boolean> | null = null;

export function resolveMediaBinary(
  platform = process.platform,
  arch = process.arch,
  customPath = process.env.LIVEKIT_BINARY || "",
  cwd = process.cwd(),
) {
  if (customPath.trim()) return path.resolve(cwd, customPath.trim());
  if (!["win32", "linux", "darwin"].includes(platform) || !["x64", "arm64"].includes(arch)) {
    throw new Error(`LiveKit is not supported on ${platform}/${arch}.`);
  }
  const filename = platform === "win32" ? "livekit-server.exe" : "livekit-server";
  return path.join(cwd, "bin", filename);
}

async function mediaResponding() {
  if (mediaProbe) return mediaProbe;
  if (lastMediaProbe && Date.now() - lastMediaProbe.checkedAt < 3000) return lastMediaProbe.ready;
  const host = (process.env.LIVEKIT_HOST || "http://127.0.0.1:7880").replace(/\/+$/, "");
  mediaProbe = (async () => {
    try {
      const response = await fetch(`${host}/`, { signal: AbortSignal.timeout(1500) });
      if (response.status >= 500) return false;
      await new RoomServiceClient(host, process.env.LIVEKIT_API_KEY || "devkey", process.env.LIVEKIT_API_SECRET || "").listRooms();
      return true;
    } catch {
      return false;
    }
  })();
  try {
    const ready = await mediaProbe;
    lastMediaProbe = { checkedAt: Date.now(), ready };
    return ready;
  } finally {
    mediaProbe = null;
  }
}

function setUnavailable(error: string) {
  lastMediaProbe = null;
  status.ready = false;
  status.error = error;
}

function scheduleRestart() {
  if (stopping || restartTimer) return;
  const delay = Math.min(30_000, 1000 * 2 ** restartCount++);
  console.error(`LiveKit is restarting in ${Math.round(delay / 1000)} second(s).`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startManagedServer();
  }, delay);
}

async function startManagedServer() {
  if (stopping || child) return;
  if (!process.env.LIVEKIT_API_SECRET) {
    setUnavailable("Set LIVEKIT_API_SECRET in .env to enable video.");
    return;
  }
  if (await mediaResponding()) {
    status.ready = true;
    status.managed = false;
    status.error = null;
    restartCount = 0;
    console.log("Using the LiveKit server already listening at the configured address.");
    return;
  }

  let binary: string;
  try {
    binary = resolveMediaBinary();
  } catch (error) {
    const message = error instanceof Error ? error.message : "The LiveKit platform is unsupported.";
    setUnavailable(message);
    console.error(message);
    return;
  }
  if (!existsSync(/*turbopackIgnore: true*/ binary)) {
    setUnavailable("LiveKit server is missing. Run `npm run fetch:livekit`, set LIVEKIT_BINARY, or start the Docker alternative.");
    console.error(`Media server binary not found at ${binary}.`);
    return;
  }

  status.ready = false;
  status.managed = true;
  status.error = "LiveKit is starting.";
  const apiKey = process.env.LIVEKIT_API_KEY || "devkey";
  const nodeIp = process.env.LIVEKIT_NODE_IP || undefined;
  const childProcess = spawn(/*turbopackIgnore: true*/
    binary,
    ["--dev", "--bind", "0.0.0.0", ...(nodeIp ? ["--node-ip", nodeIp] : []), "--keys", `${apiKey}: ${process.env.LIVEKIT_API_SECRET}`],
    { stdio: "inherit", windowsHide: true },
  );
  child = childProcess;
  childProcess.once("error", (error) => {
    if (child === childProcess) child = null;
    setUnavailable(`LiveKit failed to start: ${error.message}`);
    console.error("Media server failed to start.", error);
    scheduleRestart();
  });
  childProcess.once("exit", (code, signal) => {
    if (child === childProcess) child = null;
    if (stopping) return;
    setUnavailable(`LiveKit exited (${signal || code || "unknown"}).`);
    console.error(status.error);
    scheduleRestart();
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && child === childProcess && !stopping) {
    if (await mediaResponding()) {
      status.ready = true;
      status.error = null;
      restartCount = 0;
      console.log("LiveKit is ready on port 7880.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (child === childProcess && !stopping) {
    setUnavailable("LiveKit did not become healthy. Check the media server logs and LIVEKIT_HOST.");
    childProcess.kill();
  }
}

export async function startMediaServer() {
  stopping = false;
  if (!process.env.LIVEKIT_API_SECRET) {
    setUnavailable("Set LIVEKIT_API_SECRET in .env to enable video.");
    console.error(status.error);
    return;
  }
  if (await mediaResponding()) {
    status.ready = true;
    status.managed = false;
    status.error = null;
    console.log("Using the LiveKit server already listening at the configured address.");
    return;
  }
  await startManagedServer();
}

export async function getMediaStatus(): Promise<MediaStatus> {
  if (!process.env.LIVEKIT_API_SECRET) {
    setUnavailable("Set LIVEKIT_API_SECRET in .env to enable video.");
    return { ...status };
  }

  if (await mediaResponding()) {
    status.ready = true;
    status.error = null;
  } else if (status.ready) {
    setUnavailable("LiveKit is not responding. Check that the media server is running.");
  }
  return { ...status };
}

export async function stopMediaServer() {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  const current = child;
  child = null;
  if (!current || current.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2000);
    current.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    current.kill();
  });
}
