import type { RoleStatus } from "@/lib/product/model-status";
import { type Tone } from "@/lib/ui/labels";
import { Badge } from "../ui/badge";
import { RelativeTime } from "../ui/relative-time";

const TONE: Record<RoleStatus["state"], { label: string; tone: Tone }> = {
  available: { label: "Available", tone: "success" },
  busy: { label: "Busy", tone: "warning" },
  unavailable: { label: "Temporarily unavailable", tone: "danger" },
  quota_exhausted: { label: "Quota exhausted", tone: "warning" },
  configuration_error: { label: "Configuration problem", tone: "danger" },
  not_used: { label: "No recent use", tone: "neutral" },
  not_configured: { label: "Not configured", tone: "neutral" },
};

const CATEGORY: Record<string, string> = {
  insufficient_credit: "Provider declined: no credit or quota",
  provider_unavailable: "Provider unavailable (5xx or upstream failure)",
  credential_rejected: "Provider rejected the credentials",
  rate_limited: "Rate limited",
  capacity_deferred: "Deferred to keep capacity for user requests",
  timeout: "Timed out",
  model_not_configured: "Model role not configured",
  invalid_json: "Unusable response (invalid JSON)",
  invalid_stream: "Unusable response (stream)",
  decision_failed: "Response did not match the expected structure",
  structured_call_failed: "Response did not match the expected structure",
  model_call_failed: "Call failed",
};

export function ModelStatusTable({ roles }: { roles: RoleStatus[] }) {
  const admin = roles.some((role) => role.admin);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Calls (24h)
            </th>
            <th scope="col">Last used</th>
            {admin ? <th scope="col">Diagnostics (admin)</th> : null}
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
                    <div className="subtle">{role.failures24h} failed</div>
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
                        <div>
                          {role.admin.provider} ·{" "}
                          <span className="mono">
                            {role.admin.modelId ?? "not set"}
                          </span>
                          {role.admin.sharesStrong
                            ? " (uses the strong model)"
                            : ""}
                        </div>
                        {role.admin.failureCategory ? (
                          <div>
                            Last failure:{" "}
                            {CATEGORY[role.admin.failureCategory] ??
                              role.admin.failureCategory}
                            {role.admin.lastFailureAt ? (
                              <>
                                ,{" "}
                                <RelativeTime
                                  value={role.admin.lastFailureAt}
                                />
                              </>
                            ) : (
                              ""
                            )}
                          </div>
                        ) : null}
                        {role.admin.lastFailureSummary ? (
                          <div className="mono">
                            {role.admin.lastFailureSummary}
                          </div>
                        ) : null}
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
