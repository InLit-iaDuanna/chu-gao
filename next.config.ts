import type { NextConfig } from "next";

function remoteHosts() {
  return (process.env.NEXT_IMAGE_REMOTE_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: remoteHosts().map((hostname) => ({
      protocol: "https",
      hostname,
    })),
  },
};

export default nextConfig;
