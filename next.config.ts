import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Turbopack scoped to this repo even when a parent package-lock.json exists.
  turbopack: { root: process.cwd() },
  // These packages use Node APIs; load them natively instead of bundling.
  serverExternalPackages: ["mammoth", "unpdf"],
  // The dev server only trusts `localhost` and its own hostname out of the box.
  // Opening http://127.0.0.1:3000 instead makes Next block /_next/* dev assets,
  // which leaves client components (the admin login form, the dashboard filters)
  // unhydrated and unclickable even though the server HTML looks fine.
  // Entries are bare hostnames: no scheme, no port.
  allowedDevOrigins: ["127.0.0.1", "0.0.0.0"],
};

export default nextConfig;
