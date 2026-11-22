import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Personal Ledger", template: "%s · Personal Ledger" },
  description: "Private expense, budget and IOU tracker.",
  applicationName: "Personal Ledger",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Ledger", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#121412" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("ledger_theme")?.value;
  const dataTheme = theme === "light" || theme === "dark" ? theme : undefined;
  return (
    <html lang="en-IN" data-theme={dataTheme} className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
