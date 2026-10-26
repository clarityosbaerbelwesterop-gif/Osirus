"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { useState } from "react";

type Share =
  { shared: false } | { shared: true; url: string; sharedAt: string };

const timeDe = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Share a chat as a read-only link: a snapshot up to now. Sharing again
 * updates the snapshot; turning it off ends the link at once.
 */
export function ShareDialog({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const endpoint = `/api/chat/threads/${sessionId}/share`;

  const call = async (method: "GET" | "POST" | "DELETE") => {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method,
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as Share | null;
      if (!response.ok || !body) throw new Error(String(response.status));
      setShare(body);
      return body;
    } catch {
      setError("Das hat nicht geklappt. Bitte erneut versuchen.");
      return null;
    } finally {
      setPending(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Kopieren nicht möglich. Bitte den Link markieren.");
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setShare(null);
          setCopied(false);
          void call("GET");
        }
      }}
    >
      <Dialog.Trigger
        className="ac-share-trigger"
        aria-label="Chat teilen"
        title="Chat teilen"
      >
        <Share2 size={16} aria-hidden="true" />
        <span>Teilen</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="overlay" />
        <Dialog.Popup className="dialog share-dialog">
          <Dialog.Title className="dialog-title">Chat teilen</Dialog.Title>
          <Dialog.Description className="dialog-description">
            Wer den Link hat, kann diesen Chat lesen, so wie er beim Teilen war.
            Spätere Nachrichten, Dateien und Denkschritte bleiben privat.
          </Dialog.Description>
          {share?.shared ? (
            <div className="share-link">
              <label className="share-url">
                <Link2 size={14} aria-hidden="true" />
                <input
                  readOnly
                  value={share.url}
                  aria-label="Link zum geteilten Chat"
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
              <p className="share-meta">Stand {timeDe(share.sharedAt)}.</p>
            </div>
          ) : null}
          <p className="share-error" role="status" aria-live="polite">
            {error ?? ""}
          </p>
          <div className="dialog-actions">
            {share?.shared ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={pending}
                  onClick={() => void call("DELETE")}
                >
                  Link deaktivieren
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pending}
                  onClick={() => void call("POST")}
                >
                  Auf aktuellen Stand bringen
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void copy(share.url)}
                >
                  {copied ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <Copy size={14} aria-hidden="true" />
                  )}
                  {copied ? "Kopiert" : "Link kopieren"}
                </button>
              </>
            ) : (
              <>
                <Dialog.Close className="btn btn-secondary">
                  Abbrechen
                </Dialog.Close>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending}
                  onClick={async () => {
                    const created = await call("POST");
                    if (created?.shared) void copy(created.url);
                  }}
                >
                  {pending ? "Erstellt…" : "Link erstellen und kopieren"}
                </button>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
