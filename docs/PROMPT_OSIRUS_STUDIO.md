# Prompt: Osirus Studio — eigene Bots, Mega Bot, neue Oberfläche, Routing auf Quasnir

Stand: 21.10.2026. Grundlage: Prüfung des Codes auf `main` (Merge-Basis `2ba9bb3c`, plus 4 Commits auf `main`
bis `2a5df76`), Next.js 16.3.5, React 19.3.0. Jede Datei- und Zeilenangabe stammt aus dieser Prüfung. Zeilen
verschieben sich: vor jeder Änderung die Stelle neu lesen.

Gemessene Ausgangslage am 21.10.2026:

| Prüfung            | Ergebnis                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit` | 0 Fehler                                                                                       |
| `npx eslint .`     | 0 Fehler, 3 Warnungen (`src/app/page.tsx:105`, `src/components/chat/chat-hub.tsx:782`, `:824`) |
| `npx vitest run`   | 1.296 bestanden, 7 übersprungen (126 Dateien)                                                  |

Kopiere alles ab „Prompt“ in den ausführenden Agenten.

---

## Prompt

Du baust **Osirus Studio** in der App Osirus (`github.com/clarityosbaerbelwesterop-gif/osirus`). Ziel:

1. Nutzer erstellen eigene Bots.
2. Ein **Mega Bot** verteilt Aufgaben an diese Bots und führt die Ergebnisse zusammen.
3. Die Oberfläche wird überarbeitet: klar, hochwertig, mit Animationen, ohne Fehler.
4. Das Backend ist vollständig verbunden.
5. Das Routing ist so vorbereitet, dass Osirus später über das eigene Modell **Quasnir** laufen kann.

Der Owner entscheidet. Du arbeitest in kleinen, geprüften Pull Requests gegen `main` und berichtest nur gemessene
Ergebnisse.

### 0. Regeln, die immer gelten

**Architektur (aus `README.md`, nicht verhandelbar)**

- Neon/PostgreSQL ist die Wahrheit für jeden dauerhaften Zustand; der Browser zeigt ihn nur an.
- Jeder Datenbankzugriff geht über `queryAs` oder `querySystem` (`src/lib/db/client.ts`). Ein Zugang ohne
  Rollenwechsel auf `osirus_app` schaltet die Mandantentrennung still ab.
- Jede neue Tabelle: `ENABLE` und `FORCE ROW LEVEL SECURITY`, Policies, Grants an `osirus_app`, Update-Trigger,
  nach dem Muster von `db/migrations/004_security_rls.sql` und `020_function_execute_grants.sql`.
- Secrets bleiben auf dem Server. Generierter Code läuft nie im Web-Prozess.
- Seiteneffekte nur über die Freigabe-Schranke der Tool-Registry (`src/lib/tools/registry.ts`). Ohne Freigabe
  läuft ein Seiteneffekt nicht.
- Eine reine Modell-Prüfung erreicht nie „verified“ (`src/lib/verification/engine.ts`).

**Ehrlichkeit**

- Keine erfundenen Fähigkeiten, Zahlen oder Modellnamen in der Oberfläche.
- Quasnir erscheint erst als Antwortmodell, wenn es wirklich antwortet. Die Kennzeichnung in
  `src/lib/lab/honesty.ts` bleibt wahr.
- „Quasnir“ ist seit dem 22.10.2026 der Name eines Systems: Qwen3.8-27B (Apache-2.0) mit unseren LoRA-Gewichten,
  Quasnir-1B als Vorsortierer und die Sandbox als letzte Prüfung (`67/docs/PLAN_QWEN.md`). In der Modellauswahl
  steht „Quasnir“; ein Info-Hinweis nennt die Basis „Qwen3.8-27B (Apache-2.0)“. Das Hauptmodell gilt nie als selbst
  von Grund auf trainiert (`selfTrained: false`).
- Keine Schwarm-Zahlen („2.800 Agenten“) als Qualitätsversprechen. Angezeigt wird, was wirklich läuft.

**Namen**

- „Grok“ und „Antigravity“ sind Produktnamen von xAI und Google und erscheinen nicht in Produkt-, Feature- oder
  Marketingnamen von Osirus. Sie sind nur interne Vorbilder (Abschnitt 3).
- Arbeitsnamen: **Osirus Studio** (Bots), **Mega Bot** (Orchestrator), **Mission Control** (Übersicht).

**Grenzen**

- Keine GPU-Ausgaben und kein Training. Quasnir ist eingefroren.
- Stripe bleibt verschoben (Owner-Entscheidung vom 02.10.2026).
- Keine Tests abschalten oder überspringen, um grün zu werden.

**Qualitätsschranke für jeden PR**

- `npm run typecheck`, `npm run lint` (0 Fehler, 0 neue Warnungen), `npm run format:check`, `npm test`.
- Die Playwright-Projekte `smoke`, `ui` und `visual` mit `OSIRUS_UI_FIXTURES=1`.
- Neue Oberflächen bekommen eine Fixture unter `src/app/ui-fixtures/[surface]` und laufen durch `a11y`,
  `responsive`, `keyboard`, `visual` und `performance` (CLS ≤ 0,1, LCP ≤ 2,5 s, Skript-Budget 350 KB).
- Visual-Baselines nur bewusst und mit Begründung im PR erneuern.

### 1. Ausgangslage (geprüft)

**Bots**

- Ein Bot ist heute nur eine Sitzung mit `surface='bot'` (`db/migrations/021_session_surface.sql:13`). Es gibt
  keine Bot-Tabelle, keine Anweisungen, keine Tool-Auswahl, kein Modell und kein Avatar.
- `src/components/bot/bot-surface.tsx:11-27` reicht nur an `ChatHub kind="bot"` weiter. Der leere Zustand zeigt
  nur das Wort „Bot“ (`chat-hub.tsx:929-932`).
- `POST /api/bots` und `POST /api/bots/messages` existieren, aber die Oberfläche ruft keinen der beiden auf.
  `/api/bots/messages` legt Nutzernachrichten an, ohne einen Lauf zu starten. Diese verwaisten Nachrichten landen
  später im Kontext (`src/lib/arms/base.ts:220`).

**Chat (`/app`)**

- Sendet an `/api/lab/complete` nur die letzte Nachricht, ohne Verlauf (`chat-hub.tsx:502-509`). Die Antwort wird
  nicht gestreamt.
- `setRunning` wird auf diesem Weg nie gesetzt. Während der Antwort ist das Eingabefeld aktiv und es gibt keine
  Anzeige.
- `/api/chat/turns` speichert Assistenten-Text, den der Client mitschickt. Dieser Verlauf kann einen späteren Lauf
  mit `surface:"ai"` beeinflussen.

**Agent, Bot und Coding** laufen über `POST /api/runtime` mit SSE. Der Ablauf ist vollständig: Planung in
`router-v2.ts`, Stufen-DAG mit Leases, Agent-Schleife (`src/lib/agent/loop.ts`), Tools, MCP, Sandbox und
Verifikation (Details in `docs/AGENT_ARCHITECTURE.md`).

**Modelle**

- Ein einziger OpenAI-kompatibler Anbieter „UnoRouter“ mit bis zu 3 Schlüsseln und den Rollen
  `FAST, STRONG, THINKING, CODING, RESEARCH, MATH, VERIFY` (`src/lib/models/provider.ts:4-5`).
- Der Pool behält ohne Katalog nur Modelle mit `:free` (`free-registry.ts:259-265`).
- Quasnir ist nur als Lab-Programm angelegt (`ai-lab/programs/quasnir.ts`, `nativeRuntime:"not_shipped"`).
- Das Feld `coding.model` wird gespeichert (`repository.ts:528`), aber nie gelesen.

**Design**

- Eigenes CSS ohne Tailwind: 9 Dateien, 5.232 Zeilen, Tokens in `src/styles/tokens.css`. Farben über
  `light-dark()`, Motion-Tokens 80–220 ms, `prefers-reduced-motion` überall beachtet.
- Bausteine: `@base-ui/react`, `lucide-react`, Inter Variable.
- Keine View Transitions, keine Einblendung neuer Nachrichten. Die Landing-Animationen sind durch einen
  „Calm pass“ abgeschaltet (`landing.css:485-505`); zu `.landing-aurora`, `-sheen`, `-pulse` und `-rise` gibt es
  kein Markup.
- `loading.tsx`, `error.tsx` und `not-found.tsx` gibt es nur im Root, in `src` gibt es kein `Suspense`.

**Tests:** Die UI-Tests prüfen nur Fixtures. Bot, Agent und der echte Chat haben keine UI-Tests.

### 2. Zielbild

**Osirus Studio (`/app/bots`)**

- Bibliothek mit eigenen Bots, Vorlagen, Suche und Filter.
- Builder mit zwei Wegen: „Beschreiben“ (der Bot wird aus einer Beschreibung erzeugt) und „Konfigurieren“
  (alle Felder).
- Daneben ein Test-Chat, bevor der Bot veröffentlicht wird.
- Versionen mit Wiederherstellen, Duplizieren, Archivieren, Teilen im Workspace.

**Mega Bot**

- Fester Bot je Workspace. Er zerlegt eine Aufgabe, gibt Teilaufgaben an passende Bots, behält die Kontrolle und
  liefert eine geprüfte Gesamtantwort.
- Muster „Agents as Tools“: Der Manager besitzt die Antwort, die Spezialisten liefern Artefakte.
- Mit `@Name` lässt sich ein bestimmter Bot erzwingen.

**Mission Control**

- Live-Übersicht aller Teilläufe: Status, Artefakte (Plan, Aufgabenliste, Diff, Screenshot), offene Freigaben und
  Meldungen.

**Oberfläche:** ein Designsystem für alle Seiten, ruhige und schnelle Animationen, keine bekannten Fehler aus
Abschnitt 4.1.

**Backend:** jede Route hat einen Aufrufer, jede Funktion der Oberfläche hat eine echte Route. Der Chat streamt mit
Verlauf.

**Routing:** Eine Anbieter-Abstraktion mit Quasnir als eigenem Endpunkt. Standard: aus. Danach Schattenbetrieb.
Echter Verkehr erst nach bestandenem Gate.

### 3. Vorbilder: was wir übernehmen und woher

Die Quellen stammen aus einer Web-Recherche vom 21.10.2026 und wurden aus Suchauszügen gelesen. Vor dem Nachbau
die Originalseite öffnen und prüfen.

| Funktion in Osirus                        | Vorbild                          | Was wir übernehmen                                                                                                                                  | Quelle                                                                                                                              |
| ----------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Bot-Felder                                | xAI Grok Bot                     | Name, Label, Beschreibung, Avatar, eine „Hauptaufgabe“; feste Regeln in der Beschreibung, einmalige Wünsche im Chat                                 | https://docs.x.ai/grok-bot/bots, https://docs.x.ai/grok-bot/get-started                                                             |
| Duplizieren und Vorlagen                  | xAI Grok Bot                     | Duplizieren behält Profil, Skills, Routinen, Avatar; Teilen als Vorlage im Team                                                                     | https://docs.x.ai/grok-bot/team-bots                                                                                                |
| Freigaben bei riskanten Aktionen          | xAI Grok Bot                     | Vor Senden, Kaufen, Löschen, Veröffentlichen immer Freigabe                                                                                         | https://docs.x.ai/grok-bot/skills-routines-and-automations                                                                          |
| Orchestrator                              | xAI „Chief of Staff“ Bot         | Ein koordinierender Bot über Spezialisten; Gruppenchat mit @-Erwähnung                                                                              | https://x.ai/news/designing-grok-bot, https://docs.x.ai/grok-bot/chat-and-collaboration                                             |
| Warnung                                   | xAI Grok Bot FAQ                 | Alle Bots teilen sich dort einen Rechner und sind keine Sicherheitsgrenze. **Wir machen es anders:** jeder Bot hat eigene Tool- und Speicherrechte. | https://docs.x.ai/grok-bot/faq                                                                                                      |
| Mission Control                           | Google Antigravity Agent Manager | Übersicht mehrerer Agenten mit Status, Inbox für Hintergrund-Meldungen                                                                              | https://antigravity.google/blog/introducing-google-antigravity/                                                                     |
| Artefakte als Fortschritt                 | Google Antigravity               | Plan, Aufgabenliste, Walkthrough, Screenshots, Diffs statt roher Tool-Aufrufe                                                                       | https://antigravity.google/docs/artifacts/                                                                                          |
| Kommentieren ohne Abbruch                 | Google Antigravity               | Kommentare an einem Plan, der Agent übernimmt sie und läuft weiter                                                                                  | https://antigravity.google/docs/implementation-plan/                                                                                |
| Autonomie je Bot                          | Google Antigravity               | Drei Stufen: immer fortfahren, Agent entscheidet, Prüfung anfordern                                                                                 | https://codelabs.developers.google.com/getting-started-google-antigravity                                                           |
| Builder „Beschreiben“ und „Konfigurieren“ | OpenAI GPTs                      | Create-Tab (Gespräch mit dem Builder) und Configure-Tab; Gesprächsstarter; Versionen mit Wiederherstellen                                           | https://help.openai.com/en/articles/8554397-creating-a-gpt, https://help.openai.com/en/articles/8798878-sharing-and-publishing-gpts |
| Feldgrenzen                               | Microsoft Copilot Studio         | Name ≤ 42 Zeichen, Beschreibung ≤ 1.024, Anweisungen ≤ 8.000                                                                                        | https://learn.microsoft.com/en-us/microsoft-copilot-studio/fundamentals-get-started                                                 |
| Auswahl der Bots nach Beschreibung        | Microsoft Copilot Studio         | Der Planer wählt Unter-Agenten anhand ihrer Beschreibung                                                                                            | https://learn.microsoft.com/en-us/microsoft-copilot-studio/advanced-generative-actions                                              |
| Handoff oder Agent-als-Tool               | OpenAI Agents SDK                | Mega Bot nutzt „Agent als Tool“: der Manager behält die Antwort                                                                                     | https://developers.openai.com/api/docs/guides/agents/orchestration                                                                  |
| Wissen schrittweise laden                 | Anthropic Skills                 | Metadaten immer, Inhalt nur bei Bedarf; passt zur bestehenden Skill-Auswahl (höchstens 8 je Stufe)                                                  | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview                                                          |
| Ruhige Oberfläche                         | Linear                           | Wenig visuelles Gewicht, feste Positionen der Aktionen im Kopf                                                                                      | https://linear.app/now/how-we-redesigned-the-linear-ui                                                                              |
| Aktionsleiste                             | Raycast                          | Untere Aktionsleiste mit ⌘K, Toasts und Titel                                                                                                       | https://www.raycast.com/blog/a-fresh-look-and-feel                                                                                  |
| Animationsregeln                          | Vercel Web Interface Guidelines  | Reduced Motion beachten, nur `transform` und `opacity`, unterbrechbar, CSS vor JS                                                                   | https://vercel.com/design/guidelines                                                                                                |
| Seitenübergänge                           | React 19.3 `<ViewTransition>`    | Übergänge bei Navigation, Suspense und `useDeferredValue`                                                                                           | https://react.dev/reference/react/ViewTransition, https://nextjs.org/docs/app/guides/view-transitions                               |

Nicht übernehmen: OpenAI Agent Builder. Er wird laut OpenAI am 30.11.2026 abgeschaltet
(https://developers.openai.com/api/docs/deprecations).

### 4. Arbeitspakete

Reihenfolge: 4.1 zuerst, denn neue Funktionen auf bekannten Fehlern sind teuer. Danach 4.2 bis 4.8. Jedes Paket
endet mit grünen Prüfungen und einem PR.

#### 4.1 Bekannte Fehler beheben (P0)

Zu jedem Fehler gehört ein Regressionstest, der vor der Korrektur rot war.

| #   | Fehler                                                                               | Ort                                                                                                                                                                             | Korrektur                                                                                                                    |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | Chat sendet keinen Verlauf                                                           | `chat-hub.tsx:502-509`                                                                                                                                                          | Der Server baut den Verlauf aus der Sitzung, nicht der Client (siehe 4.6)                                                    |
| 2   | Chat zeigt keinen Laufzustand                                                        | `chat-hub.tsx` (Chat-Pfad ohne `setRunning`)                                                                                                                                    | Gleicher Laufzustand wie Agent: Eingabe gesperrt, Stopp-Knopf, Anzeige „schreibt“                                            |
| 3   | Regenerate beim Bot verdoppelt die Nutzernachricht                                   | `chat-hub.tsx:1013`, `src/lib/product/bot-run.ts`, `src/app/api/runtime/route.ts:30`, `src/lib/runtime/executor.ts:137`                                                         | `regenerate` in `botRuntimeBody` mitgeben; der Server speichert bei Regenerate keine neue Nutzernachricht                    |
| 4   | Links aus Inbox und Freigaben öffnen Agent-, Bot- und Coding-Threads als leeren Chat | `src/app/app/inbox/page.tsx:46-47`, `src/components/approvals/approval-list.tsx:35`                                                                                             | `surfacePath()` aus `src/lib/product/surfaces.ts:97` verwenden                                                               |
| 5   | Zwei getrennte Theme-Zustände, das Symbol oben veraltet                              | `theme-menu.tsx:22`, `appearance.tsx:16`                                                                                                                                        | Ein Zustand über Context; die Optionen nur einmal definieren                                                                 |
| 6   | Lange Threads zeigen die ältesten statt der neuesten 200 Nachrichten                 | `src/lib/runtime/repository.ts:350-354`                                                                                                                                         | Neueste 200 holen (`order by created_at desc limit 200`), dann aufsteigend sortieren; mehr per Paging                        |
| 7   | Gestreamte Antworten brechen nach 90 s ab                                            | `src/lib/models/unorouter.ts:416-442`, `:815-818`                                                                                                                               | Getrennte Zeitgrenzen für Verbindungsaufbau, erstes Token und Leerlauf zwischen Tokens                                       |
| 8   | Ein Abbruch durch den Client lässt den Lauf scheitern                                | `src/app/api/runtime/route.ts:219` (`controller.enqueue` nach Cancel)                                                                                                           | `emit` und `emitDelta` absichern; der Lauf läuft auf dem Server weiter und ist per Poll abrufbar                             |
| 9   | Ein einzelner 404 sperrt Pool-Modelle für 6 Stunden                                  | `unorouter.ts:99-103`, `free-registry.ts:327`, `:524-527`                                                                                                                       | Nur „Modell unbekannt“ im Antworttext sperrt das Modell; ein Pfad- oder Proxy-404 ist ein Konfigurationsfehler des Anbieters |
| 10  | `/api/chat/turns` speichert Text vom Client als Assistenten-Antwort                  | `src/app/api/chat/turns`                                                                                                                                                        | Assistenten-Text nur vom Server; Route entfernen, sobald der Chat über den Server streamt (4.6)                              |
| 11  | `/api/lab/complete` ohne Rate-Limit, Same-Origin- und Content-Type-Prüfung           | `src/app/api/lab/complete`                                                                                                                                                      | Gleiche Schranken wie `/api/runtime`                                                                                         |
| 12  | Lab-Client wechselt bei 429 den Schlüssel, Basis-URL fest im Code, kein Timeout      | `ai-lab/inference/unorouter.ts:12`, `:106`, `:146-163`                                                                                                                          | Regeln des Hauptpfads übernehmen: kein Schlüsselwechsel bei 429, URL aus `env`, Timeout                                      |
| 13  | `/api/bots/messages` erzeugt verwaiste Nachrichten                                   | `src/app/api/bots/messages/route.ts:13-43`                                                                                                                                      | Route entfernen; Bots laufen über `/api/runtime` (4.3)                                                                       |
| 14  | Jede Anfrage schreibt in `osirus.users`, auch der 2-Sekunden-Poll                    | `src/lib/auth/bootstrap.ts:22-31`                                                                                                                                               | Nur schreiben, wenn sich Daten ändern oder der letzte Abgleich älter als 1 Stunde ist                                        |
| 15  | `.env.example` unverändert kopiert lässt den Start scheitern                         | `src/lib/env.ts:58`                                                                                                                                                             | Leere Strings als „nicht gesetzt“ werten; fehlende Variablen dokumentieren (Liste unten)                                     |
| 16  | `UNOROUTER_API_KEY` wird vom Hauptpfad ignoriert, `CRON_SECRET` nie gelesen          | `env.ts:60-65`, `scheduler/tick`                                                                                                                                                | Den Einzelschlüssel als Schlüssel 1 akzeptieren oder die Doku korrigieren; `CRON_SECRET` lesen oder streichen                |
| 17  | Kundenläufe bekommen nur den Rest jedes Ticks                                        | `src/app/api/scheduler/tick/route.ts:143-170`                                                                                                                                   | Kundenläufe zuerst, dann Foundry, Pulse und RSI                                                                              |
| 18  | `model_calls` speichert einen festen Anbieter und das vorhergesagte Modell           | `repository.ts:928`, `base.ts:633`, `recording.ts:68`                                                                                                                           | Anbieter als Parameter; `servedModel()` speichern                                                                            |
| 19  | Hydration: Zeitangaben aus `Date.now()` im Server-Rendering                          | `run-card.tsx:202`, `inbox-view.tsx:96-98`, `ui/relative-time.tsx`                                                                                                              | Absolute Zeit vom Server, relative Zeit erst nach dem Mount                                                                  |
| 20  | Telefone sehen kurz das Desktop-Layout                                               | `workbench.tsx:53` (`useWideLayout` liefert serverseitig `true`)                                                                                                                | Layout per CSS-Media-Query entscheiden, JS nur für Verhalten                                                                 |
| 21  | Ein Fehler ersetzt die ganze Oberfläche                                              | nur Root-`error.tsx`                                                                                                                                                            | `src/app/app/loading.tsx`, `error.tsx`, `global-error.tsx`; `Suspense` um langsame Server-Teile                              |
| 22  | Farben ohne Dark Mode                                                                | `shell.css:625-633`, `product.css:233`, `workbench.css:538`                                                                                                                     | Tokens verwenden                                                                                                             |
| 23  | Barrierefreiheit                                                                     | `message-list.tsx:106` (h3 ohne h2), ThemeMenu `aria-label` mit Roh-IDs, `chat.css:782` und `:902` (Outline statt Ring), `shell.css:263-274` (Knöpfe mit `opacity:0`)           | Überschriften-Hierarchie, deutsche Labels, ein Fokus-Ring für alle, Knöpfe für Tastatur und Touch sichtbar                   |
| 24  | Coding-Seite                                                                         | `coding-surface.tsx:227`, `:511-540`; Formular ohne `.composer-wrap`                                                                                                            | Fehler nach Repo- oder Branch-Fehler zurücksetzen, Knopf-Varianten, gemeinsame Polling-Logik mit ChatHub                     |
| 25  | Toter oder doppelter Code                                                            | `ui/tabs.tsx` ungenutzt, `ui/button.tsx` nur einmal genutzt (68 rohe `btn`-Klassen), `STARTERS` und `.starter*`, `.home-hero`, `.onboarding` ungenutzt, Landing-CSS ohne Markup | Entfernen oder in 4.2 einbauen; nichts Halbes stehen lassen                                                                  |
| 26  | Anhang, Moduswahl und Modellwahl gibt es nur in Fixtures                             | `composer.tsx` Layout `"full"`, `chat-hub.tsx:420-462`                                                                                                                          | Anhänge in Chat, Agent und Bot freischalten; Modellwahl nach 4.7                                                             |
| 27  | Gemischte Sprache                                                                    | `chat-home.tsx:17`, `theme-menu.tsx:15`, `appearance.tsx:9`, `surfaces.ts:7-15`                                                                                                 | Wörterbuch `src/lib/i18n` (de, en). Standard nach Owner-Entscheidung (Abschnitt 7); Tests darauf umstellen                   |
| 28  | 3 ESLint-Warnungen                                                                   | siehe Ausgangslage                                                                                                                                                              | beheben                                                                                                                      |

Fehlende Einträge in `.env.example`:

- `OSIRUS_FREE_MODEL_MIN_INTERVAL_MS`, `OSIRUS_SANDBOX_CREDENTIALS`.
- `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, `VERCEL_OIDC_TOKEN`, `VERCEL_ENV`,
  `VERCEL_PROJECT_PRODUCTION_URL`.
