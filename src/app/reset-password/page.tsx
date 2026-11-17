import Link from "next/link";
import { ResetForm } from "@/components/AuthForms";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="content" style={{ maxWidth: 460, margin: "8vh auto" }}>
      <Link href="/" className="brand"><span className="mark">Q</span> Quorum</Link>
      <h1 className="serif">Choose a new password</h1>
      <div className="card card-pad">{token ? <ResetForm token={token} /> : <p>This reset link is missing a token.</p>}</div>
    </main>
  );
}
