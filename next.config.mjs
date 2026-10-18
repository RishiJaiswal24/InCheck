/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Native / CJS-heavy packages must not be bundled.
  serverExternalPackages: ['pdf-parse', 'mongodb'],
  // Sample documents are read from disk at runtime; make sure Vercel ships them with the functions that use them.
  outputFileTracingIncludes: {
    '/api/samples': ['./samples/**/*'],
    '/api/scenarios': ['./samples/**/*'],
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};
export default nextConfig;
