import "dotenv/config";
import { createServer as createHttp } from "http";
import { createServer as createHttps } from "https";
import { existsSync, readFileSync } from "fs";
import { networkInterfaces } from "os";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import { startLoops } from "../src/server/loops";
import { setIO } from "../src/server/realtime";
import { attachSignaling } from "../src/server/signaling";
import { resolveClientAddress } from "../src/server/clientAddress";
import { startMediaServer, stopMediaServer } from "../src/server/media";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const useHttps = process.argv.includes("--https") || process.env.USE_HTTPS === "1";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function sanitizeForwardingHeaders(req: import("http").IncomingMessage) {
  const trustProxy = process.env.TRUST_PROXY === "1";
  const address = resolveClientAddress(
    req.socket.remoteAddress,
    {
      forwardedFor: req.headers["x-forwarded-for"],
      realIp: req.headers["x-real-ip"],
    },
    trustProxy,
  );
  req.headers["x-real-ip"] = address;
  if (!trustProxy) {
    delete req.headers["x-forwarded-for"];
    delete req.headers["x-forwarded-host"];
    delete req.headers["x-forwarded-proto"];
  }
}

function lanAddresses() {
  const virtualName = /virtual|hyper-v|vethernet|wsl|docker|vmware|vbox|bluetooth|npcap|\btap\b|tun|loopback/i;
  const ranked: Array<{ address: string; rank: number }> = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (virtualName.test(name) || entry.address.startsWith("192.168.56.")) continue;
      ranked.push({ address: entry.address, rank: /wi-?fi|wireless|wlan/i.test(name) ? 0 : 1 });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((item) => item.address);
}

if (useHttps && (!existsSync("certs/key.pem") || !existsSync("certs/cert.pem"))) {
  console.error("Missing certs/key.pem or certs/cert.pem. Run npm run cert first.");
  process.exit(1);
}

async function main() {
const missing = [];
if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16 || process.env.JWT_SECRET.startsWith("replace-with-")) missing.push("JWT_SECRET (at least 16 characters)");
if (missing.length) {
  throw new Error(`Missing required configuration: ${missing.join(", ")}. Copy .env.example to .env and run npm run setup.`);
}
process.env.LIVEKIT_NODE_IP ||= lanAddresses()[0] || "127.0.0.1";
await startMediaServer();
await app.prepare();

const server = useHttps
  ? createHttps(
      {
        key: readFileSync("certs/key.pem"),
        cert: readFileSync("certs/cert.pem"),
      },
      (req, res) => {
        sanitizeForwardingHeaders(req);
        req.headers["x-forwarded-proto"] = "https";
        handle(req, res, parse(req.url || "/", true));
      },
    )
  : createHttp((req, res) => {
      sanitizeForwardingHeaders(req);
      handle(req, res, parse(req.url || "/", true));
    });

const io = new Server(server);
setIO(io);
attachSignaling(io);
startLoops();

server.listen(port, hostname, () => {
  const protocol = useHttps ? "https" : "http";
  console.log(`\nQuorum is running at ${protocol}://localhost:${port}`);
  for (const address of lanAddresses()) console.log(`On this network: ${protocol}://${address}:${port}`);
  if (!useHttps) console.log("Camera and microphone on a phone need HTTPS. Run npm run cert, then npm run dev:https.");
  if (!process.env.GEMINI_API_KEY && !process.env.GEMINI_FLASH_API_KEY) console.log("No Gemini key set. AI features use the heuristic fallback until you add one.");
  console.log("");
});
}

main().catch((error) => {
  console.error(error);
  void stopMediaServer().finally(() => process.exit(1));
});

let shuttingDown = false;
function shutdown(code: number, error?: unknown) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (error) console.error("Server is shutting down after an unexpected error.", error);
  void stopMediaServer().finally(() => process.exit(code));
}
process.once("SIGINT", () => shutdown(130));
process.once("SIGTERM", () => shutdown(143));
process.once("uncaughtException", (error) => shutdown(1, error));
