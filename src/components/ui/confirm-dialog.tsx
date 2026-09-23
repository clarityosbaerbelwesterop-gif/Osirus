"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { ReactElement, ReactNode } from "react";

/**
 * Confirmation for destructive or high-risk actions. The trigger is rendered
 * as given; the confirm button carries the consequence in its label.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = "danger",
}: {
  trigger: ReactElement;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  tone?: "danger" | "primary";
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger render={trigger} />
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="overlay" />
        <AlertDialog.Popup className="dialog">
          <AlertDialog.Title className="dialog-title">
            {title}
          </AlertDialog.Title>
          <AlertDialog.Description
            className="dialog-description"
            render={<div />}
          >
            {description}
          </AlertDialog.Description>
          <div className="dialog-actions">
            <AlertDialog.Close className="btn btn-secondary">
              Cancel
            </AlertDialog.Close>
            <AlertDialog.Close
              className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
