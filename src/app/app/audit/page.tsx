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
export const metadata: Metadata = { title: "Audit-Log" };

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATUS: Record<
  string,
  { label: string; tone: "success" | "danger" | "warning" | "neutral" }
> = {
  completed: { label: "Ausgeführt", tone: "success" },
  failed: { label: "Fehlgeschlagen", tone: "danger" },
  cancelled: { label: "Abgelehnt", tone: "warning" },
  awaiting_approval: { label: "Wartete auf Freigabe", tone: "neutral" },
};

const REASON: Record<string, string> = {
  policy_denied: "Richtlinie des Arbeitsbereichs",
  arm_not_permitted: "Für diese Aufgabe nicht erlaubt",
  approval_rejected: "Freigabe abgelehnt",
  invalid_input: "Ungültige Eingabe",
  tool_call_failed: "Werkzeugfehler",
};

const RISK_LABEL: Record<string, string> = {
  low: "Gering",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
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
      title="Audit-Log"
      lede="Jeder Werkzeugaufruf, den Osirus in diesem Arbeitsbereich versucht hat, auch die, die es nicht durfte. Eingaben werden nie gespeichert; nur was lief, wann und wie es ausging."
    >
      <form className="filters" method="get" aria-label="Audit-Log filtern">
        <div className="field">
          <label className="field-label" htmlFor="f-tool">
            Werkzeug
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
            Verbindung
          </label>
          <select
            id="f-connector"
            name="connector"
            className="select"
            defaultValue={filters.connector ?? ""}
          >
            <option value="">Alle</option>
            <option value="builtin">Eingebaut</option>
            <option value="github">GitHub</option>
            <option value="mcp">MCP</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-risk">
            Risiko
          </label>
          <select
            id="f-risk"
            name="risk"
            className="select"
            defaultValue={filters.risk ?? ""}
          >
            <option value="">Alle</option>
            <option value="low">Gering</option>
            <option value="medium">Mittel</option>
            <option value="high">Hoch</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-decision">
            Ergebnis
          </label>
          <select
            id="f-decision"
            name="decision"
            className="select"
            defaultValue={filters.decision ?? ""}
          >
            <option value="">Alle</option>
            <option value="completed">Ausgeführt</option>
            <option value="failed">Fehlgeschlagen</option>
            <option value="cancelled">Abgelehnt</option>
            <option value="awaiting_approval">Wartete auf Freigabe</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="f-from">
            Von
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
            Bis
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
            Lauf-ID
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
            Anwenden
          </button>
          <Link href={"/app/audit" as Route} className="btn btn-ghost">
            Zurücksetzen
          </Link>
        </div>
      </form>

      <div className="section">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Werkzeugaufrufe</caption>
              <thead>
                <tr>
                  <th scope="col">Wann</th>
                  <th scope="col">Aktion</th>
                  <th scope="col">Ergebnis</th>
                  <th scope="col">Risiko</th>
                  <th scope="col" className="num">
                    Dauer
                  </th>
                  <th scope="col">Lauf</th>
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
                      <td>{RISK_LABEL[row.risk] ?? row.risk}</td>
                      <td className="num">
                        {formatDuration(row.latencyMs) ?? "—"}
                      </td>
                      <td>
                        {row.sessionId ? (
                          <Link href={`/app?session=${row.sessionId}` as Route}>
                            Öffnen
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
          <EmptyState icon={ScrollText} title="Keine passenden Werkzeugaufrufe">
            Ändere die Filter oder starte eine Aufgabe.
          </EmptyState>
        )}
        {next ? (
          <div>
            <Link
              className="btn btn-secondary"
              href={`/app/audit?${query.toString()}` as Route}
            >
              Ältere Einträge
            </Link>
          </div>
        ) : null}
      </div>
    </PageFrame>
  );
}
