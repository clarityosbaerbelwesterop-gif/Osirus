import type { RoleStatus } from "@/lib/product/model-status";
import { type Tone } from "@/lib/ui/labels";
import { Badge } from "../ui/badge";
import { RelativeTime } from "../ui/relative-time";

const TONE: Record<RoleStatus["state"], { label: string; tone: Tone }> = {
  available: { label: "Verfügbar", tone: "success" },
  busy: { label: "Ausgelastet", tone: "warning" },
  unavailable: { label: "Vorübergehend nicht verfügbar", tone: "danger" },
  quota_exhausted: { label: "Kontingent aufgebraucht", tone: "warning" },
  configuration_error: { label: "Konfigurationsproblem", tone: "danger" },
  not_used: { label: "Zuletzt nicht genutzt", tone: "neutral" },
  not_configured: { label: "Nicht eingerichtet", tone: "neutral" },
};

const CATEGORY: Record<string, string> = {
  insufficient_credit: "Anbieter hat abgelehnt: kein Guthaben oder Kontingent",
  provider_unavailable: "Anbieter nicht erreichbar (5xx oder Upstream-Fehler)",
  credential_rejected: "Anbieter hat die Zugangsdaten abgelehnt",
  rate_limited: "Gedrosselt",
  capacity_deferred:
    "Zurückgestellt, um Kapazität für direkte Anfragen zu halten",
  timeout: "Zeitüberschreitung",
  model_not_configured: "Modellrolle nicht eingerichtet",
  invalid_json: "Unbrauchbare Antwort (ungültiges JSON)",
  invalid_stream: "Unbrauchbare Antwort (Stream)",
  decision_failed: "Antwort passte nicht zur erwarteten Struktur",
  structured_call_failed: "Antwort passte nicht zur erwarteten Struktur",
  model_call_failed: "Aufruf fehlgeschlagen",
};

export function ModelStatusTable({ roles }: { roles: RoleStatus[] }) {
  const admin = roles.some((role) => role.admin);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Rolle</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Aufrufe (24 Std.)
            </th>
            <th scope="col">Zuletzt genutzt</th>
            {admin ? <th scope="col">Diagnose (Admin)</th> : null}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => {
            const tone = TONE[role.state];
            return (
              <tr key={role.role}>
                <td>{role.label}</td>
                <td>
                  <Badge tone={tone.tone}>{tone.label}</Badge>
                  <div className="subtle">{role.message}</div>
                </td>
                <td className="num">
                  {role.calls24h}
                  {role.failures24h ? (
                    <div className="subtle">
                      {role.failures24h} fehlgeschlagen
                    </div>
                  ) : null}
                </td>
                <td className="tabular">
                  {role.lastCallAt ? (
                    <RelativeTime value={role.lastCallAt} />
                  ) : (
                    "—"
                  )}
                </td>
                {admin ? (
                  <td>
                    {role.admin ? (
                      <div className="subtle">
                        {role.admin.failureCategory ? (
                          <div>
                            Letzter Fehler:{" "}
                            {CATEGORY[role.admin.failureCategory] ??
                              "Der Anbieter hat die Anfrage abgelehnt."}
                            {role.admin.lastFailureAt ? (
                              <>
                                ,{" "}
                                <RelativeTime
                                  value={role.admin.lastFailureAt}
                                />
                              </>
                            ) : null}
                          </div>
                        ) : (
                          <div>Kein Fehler in den letzten 24 Stunden.</div>
                        )}
                      </div>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
