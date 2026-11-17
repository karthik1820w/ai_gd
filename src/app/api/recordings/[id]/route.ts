import { readFile } from "fs/promises";
import { prisma } from "@/lib/db";
import { fail } from "@/lib/http";
import { requireUser } from "@/lib/guard";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const recording = await prisma.recording.findUnique({ where: { id }, include: { discussion: true, participant: true } });
  if (!recording) return fail("Recording not found.", 404);
  const allowed = recording.discussion.hostId === user.id || recording.participant.userId === user.id;
  if (!allowed) return fail("You cannot play this recording.", 403);
  const bytes = await readFile(recording.path);
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": recording.mime, "Content-Disposition": `attachment; filename="quorum-${recording.id}.webm"` },
  });
}
