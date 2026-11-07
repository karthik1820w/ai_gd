import Link from "next/link";
import { ForgotForm } from "@/components/AuthForms";

export default function ForgotPage() {
  return (
    <main className="content" style={{ maxWidth: 460, margin: "8vh auto" }}>
      <Link href="/" className="brand"><span className="mark">Q</span> Quorum</Link>
      <h1 className="serif">Reset password</h1>
      <div className="card card-pad"><ForgotForm /></div>
      <p className="muted">Without SMTP settings, a development reset link is shown on this machine and printed in the server log. It is not included in production.</p>
    </main>
  );
}