- `OSIRUS_CHROMIUM_PATH`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `OSIRUS_ALLOW_LOCAL_EXEC`.
- `TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `APIFY_TOKEN`, `CONTEXT7_MCP_URL`.
- `OSIRUS_TRAINING_READY`.

#### 4.2 Designsystem 2.0 und Animationen

**Tokens** (`src/styles/tokens.css`)

- Die bestehende Struktur behalten und verfeinern:
  - Flächen in drei Stufen (Grund, erhöht, schwebend) mit passenden Schatten.
  - Ein Akzent mit Hover-, Aktiv- und Fokus-Stufe; Status-Farben für Erfolg, Warnung, Fehler und „läuft“.
- Alles über `light-dark()`. Kontrast mindestens WCAG 2.2 AA, die bestehende axe-Prüfung bleibt die Schranke.
- Motion-Tokens ergänzen: `--ease-out-soft`, `--ease-spring` (als `cubic-bezier`) und Dauern 120, 180 und
  240 ms. Bei Reduced Motion alles 0 ms, wie heute (`tokens.css:186-193`).

**Bausteine:** Eine `Button`-Komponente mit Varianten (primär, sekundär, ruhig, Gefahr) und Größen ersetzt die 68
rohen `btn`-Klassen. Ebenso je eine Komponente für:

- `Card`, `Badge`, `Avatar` (Emoji oder Bild, Farbring);
- `Skeleton`, `Toast`;
- `CommandBar` (⌘K: Bot öffnen, neuer Bot, Mission Control, Theme).

**Animationen** (nur `transform` und `opacity`, unterbrechbar, Reduced Motion beachtet)

| Stelle                       | Animation                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Neue Nachricht               | Einblenden mit 4 px Anstieg, 160 ms                                                                                    |
| Streaming                    | Bestehender Caret, dazu weiches Nachwachsen der letzten Zeile ohne Layout-Sprung                                       |
| Seitenwechsel im App-Bereich | React `<ViewTransition>` mit Überblendung; Richtung über `transitionTypes` an `next/link`                              |
| Bot-Karten                   | Hover-Anhebung um 2 px mit Schatten; Erscheinen in Stufen von 30 ms                                                    |
| Builder                      | Wechsel zwischen „Beschreiben“ und „Konfigurieren“ als Gleiten; Vorschau aktualisiert sich ohne Flackern               |
| Mission Control              | Statuswechsel einer Karte als Farbübergang; laufende Bots mit langsamem Puls (bestehendes `work-glow` wiederverwenden) |
| Laden                        | Skeletons statt Text „Starting“; Shimmer nur ohne Reduced Motion                                                       |
| Landing                      | Ruhiger Hero: das tote Aurora-CSS entweder mit Markup versehen oder löschen, nicht beides halb                         |

**View Transitions**

- React 19.3 hat `<ViewTransition>` stabil. Ob Next.js 16.3.5 dafür noch `experimental.viewTransition` in
  `next.config.ts` braucht, prüfst du in der installierten Version (laut Recherche ist der Schalter ab 16.4 nicht
  mehr nötig).
- Browser ohne Unterstützung zeigen keinen Übergang, funktionieren aber.

**Bibliotheken**

- Zuerst CSS und `<ViewTransition>`.
- `motion` (`motion/react`) nur, wenn Layout-Animationen in Mission Control es brauchen. Dann mit
  `<MotionConfig reducedMotion="user">`, und nur nach Messung gegen das Skript-Budget von 350 KB.

**Markdown**

- Nicht bei jedem Delta den ganzen Text neu parsen: abgeschlossene Blöcke merken, nur den offenen Block neu
  rendern.
- Syntax-Highlighting lazy laden, nur für sichtbare Codeblöcke.

#### 4.3 Datenmodell der Bots (Migration `023_bots.sql`)

Nächste freie Nummer prüfen; zuletzt angewendet ist `022_coding_run_pause.sql`.

`osirus.bots`:

| Spalte                     | Typ und Regel                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`                       | uuid, Primärschlüssel                                                                                           |
| `workspace_id`             | uuid, Pflicht, RLS-Schlüssel                                                                                    |
| `created_by`               | uuid, verweist auf `osirus.users`                                                                               |
| `kind`                     | `custom` oder `mega`; je Workspace genau ein `mega` (partieller Unique-Index)                                   |
| `name`                     | 1–42 Zeichen                                                                                                    |
| `description`              | ≤ 1.024 Zeichen; der Mega Bot wählt danach aus, also Pflicht                                                    |
| `avatar`                   | jsonb: Emoji oder Verweis auf einen Anhang, dazu die Farbe                                                      |
| `instructions`             | ≤ 8.000 Zeichen                                                                                                 |
| `starters`                 | text[], höchstens 4                                                                                             |
| `arm`                      | `auto`, `thinking`, `coding`, `research`, `math_science`, `building` oder `general`                             |
| `model_preference`         | `auto` oder eine Rolle; `quasnir` erst nach 4.7                                                                 |
| `tools`                    | text[], Teilmenge der Registry-IDs; Seiteneffekte brauchen weiter die Freigabe                                  |
| `knowledge`                | uuid[] auf Anhänge des Workspace                                                                                |
| `memory_scope`             | `bot` (eigener Speicher) oder `workspace`                                                                       |
| `autonomy`                 | `request_review` (Standard), `agent_decides` oder `always_proceed`; Seiteneffekte bleiben immer an der Freigabe |
| `visibility`               | `private` oder `workspace`                                                                                      |
| `status`                   | `draft`, `published` oder `archived`                                                                            |
| `version`                  | int; steigt beim Veröffentlichen                                                                                |
| `budget`                   | jsonb, höchstens der Workspace-Standard (40 Modellaufrufe, 100 Tool-Aufrufe, 30 min aus `executor.ts:49-55`)    |
| `created_at`, `updated_at` | Zeitstempel mit Trigger                                                                                         |

