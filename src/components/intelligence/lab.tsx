import type { LabView } from "@/lib/intelligence/lab/view";
import { CYCLE_PHASES, type CapabilityStatus } from "@/lib/intelligence/types";
import {
  formatCount,
  formatPercent,
  humanize,
  type Tone,
} from "@/lib/ui/labels";
import { Metric } from "../quality/metric";
import { Badge } from "../ui/badge";
import { EmptyState } from "../ui/empty-state";
import { RelativeTime } from "../ui/relative-time";
import { LabControls } from "./lab-controls";

// The Intelligence Lab: what the Foundry measured, what it is working on,
// what it tried, what it kept and why. Operators only. Every number here is
// what the store recorded; small samples are shown as small.

const STATUS_TONE: Record<CapabilityStatus, Tone> = {
  unmeasured: "neutral",
  weak: "danger",
  developing: "warning",
  strong: "success",
};

const VERSION_TONE: Record<string, Tone> = {
  champion: "accent",
  active: "success",
  canary: "warning",
  verified: "success",
  experimental: "neutral",
  draft: "neutral",
  degraded: "danger",
  rejected: "danger",
  deprecated: "neutral",
};

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  improved: { label: "Verified improvement", tone: "success" },
  no_improvement: { label: "No improvement", tone: "neutral" },
  inconclusive: { label: "Inconclusive", tone: "warning" },
  regressed: { label: "Regressed", tone: "danger" },
};

const PHASE_LABEL: Record<string, string> = {
  measure: "Measure",
  select_agenda: "Select",
  generate_data: "Generate",
  baseline: "Baseline",
  analyze: "Analyze",
  hypothesize: "Hypothesize",
  design: "Design",
  dev_eval: "Dev eval",
  adversarial_eval: "Adversarial",
  holdout_eval: "Holdout",
  decide: "Decide",
  update_registry: "Update",
  compile: "Compile",
  next: "Next",
};

function rate(value: number | null, samples: number) {
  return value === null || samples === 0 ? "—" : formatPercent(value);
}

function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="section" aria-labelledby={`${id}-heading`}>
      <h2 className="section-title" id={`${id}-heading`}>
        {title}
      </h2>
      {lede ? <p className="section-lede">{lede}</p> : null}
      {children}
    </section>
  );
}

