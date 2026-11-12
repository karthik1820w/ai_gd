import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const examplePath = path.join(root, ".env.example");

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log("Created .env from .env.example.");
}

let env = readFileSync(envPath, "utf8");
function setSecret(name) {
  const match = env.match(new RegExp(`^${name}=(.*)$`, "m"));
  const current = match?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
  if (current.length >= 32 && !current.startsWith("replace-with-")) return;
  const secret = randomBytes(32).toString("base64url");
  if (match) env = env.replace(new RegExp(`^${name}=.*$`, "m"), `${name}="${secret}"`);
  else env += `\n${name}="${secret}"\n`;
  console.log(`Generated ${name} in .env.`);
}

setSecret("JWT_SECRET");
// A local media server needs a generated secret; a hosted LiveKit project brings its own.
if (!/^LIVEKIT_URL=["']?\S/m.test(env)) setSecret("LIVEKIT_API_SECRET");
writeFileSync(envPath, env);

const hostEmail = env.match(/^HOST_EMAIL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
const hostPassword = env.match(/^HOST_PASSWORD=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
if (!hostEmail || hostPassword.length < 8) {
  console.error("\nSet HOST_EMAIL and HOST_PASSWORD (at least 8 characters) in .env, then run `npm run setup` again.");
  process.exit(1);
}

function runNpm(args) {
  const result = spawnSync("npm", args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed with exit code ${result.status}.`);
}

runNpm(["run", "db:push"]);
runNpm(["run", "seed"]); // creates the host from HOST_EMAIL / HOST_PASSWORD
if (process.platform === "darwin") {
  console.log("LiveKit does not publish macOS server binaries. Start it with Docker; see README.md.");
} else {
  runNpm(["run", "fetch:livekit"]);
}
console.log("Setup is complete. Start Quorum with `npm run dev`.");
