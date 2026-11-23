import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";
// HTTPS-only headers (HSTS, upgrade-insecure-requests) on Vercel or an https APP_URL.
const isHttps = process.env.VERCEL === "1" || (process.env.APP_URL ?? "").startsWith("https://");

// CSP: Next.js App Router injects inline bootstrap scripts, so 'unsafe-inline'
// is needed for scripts unless we adopt nonces (which forces dynamic rendering of
// every page — acceptable here, but nonce plumbing is deferred; see README).
// No third-party origins are allowed anywhere.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "manifest-src 'self'",
  "worker-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(isHttps ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Personal financial data must never be served from a shared cache, so we keep
  // every route dynamic (cacheComponents off) and send private/no-store headers.
  cacheComponents: false,
  serverExternalPackages: ["pg"],
  experimental: {
    serverActions: {
      // Imports are capped at 1 MB in the service layer; Vercel's body limit is 4.5 MB.
      bodySizeLimit: "2mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Everything except static build assets and public icons is private.
        source: "/((?!_next/static|_next/image|icons/|manifest.webmanifest|favicon.ico).*)",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Vary", value: "Cookie" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