Weitere Änderungen:

- `osirus.bot_versions`: unveränderliche Schnappschüsse beim Veröffentlichen (`bot_id`, `version`, `config`
  jsonb, `published_by`, `published_at`); Wiederherstellen erzeugt eine neue Version.
- `osirus.sessions.bot_id`: uuid, nullable, Fremdschlüssel. Für `surface='bot'` Pflicht. Alte Bot-Sitzungen
  bekommen per Migration einen Standard-Bot „Assistent“.
- Der Mega Bot wird beim ersten Aufruf je Workspace idempotent angelegt, nicht in der Migration für alle.
- Speicher-Trennung: Erinnerungen mit `memory_scope='bot'` bekommen `bot_id`. Die Abfrage in `src/lib/memory`
  filtert danach. Kein Bot liest den Speicher eines anderen Bots.

Tests mit PGlite:

- Ein Bot aus Workspace A ist in B unsichtbar (lesen, ändern, löschen).
- `private` ist für andere Mitglieder unsichtbar.
- Grenzen der Felder; genau ein Mega Bot je Workspace.

#### 4.4 Bot-API und Laufzeit

**Routen** (zod-Schemas, Same-Origin, Rate-Limits, `queryAs`):

- `GET /api/bots` (Liste mit Suche und Filter), `POST /api/bots` (anlegen als `draft`). Ersetzt die heutige
  Sitzungs-Route.
