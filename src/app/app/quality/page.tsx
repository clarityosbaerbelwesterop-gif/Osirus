import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Metric, rateText } from "@/components/quality/metric";
import { PageFrame } from "@/components/shell/page-frame";
import { ARENA_TASKS } from "@/lib/arena/suites";
import { SUITES } from "@/lib/arena/metrics";
import { requireProductSession } from "@/lib/product/session";
import { isOrganizationAdmin } from "@/lib/product/shell";
import {
  armQuality,
  modelQuality,
  modelRoleQuality,
  runQuality,
  skillQuality,
  toolQuality,
  type QualityWindow,
} from "@/lib/quality/metrics";
import {
  armLabel,
  formatCount,
  formatDuration,
  formatPercent,
  formatUsd,
  humanize,
  toolLabel,
} from "@/lib/ui/labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Qualität" };

export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { identity } = await requireProductSession();
  if (!(await isOrganizationAdmin(identity))) notFound();
  const { days: rawDays } = await searchParams;
  const days: QualityWindow = rawDays === "30" ? 30 : 7;
  const [runs, models, arms, skills, tools, roles] = await Promise.all([
    runQuality(identity, days),
    modelQuality(identity, days),
    armQuality(identity, days),
    skillQuality(identity, days),
    toolQuality(identity, days),
    modelRoleQuality(identity, days),
  ]);

  return (
    <PageFrame
      title="Qualität"
      lede="Wie Osirus in diesem Arbeitsbereich abgeschnitten hat, gezählt aus dem, was die Laufzeit aufgezeichnet hat. Kleine Stichproben werden so gezeigt, wie sie sind."
      actions={
        <nav className="filter-tabs" aria-label="Zeitraum">
          {[7, 30].map((window) => (
            <Link
              key={window}
              href={`/app/quality?days=${window}` as Route}
              aria-current={window === days ? "page" : undefined}
            >
              Letzte {window} Tage
            </Link>
          ))}
        </nav>
      }
    >
      <section className="section" aria-labelledby="runs-heading">
        <h2 className="section-title" id="runs-heading">
          Läufe
        </h2>
        <div className="metric-grid">
          <Metric
            label="Läufe"
            value={formatCount(runs.runs)}
            note={`${runs.completed} abgeschlossen · ${runs.failed} fehlgeschlagen`}
          />
          <Metric
            label="Erfolg"
            value={rateText(runs.successRate, runs.runs)}
            note="Abgeschlossene Läufe"
          />
          <Metric
            label="Bestätigter Erfolg"
            value={rateText(runs.verifiedRate, runs.runs)}
            note="Jedes Urteil bestätigt"
          />
          <Metric
            label="Falsche Abschlüsse"
            value={rateText(runs.falseCompletionRate, runs.completed)}
            note={`${runs.falseCompletions} trotz abgelehntem Urteil abgeschlossen`}
          />
          <Metric
            label="Nachbesserungsquote"
            value={rateText(runs.repairRate, runs.runs)}
            note="Plan mindestens einmal überarbeitet"
          />
          <Metric
            label="Fortsetzungsquote"
            value={rateText(runs.resumeRate, runs.yielded)}
            note={`${runs.resumed} von ${runs.yielded} pausierten Läufen beendet`}
          />
        </div>
      </section>

      <section className="section" aria-labelledby="models-heading">
        <h2 className="section-title" id="models-heading">
          Modelle
        </h2>
        <div className="metric-grid">
          <Metric label="Modellaufrufe" value={formatCount(models.calls)} />
          <Metric
            label="Fehlerquote der Modelle"
            value={rateText(models.failureRate, models.calls)}
            note={`${models.failures} fehlgeschlagen`}
          />
          <Metric
            label="Latenz p50 / p95"
            value={`${formatDuration(models.p50LatencyMs) ?? "—"} / ${formatDuration(models.p95LatencyMs) ?? "—"}`}
          />
          <Metric
            label="Kosten"
            value={formatUsd(models.costUsd)}
            note="Laut Anbieter"
          />
        </div>
        {roles.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Modell-Routing nach Rolle</caption>
              <thead>
                <tr>
                  <th scope="col">Rolle</th>
                  <th scope="col" className="num">
                    Aufrufe
                  </th>
                  <th scope="col" className="num">
                    Kosten
                  </th>
                  <th scope="col" className="num">
                    p50
                  </th>
                  <th scope="col" className="num">
                    Fehlerquote
                  </th>
                  <th scope="col" className="num">
                    Läufe bestätigt
                  </th>
                </tr>
              </thead>
              <tbody>
                {roles.map((row) => (
                  <tr key={`${row.role}:${row.model}`}>
                    <td>{humanize(row.role.toLowerCase())}</td>
                    <td className="num">{formatCount(row.calls)}</td>
                    <td className="num">{formatUsd(row.costUsd)}</td>
                    <td className="num">
                      {formatDuration(row.p50LatencyMs) ?? "—"}
                    </td>
                    <td className="num">{formatPercent(row.failureRate)}</td>
                    <td className="num">
                      {formatPercent(row.verifiedOutcome)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="section" aria-labelledby="arms-heading">
        <h2 className="section-title" id="arms-heading">
          Arme
        </h2>
        {arms.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Qualität nach Arm</caption>
              <thead>
                <tr>
                  <th scope="col">Arm</th>
                  <th scope="col" className="num">
                    Läufe
                  </th>
                  <th scope="col" className="num">
                    Erfolg
                  </th>
                  <th scope="col" className="num">
                    Bestätigt
                  </th>
                  <th scope="col" className="num">
                    Falsche Abschlüsse
                  </th>
                  <th scope="col" className="num">
                    Mittlere Dauer
                  </th>
                </tr>
              </thead>
              <tbody>
                {arms.map((row) => (
                  <tr key={row.arm}>
                    <td>{armLabel(row.arm)}</td>
                    <td className="num">{row.runs}</td>
                    <td className="num">{formatPercent(row.successRate)}</td>
                    <td className="num">{formatPercent(row.verifiedRate)}</td>
                    <td className="num">{row.falseCompletions}</td>
                    <td className="num">
                      {formatDuration(row.medianDurationMs) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtle">Keine Läufe in diesem Zeitraum.</p>
        )}
      </section>

      <section className="section" aria-labelledby="skills-heading">
        <div>
          <h2 className="section-title" id="skills-heading">
            Skills
          </h2>
          <p className="section-lede">
            Wie oft jeder Skill gewählt wurde und wie oft diese Läufe bestätigt
            wurden. Das ist eine Korrelation: Ohne A/B-Vergleich zeigt sie
            nicht, dass ein Skill ein Ergebnis verursacht hat.
          </p>
        </div>
        {skills.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Nutzung der Skills</caption>
              <thead>
                <tr>
                  <th scope="col">Skill</th>
                  <th scope="col" className="num">
                    Auswahlen
                  </th>
                  <th scope="col" className="num">
                    Anteil bestätigt
                  </th>
                  <th scope="col" className="num">
                    Mittlere Latenz
                  </th>
                </tr>
              </thead>
              <tbody>
                {skills.map((row) => (
                  <tr key={row.skill}>
                    <td className="mono">{row.skill}</td>
                    <td className="num">{row.selections}</td>
                    <td className="num">{formatPercent(row.verifiedShare)}</td>
                    <td className="num">
                      {formatDuration(row.medianLatencyMs) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtle">Keine Skill-Auswahl in diesem Zeitraum.</p>
        )}
      </section>

      <section className="section" aria-labelledby="tools-heading">
        <h2 className="section-title" id="tools-heading">
          Werkzeuge und Verbindungen
        </h2>
        {tools.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">
                Zuverlässigkeit der Werkzeuge
              </caption>
              <thead>
                <tr>
                  <th scope="col">Werkzeug</th>
                  <th scope="col">Quelle</th>
                  <th scope="col" className="num">
                    Aufrufe
                  </th>
                  <th scope="col" className="num">
                    Erfolg
                  </th>
                  <th scope="col" className="num">
                    Abgelehnt
                  </th>
                  <th scope="col" className="num">
                    p50
                  </th>
                  <th scope="col">Häufigster Fehler</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((row) => (
                  <tr key={row.tool}>
                    <td>{toolLabel(row.tool)}</td>
                    <td>
                      {row.source === "mcp"
                        ? "MCP"
                        : row.source === "github"
                          ? "GitHub"
                          : "Eingebaut"}
                    </td>
                    <td className="num">{row.calls}</td>
                    <td className="num">{formatPercent(row.successRate)}</td>
                    <td className="num">{row.refused}</td>
                    <td className="num">
                      {formatDuration(row.p50LatencyMs) ?? "—"}
                    </td>
                    <td className="mono">{row.topError ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtle">Keine Werkzeugaufrufe in diesem Zeitraum.</p>
        )}
      </section>

      <section className="section" aria-labelledby="arena-heading">
        <div>
          <h2 className="section-title" id="arena-heading">
            Agent Arena
          </h2>
          <p className="section-lede">
            Feste Aufgaben, die die echten Arme in der CI gegen ein echtes
            Modell laufen lassen (Workflow „Live evals“). Die Ergebnisse sind
            CI-Artefakte mit Modell-ID und Zeitpunkt; hier wird nichts davon
            gespeichert oder zusammengefasst, und ein paar synthetische Aufgaben
            sind kein Benchmark. Ein Regressions-Gate vergleicht jeden Lauf mit
            der gespeicherten Basislinie seines Modells.
          </p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Arena-Suites und Aufgaben</caption>
            <thead>
              <tr>
                <th scope="col">Suite</th>
                <th scope="col">Aufgabe</th>
                <th scope="col">Prüfungen</th>
              </tr>
            </thead>
            <tbody>
              {SUITES.flatMap((suite) =>
                ARENA_TASKS.filter((task) => task.suite === suite).map(
                  (task) => (
                    <tr key={task.id}>
                      <td>{humanize(suite)}</td>
                      <td>
                        <div className="mono">{task.id}</div>
                        <div className="subtle wrap-anywhere">
                          {task.objective.slice(0, 160)}
                        </div>
                      </td>
                      <td className="subtle">
                        {[
                          task.expect.verdicts?.length
                            ? `Urteil: ${task.expect.verdicts.join(" oder ")}`
                            : null,
                          task.expect.answerIncludes?.length
                            ? `Antwort nennt ${task.expect.answerIncludes.length} Fakt(en)`
                            : null,
                          task.fault ? "eingespeister Werkzeugfehler" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                    </tr>
                  ),
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </PageFrame>
  );
}
