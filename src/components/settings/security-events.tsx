import {
  Ban,
  Clock,
  EyeOff,
  FolderX,
  Globe,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { SecurityEventView } from "@/lib/security/events-read";
import { Badge } from "../ui/badge";
import { RelativeTime } from "../ui/relative-time";

const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  prompt_injection_neutralized: {
    label: "Injection entschärft",
    icon: ShieldAlert,
  },
  unsafe_path_blocked: { label: "Unsicherer Pfad blockiert", icon: FolderX },
  access_refused: { label: "Zugriff verweigert", icon: Ban },
  secret_redacted: { label: "Geheimnis geschwärzt", icon: EyeOff },
  tool_denied: { label: "Werkzeugaufruf abgelehnt", icon: Ban },
  approval_expired: { label: "Freigabe abgelaufen", icon: Clock },
  outbound_blocked: { label: "Anfrage blockiert", icon: Globe },
  policy_denied: { label: "Durch Richtlinie blockiert", icon: Ban },
};

const SEVERITY_LABEL: Record<string, string> = {
  info: "Info",
  warning: "Warnung",
  critical: "Kritisch",
};

export function SecurityEventList({ events }: { events: SecurityEventView[] }) {
  if (!events.length)
    return (
      <div className="notice">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          In diesem Arbeitsbereich sind keine Sicherheitsereignisse erfasst.
        </span>
      </div>
    );
  return (
    <ul className="item-list">
      {events.map((event) => {
        const info = KIND[event.kind] ?? {
          label: event.kind,
          icon: ShieldAlert,
        };
        return (
          <li key={event.id} className="item">
            <info.icon
              size={16}
              aria-hidden="true"
              className={
                event.severity === "critical"
                  ? "tone-danger"
                  : event.severity === "warning"
                    ? "tone-warning"
                    : "tone-muted"
              }
            />
            <div className="item-body">
              <p className="item-title">{info.label}</p>
              <p className="wrap-anywhere">{event.summary}</p>
              <p className="item-meta">
                <time dateTime={event.createdAt}>
                  <RelativeTime value={event.createdAt} />
                </time>
              </p>
            </div>
            <div className="item-side">
              <Badge
                tone={
                  event.severity === "critical"
                    ? "danger"
                    : event.severity === "warning"
                      ? "warning"
                      : "neutral"
                }
              >
                {SEVERITY_LABEL[event.severity] ?? event.severity}
              </Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
