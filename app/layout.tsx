import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { ThemeInitializer, ThemeToggle } from "./components/ThemeToggle";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

const display = Playfair_Display({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Cluck's Feed",
  description:
    "A calm, focused way to read newsletters and RSS in one keyboard-friendly inbox.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
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
