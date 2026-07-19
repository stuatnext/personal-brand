import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + native-ish assets that must not be bundled by webpack/turbopack.
  serverExternalPackages: ["@electric-sql/pglite"],
  eslint: {
    // Lint runs as an explicit `npm run lint` step (covers scripts/ and tests/ too).
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
