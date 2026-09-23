"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./icon-button";

/**
 * A side sheet built on Base UI Dialog: focus is trapped while open, Escape
 * and the backdrop close it, and focus returns to the trigger.
 */
export function Sheet({
  open,
  onOpenChange,
  side,
  title,
  children,
  headerActions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  title: string;
  children: ReactNode;
  headerActions?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="overlay" />
        <Dialog.Popup className={`sheet sheet-${side}`}>
          <div className="sheet-header">
            <Dialog.Title className="sheet-title">{title}</Dialog.Title>
            <div className="row">
              {headerActions}
              <Dialog.Close
                render={<IconButton label="Close" icon={X} tooltip={false} />}
              />
            </div>
          </div>
          <div className="sheet-body">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
