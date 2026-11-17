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
  {
    icon: React.ReactNode;
    text: string;
    capability: string;
    tokenHint: string;
    /** What to do when the provider refuses the token. */
    rejected: string;
  }
> = {
  vercel: {
    icon: <Cloud size={20} />,
    text: "Osirus sieht deine Deployments: welches Projekt, welcher Commit, ob es bereit oder fehlgeschlagen ist.",
    capability: "Deployments auflisten (nur lesen)",
    tokenHint: "Erstelle eines unter vercel.com → Account Settings → Tokens.",
    rejected:
      "Vercel hat dieses Token nicht akzeptiert. Erstelle unter Account Settings → Tokens ein neues und füge es vollständig ein.",
  },
  neon: {
    icon: <Database size={20} />,
    text: "Osirus sieht deine Neon-Projekte und Branches. Es führt keine Abfrage gegen deine Datenbanken aus.",
    capability: "Projekte und Branches auflisten (nur lesen)",
    tokenHint:
      "Ein Neon API Key (beginnt mit napi_): console.neon.tech → Account settings → API keys oder Settings → API keys deiner Organisation.",
    rejected:
      "Neon hat diesen Key nicht akzeptiert. Füge einen API Key aus Account settings → API keys oder Settings → API keys deiner Organisation ein, kein Datenbankpasswort und keinen Connection String.",
  },
  supabase: {
    icon: <Layers size={20} />,
    text: "Osirus sieht deine Supabase-Projekte, ihre Region und ihren Status.",
    capability: "Projekte auflisten (nur lesen)",
    tokenHint:
      "Ein Personal Access Token (beginnt mit sbp_): supabase.com/dashboard/account/tokens.",
    rejected:
      "Supabase hat dieses Token nicht akzeptiert. Erstelle ein Personal Access Token unter supabase.com/dashboard/account/tokens.",
  },
};

const WRONG_KIND: Record<string, string> = {
  supabase_project_key:
    "Das ist ein Projekt-API-Key (anon, service_role oder sb_-Key). Osirus braucht ein Personal Access Token (beginnt mit sbp_) von supabase.com/dashboard/account/tokens.",
  neon_connection_string:
    "Das ist ein Connection String einer Datenbank. Osirus braucht einen Neon API Key (beginnt mit napi_) aus Account settings → API keys; es verbindet sich nie mit deiner Datenbank.",
};

const ERRORS: Record<string, string> = {
  token_rejected: "Der Anbieter hat dieses Token nicht akzeptiert.",
  not_configured:
    "Verbindungen sind in dieser Installation noch nicht eingerichtet.",
  provider_unreachable:
    "Der Anbieter war nicht erreichbar. Versuch es noch einmal.",
  rate_limited: "Zu viele Versuche. Warte eine Minute und versuch es erneut.",
  not_connected: "Diese Verbindung ist nicht mehr aktiv. Lade die Seite neu.",
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
        kind?: string;
      };
      setError(
        result?.error === "wrong_token_kind"
          ? (WRONG_KIND[result.kind ?? ""] ?? info.rejected)
          : result?.error === "token_rejected"
            ? info.rejected
            : (ERRORS[result?.error ?? ""] ?? "Das hat nicht geklappt."),
      );
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
      identity={data.account ? `Konto: ${data.account}` : undefined}
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
              ? "Setze OSIRUS_CONNECTOR_KEY für diese Installation, um Verbindungen zu aktivieren."
              : "Verbindungen sind in dieser Installation noch nicht eingerichtet."}
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
              {busy === "check" ? "Prüft…" : "Jetzt prüfen"}
            </button>
            <ConfirmDialog
              title={`${data.name} trennen?`}
              description="Osirus vergisst das Token. Läufe verlieren diese Lesewerkzeuge."
              confirmLabel="Trennen"
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
                  Trennen
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
            <Field label="Zugangstoken" hint={info.tokenHint} error={error}>
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
                  ? "Token wird geprüft…"
                  : `${data.name} verbinden`}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFormOpen(false)}
              >
                Abbrechen
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setFormOpen(true)}
          >
            {data.name} verbinden
          </button>
        )
      }
    />
  );
}
