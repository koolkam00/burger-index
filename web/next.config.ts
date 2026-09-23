import type { NextConfig } from "next";

// Fully static: `next build` writes the whole site to out/ (no server code, no API keys).
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
