import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { SiteHeader } from "@/components/site-header";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

import "./globals.css";

const inter = Inter({
  variable: "--font-notion-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Peach",
  description: "FastAPI + Next.js + Postgres starter",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* Extensions such as Grammarly stamp attributes on <body> before React
          hydrates; this silences that one-level mismatch only. */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <Providers>
          <SiteHeader />
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
