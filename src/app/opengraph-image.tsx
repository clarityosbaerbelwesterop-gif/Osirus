import { ImageResponse } from "next/og";

// The preview Google, WhatsApp, LinkedIn, Slack and X show for a shared link.
export const alt = "Osirus: Dein KI-Team mit Freigabeknopf";
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
      <div style={{ fontSize: 40, color: "#8fb3ff", letterSpacing: 2 }}>
        OSIRUS
      </div>
      <div
        style={{
          fontSize: 76,
          fontWeight: 700,
          lineHeight: 1.08,
          marginTop: 24,
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
        osirus-ai.com
      </div>
    </div>,
    size,
  );
}
