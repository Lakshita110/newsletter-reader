import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cluck's Feed",
    short_name: "Cluck's Feed",
    description:
      "A calm, focused way to read newsletters and RSS in one keyboard-friendly inbox.",
    start_url: "/",
    display: "standalone",
    background_color: "#0F172A",
    theme_color: "#0F172A",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
