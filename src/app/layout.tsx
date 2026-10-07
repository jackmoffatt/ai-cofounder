import type { Metadata } from "next";
import { AppShell } from "@/components/shell/AppShell";
import { themeInitScript } from "@/lib/theme";
import { setupProblem } from "@/services/health";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Co-Founder",
  description: "Your private startup co-founder.",
};

// The setup notice (e.g. no API key) is read per request, not baked in at build time.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <AppShell setupProblem={setupProblem()}>{children}</AppShell>
      </body>
    </html>
  );
}
