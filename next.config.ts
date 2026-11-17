import type { NextConfig } from "next";
import { staticContentSecurityPolicy } from "./src/lib/security/csp";

const isDevelopment = process.env.NODE_ENV !== "production";

const config: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-site" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      ...(isDevelopment
        ? []
        : [
            {
              key: "Strict-Transport-Security",
              value: "max-age=31536000; includeSubDomains",
            },
          ]),
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(self), geolocation=(), payment=()",
      },
    ];

    return [
      { source: "/:path*", headers: common },
      {
        // Everything that is not a page (API routes, build assets, public
        // files). Pages get their policy, with a per-request script nonce,
        // from src/proxy.ts; both come from src/lib/security/csp.ts.
        source:
          "/:path((?:api|_next|\\.well-known)/.*|favicon\\.ico|icon\\.svg|robots\\.txt|sitemap\\.xml)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: staticContentSecurityPolicy(isDevelopment),
          },
        ],
      },
    ];
  },
};

export default config;
