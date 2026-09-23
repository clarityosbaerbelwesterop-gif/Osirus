"use client";

import { useCallback, useEffect, useState } from "react";

// Workbench panels backed by their own endpoints.
//
// Each panel shows recorded state -- the workspace record, the research
// evidence store -- not a narration of it. When there is nothing (no sandbox
// here, no research in this run) the panel says exactly that.

type CommandLogEntry = {
  command: string;
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  at: string;
  stdoutTail: string;
  stderrTail: string;
};

type WorkspaceView = {
  driver: string;
  status: string;
  repository: string | null;
  branch: string | null;
  repositoryMap: {
    languages?: Array<{ language: string; files: number }>;
    frameworks?: string[];
  } | null;
  commands: Array<{ phase: string; command: string; source: string }>;
  commandLog: CommandLogEntry[];
  fileTree: string[];
  diff: string | null;
  previewUrl: string | null;
};

function useJson<T>(url: string | null, refreshMs: number | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!url) return;
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        setError(`HTTP ${response.status}`);
        return;
      }
      setData((await response.json()) as T);
      setError(null);
    } catch {
      setError("unreachable");
    }
  }, [url]);
  useEffect(() => {
    // Deferred so the effect itself never sets state synchronously.
    const first = window.setTimeout(() => void load(), 0);
    const timer = refreshMs
      ? window.setInterval(() => void load(), refreshMs)
      : null;
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [load, refreshMs]);
  return { data, error, reload: load };
}

export type WorkspaceTab = "files" | "diff" | "terminal" | "preview";

