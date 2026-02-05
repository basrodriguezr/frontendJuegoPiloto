import type { Metadata } from "next";
import "@fontsource/geist-sans/latin.css";
import "@fontsource/geist-mono/latin.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "e-Instant MVP",
  description: "Frontend React + Next.js + Phaser para MVP e-Instant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
