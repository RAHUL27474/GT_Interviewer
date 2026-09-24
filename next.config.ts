import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mammoth reads DOCX files with Node APIs; load it natively instead of bundling.
  serverExternalPackages: ["mammoth"],
};

export default nextConfig;
