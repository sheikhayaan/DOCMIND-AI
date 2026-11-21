import type { Metadata } from "next";

import AuthGate from "@/components/AuthGate";
import BackendWarmup from "@/components/BackendWarmup";
import PageTransition from "@/components/PageTransition";
import WebVitals from "@/components/WebVitals";
import "./globals.css";

// Nonce-based CSP requires per-request rendering: a prerendered shell cannot
// carry the request nonce that middleware generates.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "DocMind AI - Chat with your documents",
  description:
    "Upload any PDF and get instant AI answers with exact source citations. Powered by Groq, HuggingFace, and RAG.",
  openGraph: {
    title: "DocMind AI - Chat with your documents",
    description:
      "Upload any PDF and get instant AI answers with exact source citations. Powered by Groq, HuggingFace, and RAG.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "DocMind AI chat interface screenshot",
      },
    ],
  },
};

// Renders the root document shell with app-wide metadata and transitions.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full bg-[#000000] antialiased"
    >
      <body className="noise flex min-h-full flex-col bg-[#000000]">
        <WebVitals />
        <BackendWarmup />
        <AuthGate>
          <PageTransition>{children}</PageTransition>
        </AuthGate>
      </body>
    </html>
  );
}
