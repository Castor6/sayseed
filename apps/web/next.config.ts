import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@sayseed/shared'],
  serverExternalPackages: ['better-sqlite3'],
  poweredByHeader: false,
};

export default config;
