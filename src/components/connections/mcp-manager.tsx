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
  invalid_request: "Enter a name and an https:// URL.",
  duplicate_name: "A server with this name already exists.",
  not_https: "The URL must start with https://.",
  private_host: "Osirus cannot reach local or internal hosts.",
  private_address: "Osirus cannot reach private network addresses.",
  credentials_in_url: "Put credentials in the token field, not the URL.",
  invalid_url: "That is not a valid URL.",
  port_not_allowed: "That port is not allowed.",
  connector_key_not_configured:
    "Connections are not set up on this deployment yet.",
};

type RegistryResult = {
  name: string;
  title: string | null;
  description: string;
  remoteUrl: string | null;
  localOnly: boolean;
};

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
      setSearchError("The MCP Registry could not be searched right now.");
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
    setToken("");
    if (result.ok) return onDone();
    setError(
      ADD_ERRORS[result.payload.error ?? ""] ??
        "The server could not be added.",
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
          An MCP server can offer tools that act outside Osirus. Add only
          servers you trust. Osirus treats every tool as high risk and asks you
          before each call, whatever the server says about itself.
        </span>
      </div>
      <div className="stack">
        <div className="row row-wrap">
          <Field
            label="Find in the MCP Registry"
            hint="The official registry. Only servers with a remote endpoint can be added here."
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
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {searchError ? <p className="field-error">{searchError}</p> : null}
        {results ? (
          results.length ? (
            <ul className="tool-list" aria-label="Registry results">
              {results.map((server) => (
                <li key={server.name} className="tool-item">
                  <div className="tool-main">
                    <p className="tool-name mono">
                      {server.title ?? server.name}
                    </p>
                    <p className="tool-desc">
                      <span>{server.description || "No description."}</span>
                    </p>
                    <p className="subtle wrap-anywhere">
                      {server.remoteUrl ??
                        (server.localOnly
                          ? "Runs locally (stdio) only; cannot be added here."
                          : "No remote endpoint published.")}
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
                      Use
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle">Nothing in the registry matches.</p>
          )
        ) : null}
      </div>
      <Field label="Name" hint="How this server appears in approvals.">
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
      <Field label="Server URL" hint="Streamable HTTP endpoint, https only.">
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
        label="Bearer token (optional)"
        hint="Stored encrypted. Never shown again and never given to the model."
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
          {busy ? "Adding and testing…" : "Add and test"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
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
    : { label: "Disabled", tone: "neutral" as const };
  const base = `/api/mcp/servers/${server.id}`;

  const run = async (key: string, action: () => Promise<{ ok: boolean }>) => {
    setBusy(key);
    setMessage(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) setMessage("That did not work. Try again.");
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
            Reports itself as “{server.serverName}
            {server.serverVersion ? ` ${server.serverVersion}` : ""}” (claim
            from the server)
          </p>
        ) : null
      }
      capabilities={[
        `${server.enabledToolCount} of ${server.toolCount} tools enabled`,
        "Trust: untrusted · every call asks first",
      ]}
      health={{
        healthLabel:
          server.status === "unchecked"
            ? "Not checked yet"
            : server.status === "healthy"
              ? "Healthy"
              : "Failing",
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
            {busy === "check" ? "Testing…" : "Test and discover tools"}
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
            {server.enabled ? "Disable server" : "Enable server"}
          </button>
          <ConfirmDialog
            trigger={
              <button
                type="button"
                className="btn btn-danger-quiet btn-sm"
                disabled={busy !== null}
              >
                <Trash2 size={14} aria-hidden="true" />
                Remove
              </button>
            }
            title={`Remove ${server.name}?`}
            description="Osirus deletes the server, its stored token and its tool list. Its tools stop being available to runs immediately."
            confirmLabel="Remove server"
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
            Review tools ({server.toolCount})
          </summary>
          <ul className="tool-list">
            {server.tools.map((tool) => (
              <li key={tool.id} className="tool-item">
                <div className="tool-main">
                  <p className="tool-name mono">{tool.name}</p>
                  <p className="tool-desc">
                    <span className="overline">
                      From the server · untrusted
                    </span>
                    <span>{tool.description}</span>
                  </p>
                  {tool.parameters.length ? (
                    <p className="subtle tool-params">
                      Inputs: {tool.parameters.join(", ")}
                    </p>
                  ) : null}
                  <Badge tone="danger">High risk · asks every time</Badge>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={tool.enabled}
                    disabled={busy !== null}
                    aria-label={`Allow Osirus to use ${tool.name}`}
                    onChange={(event) =>
                      void run(`tool:${tool.id}`, () =>
                        send(`${base}/tools/${tool.id}`, "PATCH", {
                          enabled: event.target.checked,
                        }),
                      )
                    }
                  />
                  <span>{tool.enabled ? "Allowed" : "Off"}</span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      ) : server.status === "healthy" ? (
        <p className="subtle">The server offers no tools.</p>
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
      <EmptyState icon={Server} title="MCP servers are not available yet">
        This deployment has not been upgraded for MCP servers.
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
            Add MCP server
          </button>
        </div>
      ) : (
        <EmptyState
          icon={Server}
          title="No MCP servers"
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAdding(true)}
            >
              <Plus size={16} aria-hidden="true" />
              Add MCP server
            </button>
          }
        >
          Connect a Model Context Protocol server to give Osirus more tools. You
          review each tool before Osirus may use it.
        </EmptyState>
      )}
    </div>
  );
}