- `GET`, `PATCH /api/bots/[id]`; `POST /api/bots/[id]/archive` (kein hartes Löschen).
- `POST /api/bots/[id]/publish`, `POST /api/bots/[id]/duplicate`, `GET /api/bots/[id]/versions`,
  `POST /api/bots/[id]/versions/[v]/restore`.
- `POST /api/bots/generate`: Beschreibung rein, schema-geprüfter Entwurf raus (Rolle THINKING, gleiche Strenge wie
  `analyseTask` in `src/lib/arms/thinking.ts:437-460`). Der Entwurf wird nie automatisch veröffentlicht.

**Laufzeit**

- `/api/runtime` nimmt `botId` an. `prepareRuntimeRun` (`executor.ts:63-154`) lädt die veröffentlichte Version.
  Im Test-Chat des Builders lädt es den Entwurf und markiert den Lauf als Test.
- Die Bot-Anweisungen kommen eingezäunt in den System-Vertrag. Sie dürfen Sicherheits- und Ehrlichkeitsregeln nicht
  überschreiben; die bestehende Prompt-Injection-Erkennung läuft auch über sie.
- Werkzeuge: Bot-Tools ∩ Sichtbarkeit des Arms ∩ Workspace-Richtlinie. MCP nur, wenn der Bot ein freigegebenes
  MCP-Tool enthält.
