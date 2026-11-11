import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // A lockfile in a parent directory, including a home directory, must not become
  // the Turbopack root. Module resolution stays inside this project.
  turbopack: {
    root: projectRoot,
  },
  // Loopback only. Setting this switches Next from warn to enforce, so 127.0.0.1
  // has to be listed or HMR and dev stack-frame requests from that origin are blocked.
  // Do not use a wildcard.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
