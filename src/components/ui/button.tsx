import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-quiet";
type Size = "sm" | "md" | "lg";

type Common = {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  iconEnd?: LucideIcon;
  block?: boolean;
  children?: ReactNode;
};

function classes(
  variant: Variant,
  size: Size,
  block?: boolean,
  extra?: string,
) {
  return cx(
    "btn",
    `btn-${variant}`,
    size !== "md" && `btn-${size}`,
    block && "btn-block",
    extra,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconEnd: IconEnd,
  block,
  className,
  children,
  type = "button",
  ...rest
}: Common & Omit<ComponentProps<"button">, "children">) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <button
      type={type}
      className={classes(variant, size, block, className)}
      {...rest}
    >
      {Icon ? <Icon size={iconSize} aria-hidden="true" /> : null}
      {children}
      {IconEnd ? <IconEnd size={iconSize} aria-hidden="true" /> : null}
    </button>
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  icon: Icon,
  iconEnd: IconEnd,
  block,
  className,
  children,
  ...rest
}: Common & Omit<ComponentProps<typeof Link>, "children">) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <Link className={classes(variant, size, block, className)} {...rest}>
      {Icon ? <Icon size={iconSize} aria-hidden="true" /> : null}
      {children}
      {IconEnd ? <IconEnd size={iconSize} aria-hidden="true" /> : null}
    </Link>
  );
}