- Wissen: Die angehängten Dateien gehen über den bestehenden Anhang-Pfad in die Abfrage.
- Budget: das Bot-Budget, nie mehr als der Workspace-Standard.

**Tests:** Eine Anweisung wie „ignoriere die Freigabe“ ändert nichts an der Freigabe. Ein Bot ohne Tool X kann X
nicht aufrufen. Der Entwurf läuft nur im Test-Chat.

#### 4.5 Studio-Oberfläche

**Bibliothek (`/app/bots`)**

- Raster aus Bot-Karten: Avatar, Name, Beschreibung, zuletzt genutzt, Status.
- Suche, Filter (eigene, Workspace, Entwürfe, archiviert), Knopf „Neuer Bot“, Vorlagen.
- Leerer Zustand mit drei Vorlagen statt nur dem Wort „Bot“.

**Vorlagen** (bauen auf den bestehenden Armen auf, keine neuen Fähigkeiten vortäuschen):

- Code-Reviewer (coding)
- Recherche mit Quellen (research)
- Mathe und Rechnen (math_science)
- Release Notes aus einem Repo (coding, GitHub nur lesend)
- Tagesbriefing (Automation)

**Builder (`/app/bots/new`, `/app/bots/[id]/edit`)**

- Links zwei Tabs:
  - „Beschreiben“: Gespräch mit dem Builder, Ergebnis über `/api/bots/generate`.
  - „Konfigurieren“: alle Felder.
