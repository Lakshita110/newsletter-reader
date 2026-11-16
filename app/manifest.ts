import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cluck's Feed",
    short_name: "Cluck's Feed",
    description:
      "Newsletters and news in one calm reading queue.",
    start_url: "/today",
    scope: "/",
    orientation: "portrait",
    display: "standalone",
    background_color: "#0F172A",
    theme_color: "#0F172A",
    shortcuts: [
      { name: "Today", url: "/today" },
      { name: "Saved", url: "/today?tab=saved" },
    ],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
