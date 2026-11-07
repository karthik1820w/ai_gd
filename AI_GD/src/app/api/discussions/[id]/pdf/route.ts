import { prisma } from "@/lib/db";
import { fail } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { renderReport } from "@/server/pdf";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "INDIVIDUAL").toUpperCase();
  if (!["INDIVIDUAL", "SUMMARY", "COMBINED", "TRANSCRIPT"].includes(type)) return fail("Unknown report type.");
  const rendered = await renderReport({
    discussionId: id,
    type,
    participantId: url.searchParams.get("participantId") || undefined,
    requesterId: user.id,
  });
  if (!("buffer" in rendered) || !rendered.buffer || !rendered.filename) {
    const message = "error" in rendered && rendered.error ? rendered.error : "Could not build the PDF.";
    const status = "status" in rendered && typeof rendered.status === "number" ? rendered.status : 400;
    return fail(message, status);
  }
  await prisma.report.updateMany({
    where: { discussionId: id, type: type as "INDIVIDUAL" | "SUMMARY" | "COMBINED" | "TRANSCRIPT", participantId: type === "INDIVIDUAL" ? rendered.participantId ?? null : null },
    data: { lastDownloadedAt: new Date() },
  });
  const download = url.searchParams.get("download") === "1";
  return new Response(new Uint8Array(rendered.buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${rendered.filename}"`,
    },
  });
}
