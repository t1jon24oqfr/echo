import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle in .next/standalone for Docker / DO App Platform.
  output: 'standalone',
};

export default nextConfig;
