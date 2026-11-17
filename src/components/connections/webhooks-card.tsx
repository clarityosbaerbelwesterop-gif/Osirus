"use client";

import { Copy, Trash2, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useShell } from "../shell/shell-context";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Field } from "../ui/field";
import { RelativeTime } from "../ui/relative-time";

export type WebhookEndpointData = {
  id: string;
  name: string;
  source: "github" | "vercel" | "generic";
  events: string[];
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastStatus: string | null;
};

const EVENTS = [
  { id: "push", label: "Push" },
  { id: "pull_request", label: "Pull Request" },
  { id: "ci_failure", label: "CI-Fehler" },
  { id: "deployment", label: "Deployment" },
  { id: "db_event", label: "Datenbank-Ereignis" },
  { id: "generic", label: "Sonstiges" },
];

const SOURCE_LABEL: Record<WebhookEndpointData["source"], string> = {
  github: "GitHub",
  vercel: "Vercel",
  generic: "Beliebiger signierter Absender",
};

const SOURCE_HINT: Record<WebhookEndpointData["source"], string> = {
  github:
    "Signiert mit X-Hub-Signature-256. Füge ihn unten einem Repository hinzu oder trage URL und Secret unter Settings → Webhooks ein (Content type application/json).",
  vercel:
    "Signiert mit x-vercel-signature. Trage URL und Secret unter Vercel → Settings → Webhooks ein.",
  generic:
    "Sende JSON mit x-osirus-timestamp (Unix-Sekunden) und x-osirus-signature: sha256=HMAC(secret, timestamp + '.' + body). Nenne das Ereignis in x-osirus-event, z. B. db.row_inserted.",
};

