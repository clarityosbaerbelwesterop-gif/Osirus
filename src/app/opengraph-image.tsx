import { ImageResponse } from "next/og";

// The preview Google, WhatsApp, LinkedIn, Slack and X show for a shared link.
export const alt = "Osirus AI: Dein KI-Team mit Freigabeknopf | ClarityCompassAI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "72px 88px",
        background:
          "radial-gradient(circle at 85% 15%, #1d3a8a 0%, #0a0e17 55%)",
        color: "#f6f7f9",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <svg
          width="64"
          height="64"
          viewBox="0 0 32 32"
          fill="none"
          style={{ marginRight: 18 }}
        >
          <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#0B1220" />
          <path
            d="M22.8 9.15a10 10 0 1 0 2.15 10.15"
            stroke="#8FB3FF"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M16 10.4 L18.35 16 L16 21.6 L13.65 16 Z"
            fill="#F6F7F9"
          />
        </svg>
        <div
          style={{
            fontSize: 40,
            color: "#f6f7f9",
            letterSpacing: -0.4,
            fontWeight: 600,
          }}
        >
          Osirus
        </div>
      </div>
      <div
        style={{
          fontSize: 76,
          fontWeight: 700,
          lineHeight: 1.08,
          marginTop: 28,
          maxWidth: 980,
        }}
      >
        Dein KI-Team mit Freigabeknopf
      </div>
      <div
        style={{
          fontSize: 32,
          color: "#c9d3e6",
          marginTop: 32,
          maxWidth: 1000,
          lineHeight: 1.35,
        }}
      >
        Antworten mit Quellen · autonome Aufgaben · Code in deinen Repositories.
        Gehostet in der EU.
      </div>
      <div style={{ fontSize: 28, color: "#8fb3ff", marginTop: 48 }}>
        ClarityCompassAI  ·  osirus-ai.com
      </div>
    </div>,
    size,
  );
}
