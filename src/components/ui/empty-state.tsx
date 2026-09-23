import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Nothing to show yet, with at most one next action. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {Icon ? (
        <span className="empty-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
      ) : null}
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
