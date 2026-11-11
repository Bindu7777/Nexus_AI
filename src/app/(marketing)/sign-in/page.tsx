import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/marketing/components/icons";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Company and admin portals for Nexus AI are not available yet.",
  robots: { index: false },
};

export default function SignInPage() {
  return (
    <main className="placeholder" id="main">
      <div className="panel">
        <Link href="/" className="wordmark" style={{ marginBottom: 28 }}>
          <Logo />
          Nexus AI
        </Link>
        <h1>Sign in is coming later.</h1>
        <p>
          The company portal and the admin portal are planned and not built yet. Pilot customers work with the Nexus
          team directly for now.
        </p>
        <p>
          <Link href="/">Back to the site</Link>
        </p>
      </div>
    </main>
  );
}
