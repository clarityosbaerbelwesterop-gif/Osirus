import type { Metadata, Route } from "next";
import Link from "next/link";
import { ScrollText } from "lucide-react";
import { PageFrame } from "@/components/shell/page-frame";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { listToolCalls, type AuditFilters } from "@/lib/product/approvals";
import { requireProductSession } from "@/lib/product/session";
import { formatDuration, relativeTime, toolLabel } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit log" };

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS: Record<
  string,
  { label: string; tone: "success" | "danger" | "warning" | "neutral" }
> = {
  completed: { label: "Ran", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Refused", tone: "warning" },
  awaiting_approval: { label: "Waited for approval", tone: "neutral" },
};

const REASON: Record<string, string> = {
  policy_denied: "Workspace policy",
  arm_not_permitted: "Not allowed for this task",
  approval_rejected: "Approval rejected",
  invalid_input: "Invalid input",
  tool_call_failed: "Tool error",
};

function pick<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
) {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { identity } = await requireProductSession();
  const params = await searchParams;
  const filters: AuditFilters = {
    run: params.run && UUID.test(params.run) ? params.run : null,
    tool: params.tool ? params.tool.slice(0, 80) : null,
    connector: pick(params.connector, ["github", "mcp", "builtin"] as const),
    risk: pick(params.risk, ["low", "medium", "high"] as const),
    decision: pick(params.decision, [
      "completed",
      "failed",
      "cancelled",
      "awaiting_approval",
    ] as const),
    from: params.from && DATE.test(params.from) ? params.from : null,
    to: params.to && DATE.test(params.to) ? params.to : null,
    before:
      params.before && !Number.isNaN(Date.parse(params.before))
        ? params.before
        : null,
  };
  const rows = await listToolCalls(identity, filters, 50);
  const next = rows.length === 50 ? rows.at(-1)?.createdAt : null;
  const query = new URLSearchParams(
    Object.entries({ ...params, before: next ?? undefined }).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1] !== "",
    ),
  );

  return (
    <PageFrame
      title="Audit log"
      lede="Every tool call Osirus attempted in this workspace, including the ones it was not allowed to make. Inputs are never stored; only what ran, when and how it went."
    >
      <form className="filters" method="get" aria-label="Filter the audit log">
        <div className="field">
          <label className="field-label" htmlFor="f-tool">
            Tool
          </label>
          <input
            id="f-tool"
            name="tool"
            className="input"
            defaultValue={filters.tool ?? ""}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-connector">
            Connection
          </label>
          <select
            id="f-connector"
            name="connector"
            className="select"
            defaultValue={filters.connector ?? ""}
          >
            <option value="">Any</option>
            <option value="builtin">Built-in</option>
            <option value="github">GitHub</option>
            <option value="mcp">MCP</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-risk">
            Risk
          </label>
          <select
            id="f-risk"
            name="risk"
            className="select"
            defaultValue={filters.risk ?? ""}
          >
            <option value="">Any</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-decision">
            Outcome
          </label>
          <select
            id="f-decision"
            name="decision"
            className="select"
            defaultValue={filters.decision ?? ""}
          >
            <option value="">Any</option>
            <option value="completed">Ran</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Refused</option>
            <option value="awaiting_approval">Waited for approval</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-from">
            From
          </label>
          <input
            id="f-from"
            name="from"
            type="date"
            className="input"
            defaultValue={filters.from ?? ""}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-to">
            To
          </label>
          <input
            id="f-to"
            name="to"
            type="date"
            className="input"
            defaultValue={filters.to ?? ""}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-run">
            Run id
          </label>
          <input
            id="f-run"
            name="run"
            className="input mono"
            defaultValue={filters.run ?? ""}
          />
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary">
            Apply
          </button>
          <Link href={"/app/audit" as Route} className="btn btn-ghost">
            Reset
          </Link>
        </div>
      </form>

      <div className="section">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Tool calls</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Risk</th>
                  <th scope="col" className="num">
                    Time
                  </th>
                  <th scope="col">Run</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = STATUS[row.status] ?? {
                    label: row.status,
                    tone: "neutral" as const,
                  };
                  return (
                    <tr key={row.id}>
                      <td className="tabular">
                        <time dateTime={row.createdAt}>
                          {relativeTime(row.createdAt)}
                        </time>
                      </td>
                      <td>
                        <div>{toolLabel(row.tool)}</div>
                        <div className="subtle mono">{row.tool}</div>
                      </td>
                      <td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        {row.errorCode && REASON[row.errorCode] ? (
                          <div className="subtle">{REASON[row.errorCode]}</div>
                        ) : null}
                      </td>
                      <td>{row.risk}</td>
                      <td className="num">
                        {formatDuration(row.latencyMs) ?? "—"}
                      </td>
                      <td>
                        {row.sessionId ? (
                          <Link href={`/app?session=${row.sessionId}` as Route}>
                            Open
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ScrollText} title="No tool calls match">
            Change the filters, or start a task.
          </EmptyState>
        )}
        {next ? (
          <div>
            <Link
              className="btn btn-secondary"
              href={`/app/audit?${query.toString()}` as Route}
            >
              Older entries
            </Link>
          </div>
        ) : null}
      </div>
    </PageFrame>
  );
}
