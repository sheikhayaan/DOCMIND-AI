import type { Metadata } from "next";

import PageTransition from "@/components/PageTransition";
import "./globals.css";

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
    <html lang="en" className="h-full bg-[#000000] antialiased">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="noise flex min-h-full flex-col bg-[#000000]">
        <PageTransition>{children}</PageTransition>
      </body>
    </html>
  );
}