- Muster für Felder, Fieldsets, Tool-Checkliste, Budgets, `role="alert"` und Busy-Zustände:
  `src/components/automations/automation-form.tsx`.
- Rechts ein Test-Chat gegen den Entwurf.
- Kopfzeile: Status, „Veröffentlichen“, Versionen (Drawer), Duplizieren, Archivieren (`ConfirmDialog`).
- Ungespeicherte Änderungen warnen beim Verlassen.

**Bot-Chat (`/app/bots/[id]`)**

- Kopf mit Avatar und Name, Gesprächsstarter im leeren Zustand.
- Eingabe mit Anhängen, Workbench für den Lauf.
- Seitenleiste: Threads je Bot gruppiert.

**Mobil:** Builder-Tabs untereinander, die Vorschau als Sheet; keine horizontale Scrollleiste bei 375 px.

#### 4.6 Chat und Backend vollständig verbinden

- Der Chat (`/app`) läuft über `/api/runtime` mit einer Antwort-Stufe, gestreamt per SSE. Der Server baut den
  Verlauf aus der Sitzung. Danach entfallen der Chat-Aufruf von `/api/lab/complete` und `/api/chat/turns` (Fehler
  1, 2 und 10).
- `/api/lab/complete` bleibt nur für die Lab-Ansicht, mit den Schranken aus Fehler 11.
- `/api/rouge` hat keinen Aufrufer. Rouge ist laut Owner gesperrt: Route hinter einen Operator-Check legen und
  dokumentieren, nicht still löschen.
- Ein Modellfeld für Agent und Bot (`model_preference`), gelesen in `worker.executeClaimedStage`
  (`src/lib/runtime/worker.ts:221`) über `getRunInput` (`src/lib/product/surfaces.ts:72-92`). Dasselbe gilt für
  `coding.model`, das heute gespeichert, aber nie gelesen wird.
- Benachrichtigungen: Ein abgeschlossener Bot- oder Mega-Bot-Lauf erzeugt einen Inbox-Eintrag mit
  `surfacePath()`-Link.
