import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/AuthForms";

export default function LoginPage() {
  return (
    <main className="content" style={{ maxWidth: 460, margin: "8vh auto" }}>
      <Link href="/" className="brand"><span className="mark">Q</span> Quorum</Link>
      <h1 className="serif">Sign in</h1>
      <div className="card card-pad">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
      <p><Link href="/forgot-password">Forgot password</Link> · <Link href="/register">Create an account</Link></p>
    </main>
  );
}
