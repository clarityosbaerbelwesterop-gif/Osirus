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
  { id: "pull_request", label: "Pull request" },
  { id: "ci_failure", label: "CI failure" },
  { id: "deployment", label: "Deployment" },
  { id: "db_event", label: "Database event" },
  { id: "generic", label: "Other" },
];

const SOURCE_HINT: Record<WebhookEndpointData["source"], string> = {
  github:
    "Signed with X-Hub-Signature-256. Add it to a repository below, or paste the URL and secret under Settings → Webhooks (content type application/json).",
  vercel:
    "Signed with x-vercel-signature. Paste the URL and secret under Vercel → Settings → Webhooks.",
  generic:
    "Send JSON with x-osirus-timestamp (Unix seconds) and x-osirus-signature: sha256=HMAC(secret, timestamp + '.' + body). Name the event in x-osirus-event, e.g. db.row_inserted.",
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
          ? "Webhooks need OSIRUS_CONNECTOR_KEY and the latest database upgrade on this deployment."
          : "Webhooks are not set up on this deployment yet."}
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
          ? "Webhooks are not set up on this deployment yet."
          : body?.error === "limit_reached"
            ? "This workspace reached its plan's webhook limit."
            : "The endpoint was not created.",
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
        ? `Added to ${repository}. GitHub sends a ping first.`
        : body?.error === "github_permission"
          ? "GitHub refused: the token needs the Webhooks permission (fine-grained) or admin:repo_hook (classic)."
          : body?.error === "github_not_connected"
            ? "Connect GitHub with write access first."
            : "The webhook could not be added on GitHub.",
    );
  };

  return (
    <div className="stack">
      {created ? (
        <div className="notice notice-info" role="status">
          <div className="stack">
            <p>Copy the secret now; it is not shown again.</p>
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
                Copy secret
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setCreated(null)}
              >
                Done
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
                <Field label="Add to GitHub repository (owner/name)">
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
                  Add webhook on GitHub
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
                  {endpoint.source} ·{" "}
                  {endpoint.events.length
                    ? endpoint.events.join(", ").replaceAll("_", " ")
                    : "all events"}
                  {endpoint.lastDeliveryAt ? (
                    <>
                      {" "}
                      · last delivery{" "}
                      <RelativeTime value={endpoint.lastDeliveryAt} /> (
                      {endpoint.lastStatus})
                    </>
                  ) : (
                    " · no delivery yet"
                  )}
                </p>
              </div>
              <ConfirmDialog
                title={`Delete ${endpoint.name}?`}
                description="Deliveries to this URL will be refused. Automations that listen to it stop starting."
                confirmLabel="Delete"
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
                    aria-label={`Delete ${endpoint.name}`}
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
          <Field label="Sender" hint={SOURCE_HINT[source]}>
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
                <option value="generic">Any signed sender</option>
              </select>
            )}
          </Field>
          <fieldset className="field fieldset">
            <legend className="field-label">Events it accepts</legend>
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
              Create endpoint
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setCreating(false)}
            >
              Cancel
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
            New webhook endpoint
          </button>
        </div>
      )}
    </div>
  );
}