- Eine Readiness-Seite für Operatoren: Anbieter, Pool, Sandbox, Scheduler und später Quasnir. Die Daten kommen aus
  dem bestehenden `src/lib/readiness/collect.ts`.

#### 4.7 Mega Bot und Mission Control

**Delegation**

- Baut auf dem bestehenden Hook auf: Die Agent-Schleife kennt `SPAWN_WORKER` (`src/lib/agent/loop.ts:773-812`).
  `BaseArm` setzt ihn heute auf `requestCapability` (`src/lib/arms/base.ts:942`), das eine weitere Stufe in die
  Mission einfügt.
- Neu ist ein Ziel `bot:<id>`: Der Mega Bot ruft `delegate_to_bot(botId, task, expectedArtifact)` auf. Das erzeugt
  eine Kind-Stufe mit der veröffentlichten Konfiguration dieses Bots.
- **Auswahl:** nach Beschreibung und Arm-Passung, oder fest per `@Name`. Die Entscheidung mit Begründung kommt in
  den Lauf-Verlauf.
- **Grenzen:**
  - Höchstens 4 Kinder gleichzeitig, Tiefe 1 (ein Kind delegiert nicht weiter).
  - Das Budget der Kinder wird vom Mega-Bot-Budget abgezogen.
  - Ein abgelehntes Kind-Ergebnis wird höchstens einmal neu vergeben.
- **Ergebnis:** Kinder liefern Artefakte mit Verifikationsstatus. Der Mega Bot fasst zusammen, und die Mission
  wird von der bestehenden Meta-Verifikation geprüft. Ein Kind mit „rejected“ darf nicht als bestätigt in der
  Antwort stehen.
- **Rechte:** Jedes Kind läuft mit den Rechten seines Bots, nicht mit denen des Mega Bots. Seiteneffekte gehen
  durch die Freigabe, mit Hinweis auf das anfragende Kind.

**Mission Control (`/app/mission`, verlinkt aus dem Mega-Bot-Chat)**

- Spalten oder Karten je Teillauf: wartet, läuft, wartet auf Freigabe, bestätigt, abgelehnt.
- Je Karte: Bot-Avatar, Teilaufgabe, Fortschritt, letzte Artefakte (Plan, Aufgabenliste, Diff, Screenshot).
- Freigaben direkt in der Karte, mit Kommentaren an Artefakten ohne Abbruch des Laufs (Vorbild Antigravity).
- Live über den bestehenden Snapshot `GET /api/runtime/[runId]` (Poll alle 2 s). Kein zweiter Kanal, solange der
  Poll reicht.
- Angezeigt werden nur echte Zählungen: laufende Kinder, verbrauchtes Budget, Modellaufrufe.

**Tests**

- Mit gemocktem Anbieter: Der Mega Bot zerlegt eine Aufgabe, delegiert an 2 Bots und fasst zusammen.
- Grenzen: Tiefe, Anzahl gleichzeitiger Kinder, Budget.
- Ein Kind ohne GitHub-Recht kann nicht schreiben, auch wenn der Mega Bot es verlangt.

#### 4.8 Routing auf Quasnir vorbereiten (Standard aus)

`UnoRouterProvider` lässt sich dafür nicht wiederverwenden. Er kennt nur einen Endpunkt und einen Schlüsselsatz,
sein Pool verwirft Modelle ohne `:free`, und konfigurierte kostenpflichtige Modelle ignoriert er.

1. `src/lib/env.ts`: `QUASNIR_BASE_URL`, `QUASNIR_API_KEY`, `QUASNIR_MODEL_ID`, `QUASNIR_ROLES`,
   `QUASNIR_TIMEOUT_MS`, `QUASNIR_ROUTING=off|shadow|on` (Standard `off`). Dazu `.env.example` und
   `scripts/sync-vercel-runtime-env.mjs`.
2. Neu `src/lib/models/openai-compatible.ts`: ein `ModelProvider` (`provider.ts:22-57`) für
   vLLM-artige Endpunkte.
   - `classifyFailure`, `parseSseFrame` und `normalizeUsage` aus `unorouter.ts` exportieren und wiederverwenden.
   - Eigene Health-Prüfung (`/v1/models` oder `/health`) mit Circuit Breaker und eigenem Parallelitätslimit, nicht
     über den `CapacityScheduler` des Pools.
3. Neu `src/lib/models/failover.ts`: erst Quasnir, dann der bestehende Pool.
   - Zurück zum Pool, wenn der Endpunkt ausfällt: Verweigerung, `timeout`, `invalid_stream`,
     `provider_not_configured`.
   - Zurück zum Pool, wenn die Antwort schwach ist: `invalid_json`, gescheiterte `validate` in `structured()`,
     leerer Text.
   - `stream()` fällt nur vor dem ersten Delta zurück.
   - `servedModel()` liefert das tatsächlich genutzte Modell.
4. Eine Fabrik `createModelProvider(opts, selection)` ersetzt die direkten `new UnoRouterProvider`-Aufrufe in:
   - `runtime/executor.ts:228-238`, `runtime/worker.ts:239-249`;
   - `rouge/foundations/unorouter.ts:44`, `agent/pulse/catalog.ts:375`.
5. Modi:
   - `off`: kein Aufruf.
   - `shadow`: Dieselbe Anfrage geht zusätzlich an Quasnir und wird mit dem Pool-Ergebnis verglichen und
     gespeichert. Der Nutzer sieht nur die Pool-Antwort.
   - `on`: nur für die Rollen in `QUASNIR_ROLES`, mit Rückfall.
6. Labels (`src/lib/lab/honesty.ts:10-14`, `src/lib/ui/chat-status.ts`, `ai-lab/tracks/definitions/quasnir.json`)
   zeigen das tatsächlich antwortende Modell. Steht „Quasnir“ da, hat das Quasnir-System geantwortet, mit dem
   Info-Hinweis auf die Basis Qwen3.8-27B; beim Rückfall auf den Pool steht der Pool-Modellname da.
7. Lab-Pfad: `NativeModelProvider` (Fixture) durch den HTTP-Anbieter ersetzen und die Sperren in
   `ai-lab/programs/serve.ts:102-189` und `ai-lab/tracks/status.ts:28-47` an `QUASNIR_ROUTING` binden.
