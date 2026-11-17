# Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

Stand: 17. November 2026. Jede Maßnahme nennt die Stelle im Code oder in der
Konfiguration, an der sie geprüft werden kann, und den Test, der sie hält.

## 1. Vertraulichkeit

| Maßnahme                                            | Umsetzung                                                                                                                                                                                                                                                                                                                                                    | Nachweis                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Transportverschlüsselung                            | TLS auf allen Domains (Vercel), HSTS `max-age=31536000; includeSubDomains`                                                                                                                                                                                                                                                                                   | `next.config.ts`, Prod-Journey                                                                                   |
| Mandantentrennung in der Datenbank                  | Row-Level Security mit `FORCE` auf allen Tabellen; jede Anfrage läuft als die Person (`queryAs`), Systemzugriffe nur über `querySystem`                                                                                                                                                                                                                      | `db/migrations/004_security_rls.sql`, `030_membership_tenant_guard.sql`, `tests/membership-tenant-guard.test.ts` |
| Zugangsdaten verschlüsselt                          | AES-256-GCM v2: Schlüssel je Zweck per HKDF-SHA256, Workspace und Zweck als authentifizierte Daten, Schlüssel-ID für Rotation (`OSIRUS_CONNECTOR_KEY_PREVIOUS`); Altwerte werden automatisch neu versiegelt; MCP-Adressen mit Schlüssel (Query, Pfad) werden versiegelt, gespeichert und angezeigt wird nur die maskierte Adresse (`032_mcp_url_sealed.sql`) | `src/lib/connectors/crypto.ts`, `reseal.ts`, `tests/security-agent.test.ts`, `tests/crypto-reseal.test.ts`       |
| Keine Geheimnisse in Protokollen, Fehlern, Anzeigen | Redaktion aller Schlüsselformate der angebundenen Dienste, von JWTs, privaten Schlüsseln und Zugangsdaten in URLs; angewandt auf Fehlerdetails und jede gespeicherte Schritt-Zusammenfassung                                                                                                                                                                 | `src/lib/security/redact.ts`, `tests/attacks.test.ts`                                                            |
| Sitzungen                                           | Cookies `Secure`, `HttpOnly`, `SameSite=Lax` (Neon Auth); Konto löschen nur mit Anmeldung aus den letzten 15 Minuten                                                                                                                                                                                                                                         | `src/app/api/account/route.ts`, `tests/privacy-account.test.ts`                                                  |
| Browser-Härtung                                     | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`), `X-Frame-Options: DENY`, `nosniff`, COOP, CORP, Permissions-Policy                                                                                                                                                                                          | `next.config.ts`                                                                                                 |
| Kein Zugriff auf private Netze                      | Ausgehende Abrufe (Webseiten, MCP, Browser-QA) prüfen die aufgelöste Adresse, folgen Weiterleitungen nur geprüft und lesen begrenzt                                                                                                                                                                                                                          | `src/lib/research/fetch.ts`, `src/lib/coding/browser-qa.ts`, `tests/security-hardening.test.ts`                  |
| Code-Ausführung abgeschottet                        | Vercel Sandbox ohne Netzwerk (deny-all), Zeit- und Ausgabelimit in der Sandbox, danach beendet                                                                                                                                                                                                                                                               | `src/lib/chat/run-code.ts`, `src/lib/sandbox/vercel.ts`, `tests/chat-run-code.test.ts`                           |
| Repository-Zugriff                                  | Push nur zur exakten github.com-Adresse, ohne Hooks, Token nur über Credential-Helper, riskante Repo-Konfiguration wird abgelehnt; `.git` für Werkzeuge gesperrt                                                                                                                                                                                             | `src/lib/coding/delivery.ts`, `src/lib/sandbox/driver.ts`                                                        |
| Betreiberzugang                                     | Interne Seiten nur für Betreiber-Konten mit bestätigter E-Mail                                                                                                                                                                                                                                                                                               | `src/lib/gateway/owners.ts`                                                                                      |

## 2. Integrität

| Maßnahme                              | Umsetzung                                                                                                                                                                      | Nachweis                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Freigabe vor jeder Wirkung nach außen | Werkzeuge mit Wirkung nach außen warten auf die Freigabe genau dieser Eingabe (Fingerabdruck); die Freigabekarte zeigt alle Angaben, lange Werte mit Ende, ohne stille Kürzung | `src/lib/tools/runtime.ts`, `src/lib/ui/approval-view.ts`, `tests/ui-views.test.ts` |
| Doppelausführung verhindert           | Freigabe eines Bot-Werkzeugs wird atomar beansprucht                                                                                                                           | `src/lib/agents/bot-tools.ts`, `tests/bot-tool-approval.test.ts`                    |
| Eingaben validiert                    | zod-Schemas an jeder API, Größenlimits, Same-Origin-Prüfung für schreibende Anfragen                                                                                           | `src/lib/product/api.ts` (`guardWrite`)                                             |
| Prompt-Injection                      | Inhalte aus Web, Dateien und Werkzeugen sind als Daten markiert, nicht als Anweisungen                                                                                         | `src/lib/gateway/material.ts`, `src/lib/agents/bot-tools.ts`                        |
| Lieferkette                           | CI bricht bei neuer hoher oder kritischer Schwachstelle in Produktionsabhängigkeiten ab; akzeptierte Fälle nur mit Begründung und Ablaufdatum; Dependabot                      | `scripts/audit-gate.mjs`, `security/audit-allowlist.json`, `.github/dependabot.yml` |
| Änderungen                            | Jede Änderung über Pull Request mit CI (Lint, Typen, 1650+ Tests, E2E, visuelle Regression); täglicher End-to-End-Test gegen Produktion                                        | `.github/workflows/ci.yml`, `prod-journey.yml`                                      |

## 3. Verfügbarkeit und Belastbarkeit

| Maßnahme                      | Umsetzung                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Anfragebegrenzung             | Je Person und Route, in der Datenbank (`src/lib/security/rate-limit.ts`); Anmelden und Registrieren zusätzlich je IP- und E-Mail-Hash |
| Ausfallsicherheit der Modelle | Mehrere Anbieter mit Fallback, Fehlerbudget je Modell (`src/lib/gateway/provider.ts`)                                                 |
| Datensicherung                | Neon: Point-in-Time-Recovery nach Plan des Anbieters, Region Frankfurt                                                                |
| Migrationen                   | Laufen vor dem Produktions-Build; ein Fehler stoppt den Build, die vorige Version bleibt live (`scripts/migrate-on-deploy.mjs`)       |
| Hängende Läufe                | Automatisch beendet, wenn eine Freigabe 24 Stunden abgelaufen ist oder ein Lauf sieben Tage pausiert (`src/lib/runtime/recovery.ts`)  |

## 4. Verfahren zur regelmäßigen Überprüfung

- CI bei jeder Änderung; Produktions-Journey täglich (06:17 UTC) gegen osirus-ai.com.
- Laufzeitfehler: Vercel Runtime Errors, Sicherheitsereignisse in `osirus.security_events`.
- Speicherbegrenzung: täglicher Scheduler-Lauf (`src/lib/privacy/retention.ts`).
- Sicherheitsmeldungen: `/.well-known/security.txt` (RFC 9116), Antwort binnen zwei Werktagen.

## 5. Organisatorisch (Betreiberin)

- Auftragsverarbeitungsverträge abschließen bzw. annehmen: Vercel, Neon/Databricks,
  Stripe, Resend, Modellanbieter (siehe `docs/LEGAL_STATUS.md`).
- Schlüsselrotation `OSIRUS_CONNECTOR_KEY` mindestens jährlich und sofort bei
  Verdacht (alter Schlüssel nach `OSIRUS_CONNECTOR_KEY_PREVIOUS`).
- Datenpannen: Bewertung und Meldung an die LDI NRW binnen 72 Stunden
  (Art. 33), Benachrichtigung Betroffener bei hohem Risiko (Art. 34).
