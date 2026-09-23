"use client";

import { useRef } from "react";

export const WORKBENCH_MIN = 340;
export const WORKBENCH_MAX = 640;

const clamp = (value: number) =>
  Math.min(WORKBENCH_MAX, Math.max(WORKBENCH_MIN, value));

/**
 * The window-splitter between chat and workbench: drag with a pointer, or
 * focus it and use the arrow keys (Home/End for the limits).
 */
export function Resizer({
  width,
  onWidth,
}: {
  width: number;
  onWidth: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize run details"
      aria-controls="workbench"
      aria-valuemin={WORKBENCH_MIN}
      aria-valuemax={WORKBENCH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        start.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        onWidth(clamp(start.current.width + (start.current.x - event.clientX)));
      }}
      onPointerUp={(event) => {
        start.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 24;
        if (event.key === "ArrowLeft") onWidth(clamp(width + step));
        else if (event.key === "ArrowRight") onWidth(clamp(width - step));
        else if (event.key === "Home") onWidth(WORKBENCH_MAX);
        else if (event.key === "End") onWidth(WORKBENCH_MIN);
        else return;
        event.preventDefault();
      }}
    />
  );
}