8. Readiness: Quasnir in `readiness/collect.ts:34-66`, `api/health/route.ts:25` und
   `product/model-status.ts:98-104`.
9. Erfassung: Anbieter und `servedModel()` in `model_calls` (Fehler 18).
10. **Gate für `on`:** Quasnir bekommt eine Rolle erst, wenn es auf der internen Eval-Suite dieser Rolle mindestens
    so gut ist wie der Pool und der Owner zustimmt.
    - Gemessener Stand am 21.10.2026: MBPP 1,4 %, HumanEval 0 %. Quasnir bleibt also auf `off` oder `shadow`.
11. **Vertrag für den Server** (gebaut wird er im Repo 67, nicht hier):
    - `GET /v1/models`, `GET /health`, `POST /v1/chat/completions` mit SSE.
    - Felder `model`, `messages`, `max_tokens`, `temperature`, `stop`, `stream`; in der Antwort `usage`.
    - Bearer-Token.
    - In Osirus Vertragstests gegen einen Mock-Server. Der Betrieb braucht eine GPU und damit die Freigabe des
      Owners. Quasnir ist eingefroren.
12. **Tests**
    - Neu: Tests für den Anbieter und den Rückfall, nach dem Muster von `tests/unorouter.test.ts`.
    - Anpassen: `tests/free-model-policy.test.ts`, `model-indicator.test.ts`, `model-usage.test.ts`,
      `lab-routing.test.ts`, `lab-honesty.test.ts`, `chat-status.test.ts`, `sync-vercel-env.test.ts`.
    - Anpassen im Ordner `ai-lab/tests/`: `fallback-pool.test.ts`, `quasnir.test.ts`,
      `quasnir-program.test.ts`, `quasnir-track.test.ts`.

### 5. PR-Schnitt und Reihenfolge

| PR  | Inhalt                                                                        | hängt ab von               |
| --- | ----------------------------------------------------------------------------- | -------------------------- |
| 1   | Fehler 1–2, 10 (Chat über Runtime mit Verlauf und Laufzustand)                | –                          |
| 2   | Fehler 3–9, 11–18 (Laufzeit, Anbieter, Routen, Env)                           | –                          |
| 3   | Fehler 19–28 (Hydration, Grenzen, Barrierefreiheit, Coding, toter Code, i18n) | Owner-Entscheidung Sprache |
| 4   | Designsystem 2.0: Tokens, Bausteine, Animationen, View Transitions            | 3                          |
| 5   | Migration `023_bots.sql`, Repository, RLS-Tests                               | –                          |
| 6   | Bot-API und Laufzeit (4.4)                                                    | 5                          |
| 7   | Studio-Oberfläche (4.5) mit Fixtures und UI-Tests                             | 4, 6                       |
| 8   | Mega Bot und Mission Control (4.7)                                            | 6, 7                       |
| 9   | Anbieter-Abstraktion und Quasnir-Vorbereitung, Standard `off` (4.8)           | 2                          |
| 10  | Abschluss-Audit: alle Prüfungen, Playwright gegen eine Preview, Bericht       | alle                       |

PR 1, 2, 5 und 9 können parallel laufen.

### 6. Definition of Done

- Alle Fehler aus 4.1 behoben, jeder mit Regressionstest.
- Ein Nutzer kann:
  - einen Bot beschreiben, erzeugen lassen, anpassen, testen, veröffentlichen, duplizieren, eine alte Version
    wiederherstellen und archivieren;
  - mit dem Mega Bot eine Aufgabe stellen, die an mindestens 2 Bots geht, und in Mission Control Fortschritt,
    Artefakte und Freigaben sehen.
- Kein Bot sieht Daten eines anderen Workspace oder den privaten Speicher eines anderen Bots (Tests).
- Chat, Agent, Bot und Mega Bot streamen, zeigen ihren Laufzustand, verlieren beim Schließen des Tabs keinen Lauf
  und zeigen bei langen Threads die neuesten Nachrichten.
- Jede Seite hat Lade-, Leer- und Fehlerzustände. axe ohne ernste und kritische Funde in Hell und Dunkel.
  375–1440 px ohne horizontales Scrollen. Tastatur vollständig.
- Leistung: CLS ≤ 0,1, LCP ≤ 2,5 s, Skript-Budget eingehalten.
- Animationen nur über `transform` und `opacity`; bei Reduced Motion keine.
- `tsc`, `eslint` (0 Warnungen), `prettier`, `vitest` und Playwright grün. Die Testzahl liegt über der
  Ausgangslage von 1.296.
- `QUASNIR_ROUTING=off` ist Standard. Shadow-Betrieb und Rückfall sind gegen einen Mock getestet.
- Ein Abschlussbericht nennt gemessene Zahlen, keine Schätzungen.

### 7. Entscheidungen des Owners (vor PR 3 und PR 5)

| #   | Frage                  | Empfehlung                                                                                       |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| O1  | Sprache der Oberfläche | Deutsch als Standard, Englisch umschaltbar; Rechtstexte sind schon deutsch                       |
| O2  | Produktnamen           | Osirus Studio, Mega Bot, Mission Control; keine fremden Marken                                   |
| O3  | Teilen                 | Zuerst nur im Workspace; ein öffentlicher Marktplatz erst mit Abrechnung (Stripe) und Moderation |
| O4  | Bots je Workspace      | 50 als Grenze, später nach Tarif                                                                 |
| O5  | Autonomie-Standard     | `request_review` für neue Bots                                                                   |
| O6  | Quasnir                | `off` bis zum Gate; `shadow` erst, wenn ein Server läuft (braucht GPU-Freigabe)                  |

### 8. Was du nicht tust

- Keine Namen oder Logos von xAI, Google oder anderen Anbietern im Produkt.
- Keine Schwarm- oder Agentenzahlen, die nicht laufen.
- Kein Merge ohne grüne Prüfungen. Keine Migration auf Produktion ohne Freigabe des Owners.
- Keine Secrets in Code, Logs, Commits oder Chat.
- Kein GPU-Lauf, kein Training, keine Änderung an Quasnir-Gewichten.
