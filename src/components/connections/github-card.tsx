"use client";

import { RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  githubState,
  healthLine,
  STATE_LABEL,
} from "@/lib/ui/connection-state";
import { GithubMark } from "../auth/github-mark";
import { useShell } from "../shell/shell-context";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Field } from "../ui/field";
import { ConnectionCard } from "./connection-card";

export type GithubCardData = {
  status: "CONNECTED" | "NOT_CONNECTED" | "NOT_CONFIGURED";
  login: string | null;
  scopes: string[];
  connectedAt: string | null;
  health: {
    last: {
      ok: boolean;
      latencyMs: number | null;
      error: string | null;
      checkedAt: string;
    } | null;
    lastOkAt: string | null;
  } | null;
  lastToolCallAt: string | null;
};

const ERRORS: Record<string, string> = {
  token_malformed:
    "Das sieht nicht nach einem GitHub-Token aus. Fine-grained Tokens beginnen mit github_pat_.",
  github_rejected_token:
    "GitHub hat dieses Token nicht akzeptiert. Prüfe, ob es abgelaufen ist.",
  connector_key_not_configured:
    "Verbindungen sind in dieser Installation noch nicht eingerichtet.",
  rate_limited: "Zu viele Versuche. Warte eine Minute und versuch es erneut.",
};

function ConnectForm({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  const [allowWrite, setAllowWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/connectors/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: token.trim(), allowWrite }),
    }).catch(() => null);
    setToken("");
    setBusy(false);
    if (response?.ok) return onDone();
    const body = (await response?.json().catch(() => ({}))) as {
      error?: string;
    };
    setError(
      ERRORS[body?.error ?? ""] ?? "GitHub konnte nicht verbunden werden.",
    );
  };

  return (
    <form
      className="conn-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field
        label="Fine-grained Personal Access Token"
        hint={
          <>
            Erstelle eines unter github.com → Settings → Developer settings →
            Fine-grained tokens. Wähle nur die Repositories, die Osirus sehen
            soll. Contents: read (und write, falls Osirus pushen darf).
          </>
        }
        error={error}
      >
        {(props) => (
          <input
            {...props}
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        )}
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={allowWrite}
          onChange={(event) => setAllowWrite(event.target.checked)}
        />
        <span>
          Pushen von Branches und Öffnen von Pull Requests erlauben. Jeder Push
          wartet trotzdem auf deine Freigabe.
        </span>
      </label>
      <div className="row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || token.trim().length < 20}
        >
          {busy ? "Verbindet…" : "GitHub verbinden"}
        </button>
      </div>
    </form>
  );
}

export function GithubCard({ data }: { data: GithubCardData }) {
  const router = useRouter();
  const shell = useShell();
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<"check" | "disconnect" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const state = githubState(data.status, data.health);
  const stateInfo = STATE_LABEL[state];
  const health = data.status === "CONNECTED" ? healthLine(data.health) : null;

  const check = async () => {
    setBusy("check");
    setMessage(null);
    const response = await fetch("/api/connections/github/check", {
      method: "POST",
    }).catch(() => null);
    setBusy(null);
    if (!response?.ok)
      setMessage("Die Prüfung konnte nicht ausgeführt werden.");
    router.refresh();
  };

  const disconnect = async () => {
    setBusy("disconnect");
    await fetch("/api/connectors/github", { method: "DELETE" }).catch(
      () => null,
    );
    setBusy(null);
    router.refresh();
  };

  const writable = data.scopes.includes("repo:write");

  return (
    <ConnectionCard
      icon={<GithubMark size={20} />}
      name="GitHub-Repositories"
      stateLabel={stateInfo.label}
      stateTone={stateInfo.tone}
      identity={data.login ? `Handelt als ${data.login}` : undefined}
      description={
        <p>
          Getrennt von der Anmeldung mit GitHub: Die Anmeldung zeigt, wer du
          bist, und gibt Osirus keinen Zugriff. Mit dieser Verbindung kann
          Osirus deine Repositories klonen und, wenn du es erlaubst, Branches
          pushen und Pull Requests öffnen — jeden Push erst nach deiner
          Freigabe.
        </p>
      }
      capabilities={
        data.status === "CONNECTED"
          ? [
              "Repositories lesen",
              writable
                ? "Branches pushen und Pull Requests öffnen (fragt jedes Mal)"
                : "Kein Schreibzugriff",
            ]
          : ["Repositories lesen", "Pushen und Pull Requests öffnen (optional)"]
      }
      health={
        health
          ? {
              healthLabel: health.label,
              healthTone: health.tone,
              lastCheckedAt: data.health?.last?.checkedAt ?? null,
              latencyMs: data.health?.last?.latencyMs ?? null,
              lastOkAt: data.health?.lastOkAt ?? null,
              lastError: data.health?.last?.ok
                ? null
                : (data.health?.last?.error ?? null),
              lastToolCallAt: data.lastToolCallAt,
            }
          : null
      }
      actions={
        data.status === "NOT_CONFIGURED" ? (
          <p className="subtle">
            {shell.isAdmin
              ? "Setze OSIRUS_CONNECTOR_KEY für diese Installation, um Verbindungen zu aktivieren."
              : "Verbindungen sind in dieser Installation noch nicht eingerichtet."}
          </p>
        ) : data.status === "NOT_CONNECTED" ? (
          formOpen ? null : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setFormOpen(true)}
            >
              GitHub verbinden
            </button>
          )
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void check()}
              disabled={busy !== null}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {busy === "check" ? "Prüft…" : "Jetzt prüfen"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setFormOpen((open) => !open)}
              aria-expanded={formOpen}
            >
              {state === "EXPIRED" ? "Neu verbinden" : "Zugriff ändern"}
            </button>
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  className="btn btn-danger-quiet btn-sm"
                  disabled={busy !== null}
                >
                  <Unplug size={14} aria-hidden="true" />
                  Trennen
                </button>
              }
              title="GitHub trennen?"
              description="Osirus löscht das gespeicherte Token und kann deine Repositories danach weder lesen noch dorthin pushen. Laufende Aufgaben, die GitHub brauchen, halten an diesem Schritt an."
              confirmLabel="Trennen"
              onConfirm={() => void disconnect()}
            />
          </>
        )
      }
    >
      {message ? (
        <p className="field-error" role="alert">
          {message}
        </p>
      ) : null}
      {formOpen && data.status !== "NOT_CONFIGURED" ? (
        <ConnectForm
          onDone={() => {
            setFormOpen(false);
            router.refresh();
          }}
        />
      ) : null}
    </ConnectionCard>
  );
}