export function WebhooksCard({
  endpoints,
  available,
  githubWritable,
}: {
  endpoints: WebhookEndpointData[];
  available: boolean;
  githubWritable: boolean;
}) {
  const router = useRouter();
  const shell = useShell();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [source, setSource] = useState<WebhookEndpointData["source"]>("github");
  const [events, setEvents] = useState<string[]>(["ci_failure"]);
  const [created, setCreated] = useState<{
    id: string;
    url: string;
    secret: string;
  } | null>(null);
  const [repository, setRepository] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!available)
    return (
      <p className="subtle">
        {shell.isAdmin
          ? "Webhooks brauchen OSIRUS_CONNECTOR_KEY und das neueste Datenbank-Upgrade in dieser Installation."
          : "Webhooks sind in dieser Installation noch nicht eingerichtet."}
      </p>
    );

  const create = async () => {
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, source, events }),
    }).catch(() => null);
    setBusy(false);
    const body = (await response?.json().catch(() => ({}))) as {
      endpoint?: { id: string };
      url?: string;
      secret?: string;
      error?: string;
    };
    if (!response?.ok || !body.endpoint || !body.url || !body.secret) {
      setMessage(
        body?.error === "not_configured"
          ? "Webhooks sind in dieser Installation noch nicht eingerichtet."
          : body?.error === "limit_reached"
            ? "Dieser Arbeitsbereich hat das Webhook-Limit seines Plans erreicht."
            : "Der Endpunkt wurde nicht angelegt.",
      );
      return;
    }
    setCreated({ id: body.endpoint.id, url: body.url, secret: body.secret });
    setCreating(false);
    setName("");
    router.refresh();
  };

  const installOnGithub = async () => {
    if (!created) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/webhooks/${created.id}/github`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repository, url: created.url }),
    }).catch(() => null);
    setBusy(false);
    const body = (await response?.json().catch(() => ({}))) as {
      error?: string;
    };
    setMessage(
      response?.ok
        ? `Zu ${repository} hinzugefügt. GitHub sendet zuerst einen Ping.`
        : body?.error === "github_permission"
          ? "GitHub hat abgelehnt: Das Token braucht die Berechtigung Webhooks (fine-grained) oder admin:repo_hook (classic)."
          : body?.error === "github_not_connected"
            ? "Verbinde GitHub zuerst mit Schreibzugriff."
            : "Der Webhook konnte auf GitHub nicht hinzugefügt werden.",
    );
  };

  return (
    <div className="stack">
      {created ? (
        <div className="notice notice-info" role="status">
          <div className="stack">
            <p>
              Kopiere das Secret jetzt; es wird nicht noch einmal angezeigt.
            </p>
            <p className="mono">URL: {created.url}</p>
            <p className="mono">Secret: {created.secret}</p>
            <div className="row row-wrap">
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() =>
                  void navigator.clipboard?.writeText(created.secret)
                }
              >
                <Copy size={14} aria-hidden="true" />
                Secret kopieren
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setCreated(null)}
              >
                Fertig
              </button>
            </div>
            {githubWritable ? (
              <form
                className="row row-wrap"
                onSubmit={(event) => {
                  event.preventDefault();
                  void installOnGithub();
                }}
              >
                <Field label="Zu GitHub-Repository hinzufügen (owner/name)">
                  {(props) => (
                    <input
                      {...props}
                      className="input mono"
                      value={repository}
                      placeholder="acme/shop"
                      onChange={(event) => setRepository(event.target.value)}
                    />
                  )}
                </Field>
                <button
                  type="submit"
                  className="btn btn-sm btn-secondary"
                  disabled={busy || !/^[\w.-]+\/[\w.-]+$/.test(repository)}
                >
                  Webhook auf GitHub hinzufügen
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="subtle" role="status">
          {message}
        </p>
      ) : null}
      {endpoints.length ? (
        <ul className="item-list">
          {endpoints.map((endpoint) => (
            <li key={endpoint.id} className="item">
              <Webhook size={16} aria-hidden="true" />
              <div className="item-body">
                <p className="item-title">{endpoint.name}</p>
                <p className="item-meta">
                  {SOURCE_LABEL[endpoint.source] ?? endpoint.source} ·{" "}
                  {endpoint.events.length
                    ? endpoint.events
                        .map(
                          (id) =>
                            EVENTS.find((event) => event.id === id)?.label ??
                            id.replaceAll("_", " "),
                        )
                        .join(", ")
                    : "alle Ereignisse"}
                  {endpoint.lastDeliveryAt ? (
                    <>
                      {" "}
                      · letzte Zustellung{" "}
                      <RelativeTime value={endpoint.lastDeliveryAt} /> (
                      {endpoint.lastStatus})
                    </>
                  ) : (
                    " · noch keine Zustellung"
                  )}
                </p>
              </div>
              <ConfirmDialog
                title={`${endpoint.name} löschen?`}
                description="Zustellungen an diese URL werden abgelehnt. Automationen, die darauf hören, starten nicht mehr."
                confirmLabel="Löschen"
                onConfirm={async () => {
                  await fetch(`/api/webhooks/${endpoint.id}`, {
                    method: "DELETE",
                  }).catch(() => null);
                  router.refresh();
                }}
                trigger={
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    aria-label={`${endpoint.name} löschen`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
      {creating ? (
        <form
          className="card card-pad conn-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Field label="Name">
            {(props) => (
              <input
                {...props}
                className="input"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Absender" hint={SOURCE_HINT[source]}>
            {(props) => (
              <select
                {...props}
                className="select"
                value={source}
                onChange={(event) =>
                  setSource(event.target.value as WebhookEndpointData["source"])
                }
              >
                <option value="github">GitHub</option>
                <option value="vercel">Vercel</option>
                <option value="generic">Beliebiger signierter Absender</option>
              </select>
            )}
          </Field>
          <fieldset className="field fieldset">
            <legend className="field-label">Angenommene Ereignisse</legend>
            <div className="tool-checks">
              {EVENTS.map((event) => (
                <label key={event.id} className="check">
                  <input
                    type="checkbox"
                    checked={events.includes(event.id)}
                    onChange={(change) =>
                      setEvents((current) =>
                        change.target.checked
                          ? [...current, event.id]
                          : current.filter((id) => id !== event.id),
                      )
                    }
                  />
                  <span>{event.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="row">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !name.trim()}
            >
              Endpunkt anlegen
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setCreating(false)}
            >
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <div className="list-actions">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => setCreating(true)}
          >
            Neuer Webhook-Endpunkt
          </button>
        </div>
      )}
    </div>
  );
}
