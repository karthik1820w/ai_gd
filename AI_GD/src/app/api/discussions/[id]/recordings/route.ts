import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { fail, json } from "@/lib/http";
import { requireUser } from "@/lib/guard";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id } });
  if (!discussion?.recordingEnabled) return fail("Recording is off for this discussion.", 409);
  const participant = await prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId: id, userId: user.id } } });
  if (!participant?.recordingConsent) return fail("Recording consent is missing.", 403);
  const form = await request.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) return fail("Attach an audio recording.");
  if (file.size > 80 * 1024 * 1024) return fail("Recording is larger than 80 MB.", 413);
  const bytes = Buffer.from(await file.arrayBuffer());
  const dir = path.join(process.cwd(), "data", "recordings", id);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${participant.id}.webm`);
  await writeFile(target, bytes);
  const recording = await prisma.recording.upsert({
    where: { participantId: participant.id },
    create: { discussionId: id, participantId: participant.id, path: target, bytes: bytes.length, mime: file.type || "audio/webm" },
    update: { path: target, bytes: bytes.length, mime: file.type || "audio/webm" },
  });
  return json({ id: recording.id });
}