export function WorkspacePanel(props: {
  runId: string | null;
  tab: WorkspaceTab;
  live: boolean;
}) {
  const { data, error } = useJson<{ workspace: WorkspaceView | null }>(
    props.runId ? `/api/workspaces/${props.runId}` : null,
    props.live ? 5_000 : null,
  );
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [file, setFile] = useState<{ path: string; content: string } | null>(
    null,
  );
  const [fileError, setFileError] = useState<string | null>(null);

  const openFile = async (path: string) => {
    if (!props.runId) return;
    setOpenPath(path);
    setFile(null);
    setFileError(null);
    const response = await fetch(
      `/api/workspaces/${props.runId}/file?path=${encodeURIComponent(path)}`,
      { cache: "no-store" },
    );
    const body = (await response.json().catch(() => ({}))) as {
      content?: string;
      error?: string;
    };
    if (response.ok && typeof body.content === "string")
      setFile({ path, content: body.content });
    else setFileError(body.error ?? `HTTP ${response.status}`);
  };

  if (!props.runId)
    return <p className="muted">Start a run to open a workspace.</p>;
  if (error) return <p className="muted">Workspace unavailable ({error}).</p>;
  const workspace = data?.workspace;
  if (!workspace)
    return (
      <p className="muted">
        No coding workspace for this run. One is opened when a coding or
        building run has a sandbox available.
      </p>
    );

  const header = (
    <p className="muted">
      {workspace.repository ?? "new repository"}
      {workspace.branch ? ` · ${workspace.branch}` : ""} · {workspace.driver} ·{" "}
      {workspace.status}
    </p>
  );

  if (props.tab === "files")
    return (
      <div>
        {header}
        {workspace.repositoryMap?.languages?.length ? (
          <p className="muted">
            {workspace.repositoryMap.languages
              .slice(0, 4)
              .map((entry) => `${entry.language} (${entry.files})`)
              .join(" · ")}
            {workspace.repositoryMap.frameworks?.length
              ? ` · ${workspace.repositoryMap.frameworks.join(", ")}`
              : ""}
          </p>
        ) : null}
        <ul className="file-tree">
          {workspace.fileTree.slice(0, 400).map((path) => (
            <li key={path}>
              <button
                type="button"
                className={
                  path === openPath
                    ? "file-entry file-entry-open"
                    : "file-entry"
                }
                onClick={() => void openFile(path)}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
        {fileError ? (
          <p className="muted">
            {openPath}: {fileError}
          </p>
        ) : null}
        {file ? (
          <pre className="code-view">
            <code>{file.content}</code>
          </pre>
        ) : null}
      </div>
    );

  if (props.tab === "diff")
    return (
      <div>
        {header}
        {workspace.diff ? (
          <pre className="code-view diff-view">
            <code>
              {workspace.diff.split("\n").map((line, index) => (
                <span
                  key={index}
                  className={
                    line.startsWith("+") && !line.startsWith("+++")
                      ? "diff-add"
                      : line.startsWith("-") && !line.startsWith("---")
                        ? "diff-remove"
                        : undefined
                  }
                >
                  {line}
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
        ) : (
          <p className="muted">No changes in the workspace yet.</p>
        )}
      </div>
    );

  if (props.tab === "terminal")
    return (
      <div>
        {header}
        {workspace.commands.length ? (
          <p className="muted">
            Discovered:{" "}
            {workspace.commands
              .map((command) => `${command.phase}: ${command.command}`)
              .join(" · ")}
          </p>
        ) : (
          <p className="muted">The repository declares no check commands.</p>
        )}
        {workspace.commandLog.length ? (
          workspace.commandLog.map((entry, index) => (
            <details key={`${entry.at}:${index}`} className="terminal-entry">
              <summary>
                <code>$ {entry.command}</code>{" "}
                <span
                  className={entry.exitCode === 0 ? "exit-ok" : "exit-failed"}
                >
                  exit {entry.exitCode ?? "none"}
                </span>{" "}
                <span className="muted">
                  {(entry.durationMs / 1000).toFixed(1)}s
                </span>
              </summary>
              <pre className="code-view">
                <code>
                  {entry.stdoutTail}
                  {entry.stderrTail ? `\n${entry.stderrTail}` : ""}
                </code>
              </pre>
            </details>
          ))
        ) : (
          <p className="muted">No commands have run.</p>
        )}
      </div>
    );

  return (
    <div>
      {header}
      {workspace.previewUrl && workspace.status === "ready" ? (
        <>
          <p className="muted">
            <a href={workspace.previewUrl} target="_blank" rel="noreferrer">
              Open preview in a new tab
            </a>
          </p>
          <iframe
            className="preview-frame"
            src={workspace.previewUrl}
            title="Workspace preview"
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
          />
        </>
      ) : (
        <p className="muted">
          {workspace.previewUrl
            ? "The workspace is stopped; its preview is not running."
            : "Nothing is being previewed in this workspace."}
        </p>
      )}
    </div>
  );
}

type ResearchView = {
  documents: Array<{
    id: string;
    url: string;
    title: string | null;
    publisher: string | null;
    authority: string;
    provider: string;
    published_at: string | null;
  }>;
  claims: Array<{
    id: string;
    statement: string;
    status: string;
    confidence: string | number;
    evidence: Array<{ documentId: string; relation: string; excerpt: string }>;
  }>;
};

export function ResearchPanel(props: { runId: string | null; live: boolean }) {
  const { data, error } = useJson<ResearchView>(
    props.runId ? `/api/research/${props.runId}` : null,
    props.live ? 5_000 : null,
  );
  if (!props.runId) return <p className="muted">No run selected.</p>;
  if (error) return <p className="muted">Research unavailable ({error}).</p>;
  if (!data || (data.documents.length === 0 && data.claims.length === 0))
    return <p className="muted">No sources were retrieved for this run.</p>;
  const byId = new Map(data.documents.map((doc) => [doc.id, doc]));
  return (
    <div>
      <p>
        <strong>Claims</strong>
      </p>
      {data.claims.map((claim) => (
        <div key={claim.id} className="claim">
          <p>
            <span
              className={`claim-status claim-${claim.status.toLowerCase()}`}
            >
              {claim.status}
            </span>{" "}
            {claim.statement}
          </p>
          {claim.evidence.map((link, index) => (
            <p className="muted" key={`${link.documentId}:${index}`}>
              {link.relation === "contradicts"
                ? "Contradicted by"
                : "Supported by"}{" "}
              {byId.get(link.documentId)?.publisher ??
                byId.get(link.documentId)?.url ??
                "a retrieved document"}
              : “{link.excerpt}”
            </p>
          ))}
        </div>
      ))}
      <p>
        <strong>Sources retrieved</strong>
      </p>
      {data.documents.map((doc) => (
        <p key={doc.id}>
          <a href={doc.url} target="_blank" rel="noreferrer">
            {doc.title || doc.url}
          </a>
          <span className="muted">
            {" "}
            · {doc.authority} · {doc.provider}
            {doc.published_at ? ` · ${doc.published_at.slice(0, 10)}` : ""}
          </span>
        </p>
      ))}
    </div>
  );
}

export function ApprovalButtons(props: {
  runId: string;
  approvalId: string;
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/runtime/${props.runId}/approvals/${props.approvalId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    setBusy(false);
    if (response.ok) props.onDecided();
    else setError(`Could not record the decision (HTTP ${response.status}).`);
  };
  return (
    <span className="approval-actions">
      <button
        type="button"
        disabled={busy}
        onClick={() => void decide("approved")}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void decide("rejected")}
      >
        Reject
      </button>
      {error ? <span className="muted"> {error}</span> : null}
    </span>
  );
}

type ConnectorStatus =
  | { status: "NOT_CONFIGURED"; reason: string }
  | { status: "NOT_CONNECTED" }
  | { status: "CONNECTED"; login: string; scopes: string[] };

export function GithubConnectorPanel() {
  const { data, reload } = useJson<ConnectorStatus>(
    "/api/connectors/github",
    null,
  );
  const [token, setToken] = useState("");
  const [allowWrite, setAllowWrite] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const connect = async () => {
    setMessage(null);
    const response = await fetch("/api/connectors/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, allowWrite }),
    });
    setToken("");
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) setMessage(body.error ?? `HTTP ${response.status}`);
    await reload();
  };
  const disconnect = async () => {
    await fetch("/api/connectors/github", { method: "DELETE" });
    await reload();
  };

  if (!data) return null;
  return (
    <div className="connector">
      <p>
        <strong>GitHub repositories</strong>{" "}
        <span className="muted">(separate from sign-in)</span>
      </p>
      {data.status === "NOT_CONFIGURED" ? (
        <p className="muted">Not configured here: {data.reason}</p>
      ) : data.status === "CONNECTED" ? (
        <p className="muted">
          Connected as {data.login} · {data.scopes.join(", ")}{" "}
          <button type="button" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <label className="muted" htmlFor="github-token">
            Fine-grained personal access token
          </label>
          <input
            id="github-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <label className="muted">
            <input
              type="checkbox"
              checked={allowWrite}
              onChange={(event) => setAllowWrite(event.target.checked)}
            />{" "}
            Allow pushing branches and opening pull requests (each push still
            needs your approval)
          </label>
          <button type="submit" disabled={token.length < 20}>
            Connect
          </button>
        </form>
      )}
      {message ? <p className="muted">{message}</p> : null}
    </div>
  );
}
