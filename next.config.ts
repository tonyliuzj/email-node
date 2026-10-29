import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The app has no images to optimise, so don't expose the optimiser endpoint (and its sharp/libvips
  // attack surface) at all.
  images: { unoptimized: true },
  // The standalone build is what the Docker image runs, so it must hold only the code the server needs. The
  // database lives in data/ and is chosen at run time, which the bundler can't see through, so it is kept out
  // explicitly. Without this a build copies a local database (with its password hashes) into the output.
  async headers() {
    const isProduction = process.env.NODE_ENV === "production";

    // Production pages only load scripts from this site and Turnstile, so injected markup can't run code.
    // Next.js's dev server needs inline scripts and eval for hot reloading.
    const scriptSrc = isProduction
      ? "script-src 'self' https://challenges.cloudflare.com"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com";

    const contentSecurityPolicy = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: http: https: cid:",
      "font-src 'self' data:",
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        // Mailbox contents, account details and settings must never be kept by a browser or proxy cache.
        source: "/api/(.*)",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Browsers ignore this over plain HTTP, so it only takes effect once the site is served over HTTPS.
          ...(isProduction
            ? [{ key: "Strict-Transport-Security", value: "max-age=15552000" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
