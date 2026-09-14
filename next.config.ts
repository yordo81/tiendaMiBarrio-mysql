import type { NextConfig } from 'next';
import packageJson from './package.json';

// Origen de la app en desarrollo, útil para validaciones de origen y HMR.
// Ej: http://localhost:3000 o https://localhost:3000 si se usa HTTPS local.
const appOrigin = process.env.APP_ORIGIN?.trim() ?? 'http://localhost:3000';

// Hostnames allowed to request dev-only resources (HMR, etc.) in development.
// Configure via env var: ALLOWED_DEV_ORIGINS="foo.com,*.bar.dev"
// Wildcards: * = one label, ** = one or more labels (start of pattern only).
// No effect in production builds.
const allowedDevOrigins = process.env.ALLOWED_DEV_ORIGINS
  ? process.env.ALLOWED_DEV_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [appOrigin, 'www.tiendamb.com', 'tiendamb.com'];

const nextConfig: NextConfig = {
  output: 'standalone',
  allowedDevOrigins,
  env: {
    // Single source of truth for the app version is package.json "version".
    // Inlined at build time, so it always matches the compiled build.
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    // Origen actual de la app, útil para clientes que necesitan construir URLs absolutas.
    APP_ORIGIN: appOrigin,
  },
};

export default nextConfig;
