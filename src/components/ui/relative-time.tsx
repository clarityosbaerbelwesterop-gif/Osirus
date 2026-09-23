import { relativeTime } from "@/lib/ui/labels";

/** A relative time ("5m ago"), marked up with the instant it stands for. */
export function RelativeTime({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <time className={className} dateTime={value}>
      {relativeTime(value)}
    </time>
  );
}
