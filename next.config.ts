import type { NextConfig } from "next";

function remoteHosts() {
  return (process.env.NEXT_IMAGE_REMOTE_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const nextConfig: NextConfig = {
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  output: "standalone",
  devIndicators: false,
  outputFileTracingExcludes: {
    "*": [".data/**", "output/**"],
  },
  experimental: {
    middlewareClientMaxBodySize: "12mb",
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  images: {
    remotePatterns: remoteHosts().map((hostname) => ({
      protocol: "https",
      hostname,
    })),
  },
};

export default nextConfig;
