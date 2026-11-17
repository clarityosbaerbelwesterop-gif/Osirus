"use client";

import {
  ChevronRight,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { McpServerView } from "@/lib/connectors/mcp-types";
import { mcpState, STATE_LABEL } from "@/lib/ui/connection-state";
import { Badge } from "../ui/badge";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { EmptyState } from "../ui/empty-state";
import { Field } from "../ui/field";
import { ConnectionCard } from "./connection-card";

// The MCP manager: add a server, test it, review what it offers, and choose
// which tools Osirus may use. Descriptions come from the server and are shown
// as untrusted. Every MCP tool is high risk and asks before each call; the
// server has no say in that.

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const payload = (await response?.json().catch(() => ({}))) as {
    error?: string;
    result?: { ok: boolean; error?: string; toolCount?: number };
  };
  return { ok: Boolean(response?.ok), status: response?.status ?? 0, payload };
}

const ADD_ERRORS: Record<string, string> = {
  invalid_request: "Gib einen Namen und eine https://-URL ein.",
  duplicate_name: "Ein Server mit diesem Namen existiert bereits.",
  not_https: "Die URL muss mit https:// beginnen.",
  private_host: "Osirus kann keine lokalen oder internen Hosts erreichen.",
  private_address: "Osirus kann keine privaten Netzwerkadressen erreichen.",
  credentials_in_url: "Zugangsdaten gehören ins Token-Feld, nicht in die URL.",
  invalid_url: "Das ist keine gültige URL.",
  port_not_allowed: "Dieser Port ist nicht erlaubt.",
  connector_key_not_configured:
    "Verbindungen sind in dieser Installation noch nicht eingerichtet.",
};

type RegistryResult = {
  name: string;
  title: string | null;
  description: string;
  remoteUrl: string | null;
  localOnly: boolean;
};

/**
 * Well-known remote MCP servers. One click fills the form; "Add and test"
 * still checks the server and lists its tools for review.
 */
const QUICK_START = [
  {
    name: "GitHub",
    url: "https://api.githubcopilot.com/mcp/",
    token: "GitHub Personal Access Token",
  },
  {
    name: "Neon",
    url: "https://mcp.neon.tech/mcp",
    token: "Neon API Key",
  },
  {
    name: "Cloudflare Docs",
    url: "https://docs.mcp.cloudflare.com/mcp",
    token: null,
  },
  {
    name: "Context7 (Docs)",
    url: "https://mcp.context7.com/mcp",
    token: null,
  },
  {
    name: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    token: null,
  },
  // Official vendor endpoints as listed in the MCP Registry
  // (com.stripe/mcp, co.huggingface/hf-mcp-server, com.supabase/mcp,
  // app.linear/linear, ai.exa/exa). Servers that only offer OAuth sign-in
  // (Notion, Sentry) are left out: Osirus connects by token.
  {
    name: "Stripe",
    url: "https://mcp.stripe.com",
    token: "Stripe Restricted Key (rk_…)",
  },
  {
    name: "Hugging Face",
    url: "https://huggingface.co/mcp",
    token: "Hugging Face Token (hf_…), optional",
  },
  {
    name: "Supabase",
    url: "https://mcp.supabase.com/mcp",
    token: "Supabase Personal Access Token",
  },
  {
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    token: "Linear API Key",
  },
  {
    name: "Exa (Websuche)",
    url: "https://mcp.exa.ai/mcp",
    token: null,
  },
] as const;

function AddServerForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<RegistryResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [tokenHint, setTokenHint] = useState<string | null>(null);

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    const response = await fetch(
      `/api/mcp/registry?q=${encodeURIComponent(query.trim())}`,
    ).catch(() => null);
    setSearching(false);
    const body = (await response?.json().catch(() => ({}))) as {
      servers?: RegistryResult[];
    };
    if (!response?.ok || !body.servers) {
      setSearchError("Die MCP Registry konnte gerade nicht durchsucht werden.");
      return;
    }
    setResults(body.servers);
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await send("/api/mcp/servers", "POST", {
      name: name.trim(),
      url: url.trim(),
      token: token.trim() || null,
    });
    setBusy(false);
    // The token leaves the page once it is stored; after a refused add
    // (a typo in the URL) it stays, so the person corrects one field
    // instead of pasting the secret again.
    if (result.ok) {
      setToken("");
      return onDone();
    }
    setError(
      ADD_ERRORS[result.payload.error ?? ""] ??
        "Der Server konnte nicht hinzugefügt werden.",
    );
  };

  return (
    <form
      className="conn-form card card-pad"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="notice notice-warning">
        <ShieldAlert size={16} aria-hidden="true" />
        <span>
          Ein MCP-Server kann Werkzeuge anbieten, die außerhalb von Osirus
          wirken. Füge nur Server hinzu, denen du vertraust. Osirus behandelt
          jedes Werkzeug als hohes Risiko und fragt dich vor jedem Aufruf, egal
          was der Server über sich sagt.
        </span>
      </div>
      <div className="stack">
        <div>
          <p className="field-label">Schnellstart</p>
          <div className="row row-wrap" aria-label="Bekannte MCP-Server">
            {QUICK_START.map((server) => (
              <button
                key={server.name}
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setName(server.name);
                  setUrl(server.url);
                  setTokenHint(server.token);
                }}
              >
                {server.name}
              </button>
            ))}
          </div>
          <p className="subtle">
            Vercel und Supabase verbindest du unten per Token, GitHub für Code
            über die GitHub-Verbindung.
          </p>
        </div>
        <div className="row row-wrap">
          <Field
            label="In der MCP Registry suchen"
            hint="Die offizielle Registry. Hier lassen sich nur Server mit Remote-Endpunkt hinzufügen."
          >
            {(props) => (
              <input
                {...props}
                className="input"
                type="search"
                value={query}
                placeholder="github, sentry, context7…"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (query.trim().length >= 2) void search();
                  }
                }}
              />
            )}
          </Field>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={searching || query.trim().length < 2}
            onClick={() => void search()}
          >
            {searching ? "Sucht…" : "Suchen"}
          </button>
        </div>
        {searchError ? <p className="field-error">{searchError}</p> : null}
        {results ? (
          results.length ? (
            <ul className="tool-list" aria-label="Ergebnisse aus der Registry">
              {results.map((server) => (
                <li key={server.name} className="tool-item">
                  <div className="tool-main">
                    <p className="tool-name mono">
                      {server.title ?? server.name}
                    </p>
                    <p className="tool-desc">
                      <span>{server.description || "Keine Beschreibung."}</span>
                    </p>
                    <p className="subtle wrap-anywhere">
                      {server.remoteUrl ??
                        (server.localOnly
                          ? "Läuft nur lokal (stdio); kann hier nicht hinzugefügt werden."
                          : "Kein Remote-Endpunkt veröffentlicht.")}
                    </p>
                  </div>
                  {server.remoteUrl ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => {
                        setName((server.title ?? server.name).slice(0, 80));
                        setUrl(server.remoteUrl!);
                      }}
                    >
                      Übernehmen
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle">Nichts in der Registry passt.</p>
          )
        ) : null}
      </div>
      <Field label="Name" hint="So erscheint dieser Server in Freigaben.">
        {(props) => (
          <input
            {...props}
            className="input"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <Field label="Server-URL" hint="Streamable-HTTP-Endpunkt, nur https.">
        {(props) => (
          <input
            {...props}
            className="input mono"
            type="url"
            inputMode="url"
            placeholder="https://example.com/mcp"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
      </Field>
      <Field
        label={tokenHint ? `${tokenHint}` : "Bearer-Token (optional)"}
        hint="Wird verschlüsselt gespeichert. Nie wieder angezeigt und nie an das Modell gegeben."
        error={error}
      >
        {(props) => (
          <input
            {...props}
            className="input mono"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        )}
      </Field>
      <div className="row">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !name.trim() || !url.trim()}
        >
          {busy ? "Wird hinzugefügt und getestet…" : "Hinzufügen und testen"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function ServerCard({ server }: { server: McpServerView }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const state = mcpState(server);
  const stateInfo = server.enabled
    ? STATE_LABEL[state]
    : { label: "Deaktiviert", tone: "neutral" as const };
  const base = `/api/mcp/servers/${server.id}`;

  const run = async (key: string, action: () => Promise<{ ok: boolean }>) => {
    setBusy(key);
    setMessage(null);
    const result = await action();
    setBusy(null);
    if (!result.ok)
      setMessage("Das hat nicht geklappt. Versuch es noch einmal.");
    router.refresh();
  };

  return (
    <ConnectionCard
      icon={<Server size={20} />}
      name={server.name}
      stateLabel={stateInfo.label}
      stateTone={stateInfo.tone}
      identity={<span className="mono wrap-anywhere">{server.url}</span>}
      description={
        server.serverName ? (
          <p className="subtle">
            Meldet sich als „{server.serverName}
            {server.serverVersion ? ` ${server.serverVersion}` : ""}“ (Angabe
            des Servers)
          </p>
        ) : null
      }
      capabilities={[
        `${server.enabledToolCount} von ${server.toolCount} Werkzeugen aktiviert`,
        "Vertrauen: nicht vertrauenswürdig · jeder Aufruf fragt zuerst",
      ]}
      health={{
        healthLabel:
          server.status === "unchecked"
            ? "Noch nicht geprüft"
            : server.status === "healthy"
              ? "Funktioniert"
              : "Fehlerhaft",
        healthTone:
          server.status === "healthy"
            ? "success"
            : server.status === "unchecked"
              ? "neutral"
              : "danger",
        lastCheckedAt: server.lastCheckedAt,
        latencyMs: server.lastLatencyMs,
        lastOkAt: server.lastOkAt,
        lastError: server.status === "healthy" ? null : server.lastError,
        lastToolCallAt: server.lastToolCallAt,
      }}
      actions={
        <>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== null}
            onClick={() =>
              void run("check", () => send(`${base}/check`, "POST"))
            }
          >
            <RefreshCw size={14} aria-hidden="true" />
            {busy === "check"
              ? "Wird getestet…"
              : "Testen und Werkzeuge finden"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== null}
            onClick={() =>
              void run("toggle", () =>
                send(base, "PATCH", { enabled: !server.enabled }),
              )
            }
          >
            {server.enabled ? "Server deaktivieren" : "Server aktivieren"}
          </button>
          <ConfirmDialog
            trigger={
              <button
                type="button"
                className="btn btn-danger-quiet btn-sm"
                disabled={busy !== null}
              >
                <Trash2 size={14} aria-hidden="true" />
                Entfernen
              </button>
            }
            title={`${server.name} entfernen?`}
            description="Osirus löscht den Server, sein gespeichertes Token und seine Werkzeugliste. Seine Werkzeuge stehen Läufen ab sofort nicht mehr zur Verfügung."
            confirmLabel="Server entfernen"
            onConfirm={() => void run("remove", () => send(base, "DELETE"))}
          />
        </>
      }
    >
      {message ? (
        <p className="field-error" role="alert">
          {message}
        </p>
      ) : null}
      {server.tools.length ? (
        <details className="disclosure conn-tools">
          <summary>
            <ChevronRight size={14} aria-hidden="true" className="chevron" />
            Werkzeuge prüfen ({server.toolCount})
          </summary>
          <ul className="tool-list">
            {server.tools.map((tool) => (
              <li key={tool.id} className="tool-item">
                <div className="tool-main">
                  <p className="tool-name mono">{tool.name}</p>
                  <p className="tool-desc">
                    <span className="overline">
                      Vom Server · nicht vertrauenswürdig
                    </span>
                    <span>{tool.description}</span>
                  </p>
                  {tool.parameters.length ? (
                    <p className="subtle tool-params">
                      Eingaben: {tool.parameters.join(", ")}
                    </p>
                  ) : null}
                  <Badge tone="danger">Hohes Risiko · fragt jedes Mal</Badge>
                  {tool.flagged ? (
                    <Badge tone="warning">
                      Beschreibung wollte dem Agenten Anweisungen geben
                    </Badge>
                  ) : null}
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={tool.enabled}
                    disabled={busy !== null}
                    aria-label={`Osirus darf ${tool.name} nutzen`}
                    onChange={(event) =>
                      void run(`tool:${tool.id}`, () =>
                        send(`${base}/tools/${tool.id}`, "PATCH", {
                          enabled: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>{tool.enabled ? "Erlaubt" : "Aus"}</span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      ) : server.status === "healthy" ? (
        <p className="subtle">Der Server bietet keine Werkzeuge an.</p>
      ) : null}
    </ConnectionCard>
  );
}

export function McpManager({
  servers,
  available,
}: {
  servers: McpServerView[];
  available: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  if (!available)
    return (
      <EmptyState icon={Server} title="MCP-Server sind noch nicht verfügbar">
        Diese Installation ist noch nicht für MCP-Server aktualisiert.
      </EmptyState>
    );
  return (
    <div className="stack">
      {servers.map((server) => (
        <ServerCard key={server.id} server={server} />
      ))}
      {adding ? (
        <AddServerForm
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : servers.length ? (
        <div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setAdding(true)}
          >
            <Plus size={16} aria-hidden="true" />
            MCP-Server hinzufügen
          </button>
        </div>
      ) : (
        <EmptyState
          icon={Server}
          title="Keine MCP-Server"
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAdding(true)}
            >
              <Plus size={16} aria-hidden="true" />
              MCP-Server hinzufügen
            </button>
          }
        >
          Verbinde einen Model-Context-Protocol-Server, um Osirus mehr Werkzeuge
          zu geben. Du prüfst jedes Werkzeug, bevor Osirus es nutzen darf.
        </EmptyState>
      )}
    </div>
  );
}
