import Link from "next/link";
import { RegisterForm } from "@/components/AuthForms";

export default function RegisterPage() {
  return (
    <main className="content" style={{ maxWidth: 460, margin: "8vh auto" }}>
      <Link href="/" className="brand"><span className="mark">Q</span> Quorum</Link>
      <h1 className="serif">Create an account</h1>
      <p className="muted">Choose host if you will organise discussions. Choose participant if you will join them. One account has one role.</p>
      <div className="card card-pad"><RegisterForm /></div>
      <p><Link href="/login">Already registered</Link></p>
    </main>
  );
}
