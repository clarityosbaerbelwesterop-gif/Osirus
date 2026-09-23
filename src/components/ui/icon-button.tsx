"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cx } from "./cx";

/**
 * An icon-only button. The label is required: it is the accessible name and
 * the tooltip text, so the control is never unlabeled for anyone.
 */
export function IconButton({
  label,
  icon: Icon,
  size = "md",
  tone,
  tooltip = true,
  className,
  type = "button",
  ...rest
}: {
  label: string;
  icon: LucideIcon;
  size?: "sm" | "md";
  tone?: "primary";
  tooltip?: boolean;
} & Omit<ComponentProps<"button">, "aria-label" | "children">) {
  const button = (
    <button
      type={type}
      aria-label={label}
      className={cx(
        "icon-btn",
        size === "sm" && "icon-btn-sm",
        tone === "primary" && "icon-btn-primary",
        className,
      )}
      {...rest}
    >
      <Icon size={size === "sm" ? 15 : 17} aria-hidden="true" />
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={button} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className="tooltip">{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
