import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // pg is a server-only dependency; keep it out of the client bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
