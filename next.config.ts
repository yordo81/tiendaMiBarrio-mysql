import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Turbopack is stable in Next.js 15
  // Enable server actions (stable in v15)
  experimental: {},
};

export default nextConfig;