export function IntelligenceLab({
  view,
  canRunNow,
}: {
  view: LabView;
  canRunNow: boolean;
}) {
  const { settings, usage } = view;
  const pause =
    settings.providerPause &&
    Date.parse(settings.providerPause.until) > Date.parse(view.generatedAt)
      ? settings.providerPause
      : null;
  const weakest = view.capabilities
    .filter((entry) => entry.status !== "unmeasured")
    .sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))[0];

  return (
    <div className="lab">
      <Section id="status" title="Status">
        {pause ? (
          <p className="notice notice-warning" role="status">
            The model provider refused a call ({pause.code}) after{" "}
            {pause.observedCalls} calls today. No trial starts before{" "}
            <RelativeTime value={pause.until} />; nothing was charged to a
            strategy.
          </p>
        ) : null}
        <div className="metric-grid">
          <Metric
            label="Foundry"
            value={settings.flags.intelligencePlane ? "Running" : "Off"}
            note={`Model ${settings.foundryModel}`}
          />
          <Metric
            label="Model calls today"
            value={`${formatCount(usage.model_calls)} / ${formatCount(settings.budgets.dailyModelCalls)}`}
            note={`${formatCount(usage.trials)} trials · ${formatCount(usage.chained_ticks)} chained ticks`}
          />
          <Metric
            label="Experience"
            value={formatCount(view.experience.total)}
            note={`${formatCount(view.experience.verified)} verified · ${formatCount(view.experience.failures)} failures`}
          />
          <Metric
            label="Weakest capability"
            value={weakest ? weakest.name : "—"}
            note={
              weakest
                ? `${rate(weakest.rate, weakest.samples)} over ${weakest.samples} judged runs`
                : "Nothing measured yet"
            }
          />
        </div>
        <LabControls settings={settings} canRunNow={canRunNow} />
      </Section>

      <Section
        id="cycle"
        title="Current cycle"
        lede="The research loop: measure, pick the most valuable weakness, hypothesise, test against the champion on the same tasks, decide, learn, pick the next target."
      >
        {view.cycle ? (
          <div className="stack">
            <p className="lab-meta">
              {view.cycle.capabilityId ?? "Selecting a target"} · started{" "}
              <RelativeTime value={view.cycle.startedAt} />
            </p>
            <ol className="lab-phases" aria-label="Cycle phases">
              {CYCLE_PHASES.map((phase, index) => (
                <li
                  key={phase}
                  className="lab-phase"
                  data-state={
                    index < view.cycle!.phaseIndex
                      ? "done"
                      : index === view.cycle!.phaseIndex
                        ? "current"
                        : "todo"
                  }
                  aria-current={
                    index === view.cycle!.phaseIndex ? "step" : undefined
                  }
                >
                  {PHASE_LABEL[phase] ?? humanize(phase)}
                </li>
              ))}
            </ol>
            {view.cycle.log.length ? (
              <ol className="lab-log">
                {view.cycle.log.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <span className="lab-log-phase">
                      {PHASE_LABEL[entry.phase] ?? entry.phase}
                    </span>
                    <span>{entry.note}</span>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No cycle is running">
            The next scheduler tick starts one when the Foundry is on and the
            provider allows it.
          </EmptyState>
        )}
      </Section>

      <Section
        id="capabilities"
        title="Capability map"
        lede="Measured on independently judged tasks only. A capability held back by a weaker dependency says so."
      >
        <ul className="lab-caps">
          {view.capabilities.map((entry) => (
            <li key={entry.id} className="lab-cap" data-depth={entry.depth}>
              <div className="lab-cap-head">
                <span className="lab-cap-name">{entry.name}</span>
                <Badge tone={STATUS_TONE[entry.status]}>
                  {humanize(entry.status)}
                </Badge>
              </div>
              <p className="lab-meta">
                <code>{entry.id}</code> · {rate(entry.rate, entry.samples)}{" "}
                verified · {entry.samples} runs
              </p>
              {entry.dependsOn.length ? (
                <p className="lab-meta">
                  Depends on{" "}
                  {entry.dependsOn.map((dep, index) => (
                    <span key={dep.id}>
                      {index ? ", " : ""}
                      <code>{dep.id}</code>
                    </span>
                  ))}
                </p>
              ) : null}
              {entry.heldBackBy ? (
                <p className="lab-meta lab-warn">
                  Held back by <code>{entry.heldBackBy}</code>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="agenda" title="Research agenda">
        {view.agenda.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Why</th>
                  <th scope="col" className="num">
                    Gain per call
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {view.agenda.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td className="lab-muted">{item.rationale}</td>
                    <td className="num">{item.score.toFixed(2)}</td>
                    <td>{humanize(item.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="The agenda is empty">
            It is built from the capability map on the first cycle.
          </EmptyState>
        )}
      </Section>

      <Section
        id="experiments"
        title="Experiments"
        lede="Champion and challengers on the same tasks; provider refusals are never counted."
      >
        {view.experiments.length ? (
          <ul className="item-list">
            {view.experiments.map((experiment) => (
              <li key={experiment.id} className="lab-card">
                <div className="lab-cap-head">
                  <span className="lab-cap-name">
                    {experiment.championLabel} vs{" "}
                    {experiment.challengers.map((c) => c.label).join(", ") ||
                      "no challenger yet"}
                  </span>
                  {experiment.outcome ? (
                    <Badge tone={OUTCOME[experiment.outcome]!.tone}>
                      {OUTCOME[experiment.outcome]!.label}
                    </Badge>
                  ) : (
                    <Badge>{humanize(experiment.status)}</Badge>
                  )}
                </div>
                {experiment.challengers.map((challenger) => (
                  <p key={challenger.label} className="lab-meta">
                    {challenger.label}: {challenger.genome} ·{" "}
                    {humanize(challenger.status)}
                  </p>
                ))}
                {experiment.summary ? (
                  <p className="lab-meta">{experiment.summary}</p>
                ) : null}
                {experiment.comparisons.length ? (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">Partition</th>
                          <th scope="col" className="num">
                            Champion
                          </th>
                          <th scope="col" className="num">
                            Challenger
                          </th>
                          <th scope="col" className="num">
                            P(better)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {experiment.comparisons.map((row) => (
                          <tr key={`${row.versionId}-${row.partition}`}>
                            <td>{humanize(row.partition)}</td>
                            <td className="num">
                              {row.champion.verified}/{row.champion.n}
                            </td>
                            <td className="num">
                              {row.challenger.verified}/{row.challenger.n}
                            </td>
                            <td className="num">
                              {row.probabilityBetter.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No experiments yet" />
        )}
      </Section>

      <Section
        id="improvements"
        title="Why did Osirus improve?"
        lede="Each completed cycle, with what changed and the evidence. A cycle that found nothing says so."
      >
        {view.history.length ? (
          <ul className="item-list">
            {view.history.map((cycle) => (
              <li key={cycle.id} className="lab-card">
                <div className="lab-cap-head">
                  <span className="lab-cap-name">
                    {cycle.capabilityId ?? "Cycle"}
                  </span>
                  {cycle.outcome ? (
                    <Badge tone={OUTCOME[cycle.outcome]!.tone}>
                      {OUTCOME[cycle.outcome]!.label}
                    </Badge>
                  ) : (
                    <Badge>{humanize(cycle.status)}</Badge>
                  )}
                </div>
                {cycle.why ? (
                  <dl className="lab-why">
                    {Object.entries(cycle.why).map(([key, value]) => (
                      <div key={key}>
                        <dt>{humanize(key)}</dt>
                        <dd>
                          {Array.isArray(value)
                            ? value.join("; ") || "none"
                            : String(value ?? "—")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : cycle.summary ? (
                  <p className="lab-meta">{cycle.summary}</p>
                ) : null}
                <p className="lab-meta">
                  {cycle.completedAt ? (
                    <>
                      Completed <RelativeTime value={cycle.completedAt} />
                    </>
                  ) : null}
                  {cycle.next ? ` · next: ${cycle.next}` : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No completed cycle yet" />
        )}
      </Section>

      <Section id="strategies" title="Strategy evolution">
        {view.strategies.map((strategy) => (
          <div key={strategy.strategyId} className="table-wrap">
            <table className="table">
              <caption className="lab-caption">{strategy.strategyId}</caption>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Status</th>
                  <th scope="col">Genome</th>
                  <th scope="col">Hypothesis</th>
                </tr>
              </thead>
              <tbody>
                {strategy.versions.map((version) => (
                  <tr key={version.id}>
                    <td>v{version.version}</td>
                    <td>
                      <Badge tone={VERSION_TONE[version.status] ?? "neutral"}>
                        {humanize(version.status)}
                        {version.status === "canary"
                          ? ` ${version.canaryPercent}%`
                          : ""}
                      </Badge>
                    </td>
                    <td>{version.genome}</td>
                    <td className="lab-muted">{version.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Section>

      <Section
        id="generation"
        title="Curriculum, self-play and red intelligence"
      >
        {view.generation.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Configuration</th>
                  <th scope="col" className="num">
                    Produced
                  </th>
                  <th scope="col" className="num">
                    Verified
                  </th>
                  <th scope="col" className="num">
                    Rejected
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.generation.map((run, index) => (
                  <tr key={index}>
                    <td>{humanize(run.kind)}</td>
                    <td className="lab-muted">{run.note}</td>
                    <td className="num">{run.produced}</td>
                    <td className="num">{run.verified}</td>
                    <td className="num">{run.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Nothing generated yet" />
        )}
      </Section>

      <Section id="data" title="Datasets and learning">
        <div className="metric-grid">
          {Object.entries(view.artifacts).map(([kind, count]) => (
            <Metric key={kind} label={humanize(kind)} value={String(count)} />
          ))}
        </div>
        {view.strategicMemory.length ? (
          <ul className="lab-list">
            {view.strategicMemory.map((memory, index) => (
              <li key={index}>
                <strong>{memory.pattern}</strong>: {memory.content} (
                {memory.support} tasks)
              </li>
            ))}
          </ul>
        ) : null}
        {view.datasets.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Dataset</th>
                  <th scope="col">Examples by partition</th>
                  <th scope="col" className="num">
                    Contaminated, dropped
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.datasets.map((dataset) => (
                  <tr key={dataset.id}>
                    <td>
                      {dataset.datasetId} v{dataset.version}
                    </td>
                    <td className="lab-muted">
                      {Object.entries(dataset.counts)
                        .map(([partition, count]) => `${partition} ${count}`)
                        .join(" · ") || "empty"}
                    </td>
                    <td className="num">{dataset.contaminated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section id="models" title="Models and training">
        <p className="notice notice-info">
          {view.training.available
            ? "A training provider is available."
            : view.training.reason}
        </p>
        {view.models.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Capability</th>
                  <th scope="col" className="num">
                    Verified
                  </th>
                  <th scope="col">Champion here</th>
                </tr>
              </thead>
              <tbody>
                {view.models.map((row) => (
                  <tr key={`${row.modelId}-${row.capabilityId}`}>
                    <td>
                      <code>{row.modelId}</code>
                    </td>
                    <td>{row.capabilityId}</td>
                    <td className="num">
                      {row.verified}/{row.trials}
                    </td>
                    <td>{row.champion ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section id="promotions" title="Promotions and rollbacks">
        {view.promotions.length ? (
          <ul className="lab-list">
            {view.promotions.map((event, index) => (
              <li key={index}>
                {humanize(event.from)} → {humanize(event.to)}
                {event.canaryPercent !== null
                  ? ` (${event.canaryPercent}%)`
                  : ""}
                {event.reason ? ` · ${event.reason}` : ""}
                {event.at ? (
                  <>
                    {" "}
                    · <RelativeTime value={event.at} />
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing promoted yet" />
        )}
      </Section>
    </div>
  );
}
