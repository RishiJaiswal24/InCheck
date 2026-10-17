/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['better-sqlite3', 'pdf-parse', '@google/genai'] },
};
export default nextConfig;
