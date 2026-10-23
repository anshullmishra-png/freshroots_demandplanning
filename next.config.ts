import type { NextConfig } from "next";

// Sent with every response. No script-src: Next injects inline scripts, and a policy that allowed them would
// add nothing. These directives stop the page being framed, being given a different <base>, or posting a form elsewhere.
const CSP = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // The prompts are read from disk at run time (src/lib/ai/prompts.ts); the tracer cannot see that, so say so.
  // Without this the deployed AI step fails with "file not found" while everything works locally.
  outputFileTracingIncludes: {
    "/api/runs": ["./prompts/**/*"],
    "/api/runs/\\[id\\]/continue": ["./prompts/**/*"],
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
