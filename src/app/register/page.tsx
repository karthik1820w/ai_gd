import Link from "next/link";
import { RegisterForm } from "@/components/AuthForms";

export default function RegisterPage() {
  return (
    <main className="content" style={{ maxWidth: 460, margin: "8vh auto" }}>
      <Link href="/" className="brand"><span className="mark">Q</span> Quorum</Link>
      <h1 className="serif">Create an account</h1>
      <p className="muted">Create a participant account. The host account is provisioned separately.</p>
      <div className="card card-pad"><RegisterForm /></div>
      <p><Link href="/login">Already registered</Link></p>
    </main>
  );
}
