import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parakkat AI Office",
  description: "Take a known problem to verified closure, and prove it stayed closed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=DM+Serif+Display&display=swap"
        />
        <link rel="stylesheet" href="/ds/tokens.css" />
        <link rel="stylesheet" href="/ds/bundle.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
