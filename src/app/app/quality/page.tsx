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
export const metadata: Metadata = { title: "Quality" };

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
      title="Quality"
      lede="How Osirus performed in this workspace, counted from what the runtime recorded. Small samples are shown as they are."
      actions={
        <nav className="filter-tabs" aria-label="Time window">
          {[7, 30].map((window) => (
            <Link
              key={window}
              href={`/app/quality?days=${window}` as Route}
              aria-current={window === days ? "page" : undefined}
            >
              Last {window} days
            </Link>
          ))}
        </nav>
      }
    >
      <section className="section" aria-labelledby="runs-heading">
        <h2 className="section-title" id="runs-heading">
          Runs
        </h2>
        <div className="metric-grid">
          <Metric
            label="Runs"
            value={formatCount(runs.runs)}
            note={`${runs.completed} completed · ${runs.failed} failed`}
          />
          <Metric
            label="Success"
            value={rateText(runs.successRate, runs.runs)}
            note="Completed runs"
          />
          <Metric
            label="Verified success"
            value={rateText(runs.verifiedRate, runs.runs)}
            note="Every verdict verified"
          />
          <Metric
            label="False completions"
            value={rateText(runs.falseCompletionRate, runs.completed)}
            note={`${runs.falseCompletions} completed against a rejected verdict`}
          />
          <Metric
            label="Repair rate"
            value={rateText(runs.repairRate, runs.runs)}
            note="Plan revised at least once"
          />
          <Metric
            label="Resume rate"
            value={rateText(runs.resumeRate, runs.yielded)}
            note={`${runs.resumed} of ${runs.yielded} paused runs finished`}
          />
        </div>
      </section>

      <section className="section" aria-labelledby="models-heading">
        <h2 className="section-title" id="models-heading">
          Models
        </h2>
        <div className="metric-grid">
          <Metric label="Model calls" value={formatCount(models.calls)} />
          <Metric
            label="Model failure rate"
            value={rateText(models.failureRate, models.calls)}
            note={`${models.failures} failed`}
          />
          <Metric
            label="Latency p50 / p95"
            value={`${formatDuration(models.p50LatencyMs) ?? "—"} / ${formatDuration(models.p95LatencyMs) ?? "—"}`}
          />
          <Metric label="Tokens" value={formatCount(models.tokens)} />
          <Metric
            label="Cost"
            value={formatUsd(models.costUsd)}
            note="As reported by the provider"
          />
        </div>
        {roles.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Model routing by role</caption>
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  <th scope="col">Model</th>
                  <th scope="col" className="num">
                    Calls
                  </th>
                  <th scope="col" className="num">
                    Tokens
                  </th>
                  <th scope="col" className="num">
                    Cost
                  </th>
                  <th scope="col" className="num">
                    p50
                  </th>
                  <th scope="col" className="num">
                    Failure rate
                  </th>
                  <th scope="col" className="num">
                    Runs verified
                  </th>
                </tr>
              </thead>
              <tbody>
                {roles.map((row) => (
                  <tr key={`${row.role}:${row.model}`}>
                    <td>{humanize(row.role.toLowerCase())}</td>
                    <td className="mono">{row.model}</td>
                    <td className="num">{formatCount(row.calls)}</td>
                    <td className="num">{formatCount(row.tokens)}</td>
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
          Arms
        </h2>
        {arms.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Quality by arm</caption>
              <thead>
                <tr>
                  <th scope="col">Arm</th>
                  <th scope="col" className="num">
                    Runs
                  </th>
                  <th scope="col" className="num">
                    Success
                  </th>
                  <th scope="col" className="num">
                    Verified
                  </th>
                  <th scope="col" className="num">
                    False completions
                  </th>
                  <th scope="col" className="num">
                    Median duration
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
          <p className="subtle">No runs in this window.</p>
        )}
      </section>

      <section className="section" aria-labelledby="skills-heading">
        <div>
          <h2 className="section-title" id="skills-heading">
            Skills
          </h2>
          <p className="section-lede">
            How often each skill was selected and how often those runs verified.
            This is correlation: without an A/B comparison it does not show that
            a skill caused a result.
          </p>
        </div>
        {skills.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Skill usage</caption>
              <thead>
                <tr>
                  <th scope="col">Skill</th>
                  <th scope="col" className="num">
                    Selections
                  </th>
                  <th scope="col" className="num">
                    Verified share
                  </th>
                  <th scope="col" className="num">
                    Median latency
                  </th>
                  <th scope="col" className="num">
                    Tokens
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
                    <td className="num">{formatCount(row.tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtle">No skill selections in this window.</p>
        )}
      </section>

      <section className="section" aria-labelledby="tools-heading">
        <h2 className="section-title" id="tools-heading">
          Tools and connections
        </h2>
        {tools.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Tool reliability</caption>
              <thead>
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">Source</th>
                  <th scope="col" className="num">
                    Calls
                  </th>
                  <th scope="col" className="num">
                    Success
                  </th>
                  <th scope="col" className="num">
                    Refused
                  </th>
                  <th scope="col" className="num">
                    p50
                  </th>
                  <th scope="col">Most common error</th>
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
                          : "Built-in"}
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
          <p className="subtle">No tool calls in this window.</p>
        )}
      </section>

      <section className="section" aria-labelledby="arena-heading">
        <div>
          <h2 className="section-title" id="arena-heading">
            Agent Arena
          </h2>
          <p className="section-lede">
            Fixed tasks that run the real arms against a real model in CI (the
            Live evals workflow). Results are CI artifacts with the model id and
            time; none are stored or summarized here, and a few synthetic tasks
            are not a benchmark. A regression gate compares each run with the
            stored baseline for its model.
          </p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Arena suites and tasks</caption>
            <thead>
              <tr>
                <th scope="col">Suite</th>
                <th scope="col">Task</th>
                <th scope="col">Checks</th>
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
                            ? `verdict: ${task.expect.verdicts.join(" or ")}`
                            : null,
                          task.expect.answerIncludes?.length
                            ? `answer mentions ${task.expect.answerIncludes.length} fact(s)`
                            : null,
                          task.fault ? "injected tool failure" : null,
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
