import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/ui/labels";
import { cx } from "./cx";

export function Badge({
  tone = "neutral",
  icon: Icon,
  outline,
  children,
  className,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  outline?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "badge",
        tone !== "neutral" && `badge-${tone}`,
        outline && "badge-outline",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
