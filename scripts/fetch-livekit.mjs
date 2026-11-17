import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = { win32: "windows", linux: "linux" }[process.platform];
const architecture = { x64: "amd64", arm64: "arm64" }[process.arch];

async function fetchWithRetry(url, options, description) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      if (attempt === 3) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not fetch ${description}: ${detail}`, { cause: error });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }

    if (response.ok) return response;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
      throw new Error(`Could not fetch ${description} (${response.status}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error(`Could not fetch ${description} after retries.`);
}

if (!platform || !architecture) {
  throw new Error(`No official LiveKit release binary is available for ${process.platform}/${process.arch}. Use Docker or set LIVEKIT_BINARY.`);
}

const releaseResponse = await fetchWithRetry("https://api.github.com/repos/livekit/livekit/releases/latest", {
  headers: { Accept: "application/vnd.github+json", "User-Agent": "quorum-setup" },
}, "the latest LiveKit release");
const release = await releaseResponse.json();
const asset = release.assets.find((item) => item.name.startsWith(`livekit_${release.tag_name.replace(/^v/, "")}_${platform}_${architecture}.`));
const checksumAsset = release.assets.find((item) => item.name === "checksums.txt");
if (!asset || !checksumAsset) throw new Error(`The latest LiveKit release has no ${platform}/${architecture} binary or checksum.`);

const checksumResponse = await fetchWithRetry(checksumAsset.browser_download_url, {
  headers: { "User-Agent": "quorum-setup" },
}, "LiveKit checksums");
const checksumText = await checksumResponse.text();
const checksumLine = checksumText.split(/\r?\n/).find((line) => line.includes(asset.name));
const expectedHash = checksumLine?.match(/[a-f\d]{64}/i)?.[0];
if (!expectedHash) throw new Error(`No SHA-256 checksum was published for ${asset.name}.`);

const archiveResponse = await fetchWithRetry(asset.browser_download_url, {
  headers: { "User-Agent": "quorum-setup" },
}, asset.name);
const archive = Buffer.from(await archiveResponse.arrayBuffer());
const actualHash = createHash("sha256").update(archive).digest("hex");
if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
  throw new Error(`LiveKit checksum mismatch for ${asset.name}; the archive was not installed.`);
}

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "quorum-livekit-"));
try {
  const archivePath = path.join(temporaryDirectory, asset.name);
  const extractionPath = path.join(temporaryDirectory, "extracted");
  mkdirSync(extractionPath, { recursive: true });
  writeFileSync(archivePath, archive);
  if (process.platform === "win32") {
    const quote = (value) => `'${value.replace(/'/g, "''")}'`;
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath ${quote(archivePath)} -DestinationPath ${quote(extractionPath)} -Force`,
    ], { stdio: "inherit" });
  } else {
    execFileSync("tar", ["-xzf", archivePath, "-C", temporaryDirectory], { stdio: "inherit" });
  }

  const expectedName = process.platform === "win32" ? "livekit-server.exe" : "livekit-server";
  const findBinary = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const found = findBinary(current);
        if (found) return found;
      } else if (entry.name === expectedName) {
        return current;
      }
    }
    return null;
  };
  const binary = findBinary(extractionPath);
  if (!binary) throw new Error(`The ${asset.name} archive did not contain ${expectedName}.`);
  const destination = path.join(root, "bin", expectedName);
  const staged = `${destination}.download`;
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(binary, staged);
  if (process.platform !== "win32") chmodSync(staged, 0o755);
  renameSync(staged, destination);
  console.log(`Installed verified LiveKit ${release.tag_name} at ${path.relative(root, destination)}.`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
