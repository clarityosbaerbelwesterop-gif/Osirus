import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CirclePause,
  LoaderCircle,
} from "lucide-react";
import type { StageState } from "@/lib/ui/labels";
import { cx } from "./cx";

/** A stage or step state as an icon; always paired with text by callers. */
export function StatusIcon({
  state,
  size = 16,
}: {
  state: StageState;
  size?: number;
}) {
  const common = { size, "aria-hidden": true as const };
  switch (state) {
    case "done":
      return <CircleCheck {...common} className="tone-success" />;
    case "running":
      return <LoaderCircle {...common} className={cx("tone-accent", "spin")} />;
    case "waiting":
      return <CirclePause {...common} className="tone-warning" />;
    case "failed":
      return <CircleAlert {...common} className="tone-danger" />;
    case "skipped":
      return <CircleMinus {...common} className="tone-muted" />;
    default:
      return <CircleDashed {...common} className="tone-muted" />;
  }
}
