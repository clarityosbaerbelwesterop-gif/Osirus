"use client";

import { Cloud, Database, Layers, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  githubState,
  healthLine,
  STATE_LABEL,
} from "@/lib/ui/connection-state";
import { useShell } from "../shell/shell-context";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Field } from "../ui/field";
import { ConnectionCard } from "./connection-card";

export type PlatformCardData = {
  id: "vercel" | "neon" | "supabase";
  name: string;
  status: "CONNECTED" | "NOT_CONNECTED" | "NOT_CONFIGURED";
  account: string | null;
  health: {
    last: {
      ok: boolean;
      latencyMs: number | null;
      error: string | null;
      checkedAt: string;
    } | null;
    lastOkAt: string | null;
  } | null;
};

const INFO: Record<
  PlatformCardData["id"],
  { icon: React.ReactNode; text: string; capability: string; tokenHint: string }
> = {
  vercel: {
    icon: <Cloud size={20} />,
    text: "Lets Osirus see your deployments: which project, which commit, whether it is ready or failed.",
    capability: "List deployments (read only)",
    tokenHint: "Create one at vercel.com → Account Settings → Tokens.",
  },
  neon: {
    icon: <Database size={20} />,
    text: "Lets Osirus see your Neon projects and branches. It runs no query against your databases.",
    capability: "List projects and branches (read only)",
    tokenHint: "Create one at console.neon.tech → Account settings → API keys.",
  },
  supabase: {
    icon: <Layers size={20} />,
    text: "Lets Osirus see your Supabase projects, their region and status.",
    capability: "List projects (read only)",
    tokenHint:
      "Create one at supabase.com/dashboard → Account → Access tokens.",
  },
};

const ERRORS: Record<string, string> = {
  token_rejected: "The provider did not accept this token.",
  not_configured: "Connections are not set up on this deployment yet.",
  provider_unreachable: "The provider could not be reached. Try again.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  not_connected: "This connection is no longer active. Reload the page.",
};

export function PlatformCard({ data }: { data: PlatformCardData }) {
  const router = useRouter();
  const shell = useShell();
  const info = INFO[data.id];
  const [formOpen, setFormOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = githubState(data.status, data.health);
  const stateInfo = STATE_LABEL[state];
  const health = data.status === "CONNECTED" ? healthLine(data.health) : null;
  const base = `/api/connectors/platform/${data.id}`;

  const post = async (body: unknown, key: string) => {
    setBusy(key);
    setError(null);
    const response = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      const result = (await response?.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(ERRORS[result?.error ?? ""] ?? "That did not work.");
      return false;
    }
    router.refresh();
    return true;
  };

  return (
    <ConnectionCard
      icon={info.icon}
      name={data.name}
      stateLabel={stateInfo.label}
      stateTone={stateInfo.tone}
      identity={data.account ? `Account: ${data.account}` : undefined}
      description={<p>{info.text}</p>}
      capabilities={[info.capability]}
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
              lastToolCallAt: null,
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
        ) : data.status === "CONNECTED" ? (
          <div className="row row-wrap">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={busy !== null}
              onClick={() => void post({ action: "check" }, "check")}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {busy === "check" ? "Checking…" : "Check now"}
            </button>
            <ConfirmDialog
              title={`Disconnect ${data.name}?`}
              description="Osirus forgets the token. Runs lose these read tools."
              confirmLabel="Disconnect"
              onConfirm={async () => {
                setBusy("disconnect");
                await fetch(base, { method: "DELETE" }).catch(() => null);
                setBusy(null);
                router.refresh();
              }}
              trigger={
                <button
                  type="button"
                  className="btn btn-sm btn-danger-quiet"
                  disabled={busy !== null}
                >
                  <Unplug size={14} aria-hidden="true" />
                  Disconnect
                </button>
              }
            />
            {error ? <p className="field-error">{error}</p> : null}
          </div>
        ) : formOpen ? (
          <form
            className="conn-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await post({ action: "connect", token }, "connect");
              setToken("");
              if (ok) setFormOpen(false);
            }}
          >
            <Field label="Access token" hint={info.tokenHint} error={error}>
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
            <div className="row">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy !== null || token.trim().length < 20}
              >
                {busy === "connect"
                  ? "Checking the token…"
                  : `Connect ${data.name}`}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setFormOpen(true)}
          >
            Connect {data.name}
          </button>
        )
      }
    />
  );
}
