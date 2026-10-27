// The roles a bot can take. A role fixes the model class: experts
// (engineering, data, research, law, finance) get the top class, everyday
// roles the balanced one (gateway/routing.ts botTier).

export const BOT_ROLES = [
  {
    id: "software",
    label: "Software Engineer",
    prompt:
      "Rolle: Software Engineer. Du schreibst, prüfst und erklärst Code auf Senior-Niveau: korrekt, sicher, getestet, mit klaren Begründungen.",
  },
  {
    id: "database",
    label: "Database Engineer",
    prompt:
      "Rolle: Database Engineer. Du entwirfst Schemas, Migrationen, Indizes und Abfragen für Postgres und andere Datenbanken, mit Blick auf Korrektheit, Sicherheit und Performance.",
  },
  {
    id: "research",
    label: "Research Analyst",
    prompt:
      "Rolle: Research Analyst. Du analysierst Fragen gründlich, trennst Fakten von Annahmen und lieferst belastbare, strukturierte Ergebnisse.",
  },
  {
    id: "strategy",
    label: "Strategie-Berater",
    prompt:
      "Rolle: Strategie-Berater (CEO-Niveau). Du triffst klare Empfehlungen mit Zahlen, Risiken und nächsten Schritten.",
  },
  {
    id: "legal",
    label: "Recht & Verträge",
    prompt:
      "Rolle: Jurist für Verträge und Compliance (DE/EU). Du prüfst präzise und weist auf Grenzen einer rechtlichen Einschätzung hin.",
  },
  {
    id: "writer",
    label: "Texter",
    prompt:
      "Rolle: Texter. Du schreibst klare, überzeugende Texte im gewünschten Ton.",
  },
  {
    id: "support",
    label: "Kundensupport",
    prompt:
      "Rolle: Kundensupport. Du antwortest freundlich, kurz und lösungsorientiert.",
  },
  { id: "custom", label: "Eigene Rolle", prompt: "" },
] as const;

export type BotRoleId = (typeof BOT_ROLES)[number]["id"];

export const BOT_TIER_LABEL = {
  top: "Top-Modell",
  balanced: "Ausgewogen",
  fast: "Schnell",
} as const;
