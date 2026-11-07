import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) redirect("/login");
  const { id } = await params;
  const type = user.role === "HOST" ? "COMBINED" : "INDIVIDUAL";
  return (
    <main className="content">
      <h1 className="serif">PDF preview</h1>
      <iframe title="Report preview" src={`/api/discussions/${id}/pdf?type=${type}`} style={{ width: "100%", height: "80vh", border: "1px solid var(--line)", borderRadius: 16, background: "white" }} />
    </main>
  );
}
