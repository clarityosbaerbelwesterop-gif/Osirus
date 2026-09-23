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
    "That does not look like a GitHub token. Fine-grained tokens start with github_pat_.",
  github_rejected_token:
    "GitHub did not accept this token. Check that it has not expired.",
  connector_key_not_configured:
    "Connections are not set up on this deployment yet.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
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
    setError(ERRORS[body?.error ?? ""] ?? "GitHub could not be connected.");
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
        label="Fine-grained personal access token"
        hint={
          <>
            Create one at github.com → Settings → Developer settings →
            Fine-grained tokens. Choose only the repositories Osirus should see.
            Contents: read (and write, if Osirus may push).
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
          Allow pushing branches and opening pull requests. Each push still
          waits for your approval.
        </span>
      </label>
      <div className="row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || token.trim().length < 20}
        >
          {busy ? "Connecting…" : "Connect GitHub"}
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
    if (!response?.ok) setMessage("The check could not be run.");
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
      name="GitHub repositories"
      stateLabel={stateInfo.label}
      stateTone={stateInfo.tone}
      identity={data.login ? `Acting as ${data.login}` : undefined}
      description={
        <p>
          Separate from signing in with GitHub: signing in proves who you are
          and gives Osirus nothing. This connection lets Osirus clone your
          repositories and, if you allow it, push branches and open pull
          requests — each push only after you approve it.
        </p>
      }
      capabilities={
        data.status === "CONNECTED"
          ? [
              "Read repositories",
              writable
                ? "Push branches and open pull requests (asks every time)"
                : "No write access",
            ]
          : ["Read repositories", "Push and open pull requests (optional)"]
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
              ? "Set OSIRUS_CONNECTOR_KEY for this deployment to enable connections."
              : "Connections are not set up on this deployment yet."}
          </p>
        ) : data.status === "NOT_CONNECTED" ? (
          formOpen ? null : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setFormOpen(true)}
            >
              Connect GitHub
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
              {busy === "check" ? "Checking…" : "Check now"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setFormOpen((open) => !open)}
              aria-expanded={formOpen}
            >
              {state === "EXPIRED" ? "Reconnect" : "Change access"}
            </button>
            <ConfirmDialog
              trigger={
                <button
                  type="button"
                  className="btn btn-danger-quiet btn-sm"
                  disabled={busy !== null}
                >
                  <Unplug size={14} aria-hidden="true" />
                  Disconnect
                </button>
              }
              title="Disconnect GitHub?"
              description="Osirus deletes the stored token and can no longer read or push to your repositories. Running tasks that need GitHub will stop at that step."
              confirmLabel="Disconnect"
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
