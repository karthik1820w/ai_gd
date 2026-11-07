import "dotenv/config";
import { spawn } from "child_process";
import { createServer as createHttp } from "http";
import { createServer as createHttps } from "https";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { networkInterfaces } from "os";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import { enableWal } from "../src/lib/db";
import { startLoops } from "../src/server/loops";
import { setIO } from "../src/server/realtime";
import { attachSignaling } from "../src/server/signaling";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const useHttps = process.argv.includes("--https") || process.env.USE_HTTPS === "1";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

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

function startMediaServer() {
  const binary = path.join(process.cwd(), "bin", "livekit-server.exe");
  if (!existsSync(binary)) {
    console.error("Media server binary is missing. Expected bin/livekit-server.exe.");
    return;
  }
  const apiKey = process.env.LIVEKIT_API_KEY || "devkey";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  if (!apiSecret) {
    console.error("LIVEKIT_API_SECRET is empty, so video rooms cannot start.");
    return;
  }
  const nodeIp = process.env.LIVEKIT_NODE_IP || lanAddresses()[0] || "127.0.0.1";
  const child = spawn(binary, ["--dev", "--bind", "0.0.0.0", "--node-ip", nodeIp, "--keys", `${apiKey}: ${apiSecret}`], {
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", (error) => console.error("Media server failed to start.", error));
  process.on("exit", () => child.kill());
  console.log("Media server starting on port 7880.");
}

async function main() {
startMediaServer();
await app.prepare();
await enableWal().catch(() => undefined);

const server = useHttps
  ? createHttps(
      {
        key: readFileSync("certs/key.pem"),
        cert: readFileSync("certs/cert.pem"),
      },
      (req, res) => {
        handle(req, res, parse(req.url || "/", true));
      },
    )
  : createHttp((req, res) => {
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
  if (!process.env.AI_API_KEY) console.log("No AI_API_KEY set. Relevance uses the built-in lexical model until you add one.");
  console.log("");
});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
