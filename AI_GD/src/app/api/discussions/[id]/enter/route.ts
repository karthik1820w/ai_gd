import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, readBody } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { enterSchema } from "@/lib/validators";
import { canAccess, seatsTaken } from "@/server/access";
import { notify } from "@/server/notify";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id } });
  if (!discussion || discussion.status === "CANCELLED" || discussion.status === "COMPLETED") return fail("This discussion is not open.", 409);
  const parsed = enterSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Add the name you want shown in the meeting.");
  if (discussion.transcriptionEnabled && !parsed.data.transcriptionConsent) return fail("Transcription is on for this discussion. Consent is required to join.");
  if (discussion.recordingEnabled && !parsed.data.recordingConsent) return fail("Recording is on for this discussion. Consent is required to join.");
  const access = await canAccess({ meetingId: discussion.meetingId, userId: user.id, role: user.role, code: parsed.data.code ?? null });
  if (!access) return fail("The access code is not valid.", 403);
  if ("error" in access && access.error) return fail(access.error, 403);
  const existing = await prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId: id, userId: user.id } } });
  if (existing?.removed) return fail("The host removed you from this discussion.", 403);
  if (!existing && user.id !== discussion.hostId) {
    const seated = await seatsTaken(id, discussion.hostId);
    if (seated >= discussion.maxParticipants) return fail("This discussion is full.", 409);
  }
  const participant = existing
    ? await prisma.discussionParticipant.update({
        where: { id: existing.id },
        data: {
          displayName: parsed.data.displayName,
          transcriptionConsent: parsed.data.transcriptionConsent,
          recordingConsent: parsed.data.recordingConsent,
          speechAvailable: parsed.data.speechAvailable,
          consentAt: new Date(),
          removed: false,
        },
      })
    : await prisma.discussionParticipant.create({
        data: {
          discussionId: id,
          userId: user.id,
          displayName: parsed.data.displayName,
          transcriptionConsent: parsed.data.transcriptionConsent || user.id === discussion.hostId,
          recordingConsent: parsed.data.recordingConsent,
          speechAvailable: parsed.data.speechAvailable,
          consentAt: new Date(),
        },
      });
  await prisma.speakingStat.upsert({ where: { participantId: participant.id }, create: { participantId: participant.id }, update: {} });
  if (!existing && user.id !== discussion.hostId) {
    await notify({
      userId: user.id,
      discussionId: id,
      type: "JOINED",
      title: "You joined a discussion",
      body: discussion.title,
      href: `/meeting/${discussion.meetingId}`,
    });
    await notify({
      userId: discussion.hostId,
      discussionId: id,
      type: "JOINED",
      title: `${parsed.data.displayName} joined`,
      body: discussion.title,
      href: `/host/sessions/${discussion.id}`,
    });
  }
  return json({ participantId: participant.id, status: discussion.status });
}
