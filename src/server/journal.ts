import fs from "fs";
import path from "path";

const dir = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "journal")
  : path.join(process.cwd(), "data", "journal");

try {
  fs.mkdirSync(dir, { recursive: true });
} catch {
  // directory might already exist
}

const openStreams = new Map<string, fs.WriteStream>();

/**
 * Logs an append-only room event into a JSONL file per discussion.
 * Survives crashes and restarts for full auditability.
 */
export function logEvent(discussionId: string, type: string, data: Record<string, unknown> = {}): void {
  try {
    let stream = openStreams.get(discussionId);
    if (!stream) {
      const filePath = path.join(dir, `${discussionId}.jsonl`);
      stream = fs.createWriteStream(filePath, { flags: "a" });
      openStreams.set(discussionId, stream);
    }
    const line = JSON.stringify({ t: Date.now(), type, ...data }) + "\n";
    stream.write(line);
  } catch (err) {
    console.error("journal write error:", err);
  }
}

/**
 * Atomically writes a finalized session report and transcript snapshot (.final.json).
 */
export function finalizeJournal(discussionId: string, summary: Record<string, unknown>): void {
  try {
    const finalFile = path.join(dir, `${discussionId}.final.json`);
    const tempFile = `${finalFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(summary, null, 2), "utf8");
    fs.renameSync(tempFile, finalFile); // Atomic on POSIX and NTFS within same volume

    const stream = openStreams.get(discussionId);
    if (stream) {
      stream.end();
      openStreams.delete(discussionId);
    }
  } catch (err) {
    console.error("journal finalize error:", err);
  }
}

