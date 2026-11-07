import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, readBody, clientKey, rateLimit } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { addSegment } from "@/server/segments";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser();
  if (!user) return error;
  if (!rateLimit(`segment:${user.id}`, 30, 60_000)) return fail("Slow down a little.", 429);
  const { id } = await context.params;
  const body = (await readBody(request)) as { text?: string } | null;
  const segment = await addSegment({ discussionId: id, userId: user.id, text: body?.text ?? "" });
  if (!segment) return fail("That line was not stored. Join with transcription consent and speak in a full phrase.", 400);
  return json(segment);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id }, include: { participants: true } });
  if (!discussion) return fail("Discussion not found.", 404);
  const allowed = discussion.hostId === user.id || discussion.participants.some((participant) => participant.userId === user.id);
  if (!allowed) return fail("You cannot view this transcript.", 403);
  const segments = await prisma.transcriptSegment.findMany({ where: { discussionId: id }, orderBy: { startedAt: "asc" }, include: { participant: true } });
  return json(segments.map((segment) => ({ id: segment.id, name: segment.participant.displayName, text: segment.text, relevance: segment.relevance, reason: segment.relevanceReason, startedAt: segment.startedAt })));
}
