import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Parallel chats build into their own folder (NEXT_DIST_DIR=.next-a) so they don't collide.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // One folder that runs with `node server.js`: what the Dockerfile ships.
  output: 'standalone',
  // Native drivers stay out of the bundle (Next already lists better-sqlite3 and pg; kept here so it's explicit).
  serverExternalPackages: ['better-sqlite3', 'pg', '@electric-sql/pglite', '@electric-sql/pglite-socket'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/:path((?!api/|csv/|mcp/|oauth/|\\.well-known/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
