import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Settings used to live under /rss/settings; keep old bookmarks and the
  // Gmail connect redirect from before the move working.
  async redirects() {
    return [{ source: "/rss/settings", destination: "/settings", permanent: true }];
  },
};

export default nextConfig;
