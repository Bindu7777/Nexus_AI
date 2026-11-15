import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { site } from "@/marketing/content";
import "./site.css";
import "./motion.css";
import "./theme.css";

// next/font downloads these at build time and serves them from this site.
// The visitor's browser makes no third-party font request.
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const code = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains", display: "swap" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4317";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Nexus AI · Defect investigation that shows its work", template: "%s · Nexus AI" },
  description: site.description,
  applicationName: "Nexus AI",
  openGraph: {
    type: "website",
    siteName: "Nexus AI",
    title: "Nexus AI · Every bug has a cause. Nexus shows you the proof.",
    description: site.description,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nexus AI · Every bug has a cause. Nexus shows you the proof.",
    description: site.description,
  },
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  themeColor: "#071230",
};

// Applies a remembered manual theme before first paint. Runs locally; no network.
const themeScript = `document.documentElement.classList.add("js");var t=null;try{t=localStorage.getItem("nexus-theme");}catch(e){}document.documentElement.dataset.theme=t==="light"?"light":"dark"`;

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${code.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
