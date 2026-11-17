import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { ThemeInitializer, ThemeToggle } from "./components/ThemeToggle";

// Fonts are self-hosted (latin subset, from @fontsource, OFL licensed) rather
// than loaded with next/font/google. The Google variant downloads the fonts
// during `next build`, so a Google Fonts hiccup fails the whole build: that
// happened in CI and likely on a production deploy on 2026-11-17. Local files
// make the build independent of the network.
const sans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  display: "swap",
});

const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

const display = localFont({
  src: [
    { path: "./fonts/playfair-display-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/playfair-display-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cluck's Feed",
  description:
    "A calm, focused way to read newsletters and RSS in one keyboard-friendly inbox.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Cluck's Feed",
  },
};

export const viewport: Viewport = {
  themeColor: "#0F172A",
  // Lets content extend under the iPhone notch/home bar; the Today and
  // reader layouts pad with env(safe-area-inset-*) to compensate.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${sans.className} ${mono.variable} ${display.variable}`}>
        <ThemeInitializer />
        <Providers>
          {children}
          <ThemeToggle className="global-theme-toggle" />
        </Providers>
      </body>
    </html>
  );
}
