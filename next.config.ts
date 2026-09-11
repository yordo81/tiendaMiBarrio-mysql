import type { NextConfig } from 'next';
import packageJson from './package.json';

// Hostnames allowed to request dev-only resources (HMR, etc.) in development.
// Configure via env var: ALLOWED_DEV_ORIGINS="foo.com,*.bar.dev"
// Wildcards: * = one label, ** = one or more labels (start of pattern only).
// No effect in production builds.
const allowedDevOrigins = process.env.ALLOWED_DEV_ORIGINS
  ? process.env.ALLOWED_DEV_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : ['www.tiendamb.com', 'tiendamb.com'];

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins,
  env: {
    // Single source of truth for the app version is package.json "version".
    // Inlined at build time, so it always matches the compiled build.
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
};

export default nextConfig;
