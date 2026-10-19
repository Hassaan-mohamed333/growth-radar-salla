/** The production API when API_URL is not provided. Kept so existing Vercel builds keep working. */
const DEFAULT_API_URL = 'https://growth-radar-salla.onrender.com';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Same-origin API: the browser calls /api/* on this domain and Next forwards it to the backend.
  // The session cookie then belongs to this domain, so it survives SameSite=Lax across the
  // default vercel.app / onrender.com hosts (which are separate sites on the public suffix list).
  //
  // The destination is fixed at BUILD time (Next bakes rewrites into the build), so API_URL must be
  // set where `next build` runs: Vercel project settings, or a Docker build arg. An empty value
  // counts as unset.
  async rewrites() {
    const configured = process.env.API_URL || '';
    if (!configured && process.env.NODE_ENV === 'production') {
      console.warn(
        `[next.config] API_URL is not set: /api/* will be proxied to ${DEFAULT_API_URL}. ` +
          'Set API_URL at build time for any deployment that talks to a different backend.',
      );
    }
    const backend = (configured || DEFAULT_API_URL).replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Enforced. Verified in the browser on the five main pages: every resource they load
          // is same-origin, so nothing in this policy blocks them.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
