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
import { relativeTime } from "@/lib/ui/labels";
import { Badge } from "../ui/badge";

const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  prompt_injection_neutralized: {
    label: "Injection neutralized",
    icon: ShieldAlert,
  },
  unsafe_path_blocked: { label: "Unsafe path blocked", icon: FolderX },
  access_refused: { label: "Access refused", icon: Ban },
  secret_redacted: { label: "Secret redacted", icon: EyeOff },
  tool_denied: { label: "Tool call refused", icon: Ban },
  approval_expired: { label: "Approval expired", icon: Clock },
  outbound_blocked: { label: "Request blocked", icon: Globe },
  policy_denied: { label: "Blocked by policy", icon: Ban },
};

export function SecurityEventList({ events }: { events: SecurityEventView[] }) {
  if (!events.length)
    return (
      <div className="notice">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>No security events recorded in this workspace.</span>
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
                  {relativeTime(event.createdAt)}
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
                {event.severity}
              </Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
