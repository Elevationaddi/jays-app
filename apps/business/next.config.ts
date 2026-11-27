import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Document (10 MB) and image (5 MB) uploads pass through Server Actions to signed URLs.
    serverActions: { bodySizeLimit: '11mb' },
  },
};

export default config;
