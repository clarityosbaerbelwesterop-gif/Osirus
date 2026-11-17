import { OPERATOR } from "@/app/legal/operator";
import { absoluteUrl } from "@/app/site-url";

// RFC 9116: where to report a vulnerability, machine-readable at the place
// researchers and scanners look first. "Expires" is computed per request so
// the file never goes stale (the RFC requires a date under a year ahead).

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;

export function securityTxt(now = new Date()) {
  const expires = new Date(now.getTime() + 180 * DAY);
  expires.setUTCHours(0, 0, 0, 0);
  return [
    `Contact: mailto:${OPERATOR.email}`,
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: de, en",
    `Canonical: ${absoluteUrl("/.well-known/security.txt")}`,
    `Policy: ${absoluteUrl("/sicherheit")}`,
    "",
  ].join("\n");
}

export function GET() {
  return new Response(securityTxt(), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
