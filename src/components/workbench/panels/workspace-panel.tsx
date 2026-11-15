"use client";

import {
  ChevronRight,
  ExternalLink,
  FileCode2,
  TerminalSquare,
  X,
} from "lucide-react";
import { useState } from "react";
import { formatDuration } from "@/lib/ui/labels";
import { Badge } from "../../ui/badge";
import { EmptyState } from "../../ui/empty-state";
import { IconButton } from "../../ui/icon-button";
import { useJson } from "../use-json";

// Files, Diff, Terminal and Preview of a run's coding workspace. Everything
// shown is the persisted workspace record -- the real file tree, the real git
// diff, the real command log -- or an explicit statement that there is none.

type CommandLogEntry = {
  command: string;
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  at: string;
  stdoutTail: string;
  stderrTail: string;
};

export type WorkspaceView = {
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

export type WorkspaceTab = "files" | "diff" | "terminal" | "preview";

const WORKSPACE_STATUS: Record<string, string> = {
  creating: "Sandbox startet",
  ready: "Sandbox bereit",
  stopped: "Gestoppt",
  destroyed: "Entfernt",
  failed: "Fehlgeschlagen",
};

function Header({ workspace }: { workspace: WorkspaceView }) {
  return (
    <div className="wb-meta">
      <span className="wrap-anywhere mono">
        {workspace.repository?.replace(/^https:\/\/github\.com\//, "") ??
          "Neues Repository"}
      </span>
      {workspace.branch ? <Badge outline>{workspace.branch}</Badge> : null}
      <Badge
        tone={
          workspace.status === "ready"
            ? "success"
            : workspace.status === "failed"
              ? "danger"
              : "neutral"
        }
      >
        {WORKSPACE_STATUS[workspace.status] ?? workspace.status}
      </Badge>
    </div>
  );
}

function diffClass(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) return "diff-add";
  if (line.startsWith("-") && !line.startsWith("---")) return "diff-remove";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("diff --git")) return "diff-file";
  return undefined;
}

export function WorkspacePanel({
  runId,
  tab,
  live,
}: {
  runId: string | null;
  tab: WorkspaceTab;
  live: boolean;
}) {
  const { data, error, loading } = useJson<{ workspace: WorkspaceView | null }>(
    runId ? `/api/workspaces/${runId}` : null,
    live ? 5_000 : null,
  );
  const [file, setFile] = useState<{ path: string; content: string } | null>(
    null,
  );
  const [fileError, setFileError] = useState<{
    path: string;
    message: string;
  } | null>(null);

  const openFile = async (path: string) => {
    if (!runId) return;
    setFileError(null);
    const response = await fetch(
      `/api/workspaces/${runId}/file?path=${encodeURIComponent(path)}`,
      { cache: "no-store" },
    ).catch(() => null);
    const body = (await response?.json().catch(() => ({}))) as {
      content?: string;
      error?: string;
    };
    if (response?.ok && typeof body.content === "string")
      setFile({ path, content: body.content });
    else
      setFileError({
        path,
        message:
          body.error === "file_too_large"
            ? "Diese Datei ist zu groß für die Anzeige."
            : "Diese Datei konnte nicht geöffnet werden. Vielleicht ist die Sandbox gestoppt.",
      });
  };

  if (!runId) return <EmptyState title="Kein Lauf ausgewählt" />;
  if (loading && !data)
    return (
      <div className="wb-loading" aria-busy="true">
        Arbeitsbereich wird geladen…
      </div>
    );
  if (error)
    return (
      <EmptyState title="Arbeitsbereich nicht verfügbar">
        Er konnte gerade nicht geladen werden.
      </EmptyState>
    );
  const workspace = data?.workspace;
  if (!workspace)
    return (
      <EmptyState icon={FileCode2} title="Kein Code-Arbeitsbereich">
        Eine Sandbox öffnet sich, wenn ein Code- oder Bau-Lauf eine braucht.
      </EmptyState>
    );

  if (tab === "files")
    return (
      <div className="wb-section">
        <Header workspace={workspace} />
        {workspace.repositoryMap?.languages?.length ? (
          <p className="subtle wb-note">
            {workspace.repositoryMap.languages
              .slice(0, 4)
              .map((entry) => `${entry.language} (${entry.files})`)
              .join(" · ")}
            {workspace.repositoryMap.frameworks?.length
              ? ` · ${workspace.repositoryMap.frameworks.join(", ")}`
              : ""}
          </p>
        ) : null}
        {file ? (
          <div className="file-view">
            <div className="file-view-bar">
              <span className="mono wrap-anywhere">{file.path}</span>
              <IconButton
                size="sm"
                label="Datei schließen"
                icon={X}
                onClick={() => setFile(null)}
              />
            </div>
            <pre
              className="code-view"
              tabIndex={0}
              aria-label={`Inhalt von ${file.path}`}
            >
              <code>{file.content}</code>
            </pre>
          </div>
        ) : null}
        {fileError ? (
          <p className="field-error" role="alert">
            {fileError.path}: {fileError.message}
          </p>
        ) : null}
        <ul className="file-tree" aria-label="Dateien">
          {workspace.fileTree.slice(0, 500).map((path) => (
            <li key={path}>
              <button
                type="button"
                className="file-entry"
                aria-current={file?.path === path ? "true" : undefined}
                onClick={() => void openFile(path)}
              >
                <span className="wrap-anywhere">{path}</span>
              </button>
            </li>
          ))}
        </ul>
        {workspace.fileTree.length > 500 ? (
          <p className="subtle wb-note">
            Zeigt die ersten 500 von {workspace.fileTree.length} Dateien.
          </p>
        ) : null}
      </div>
    );

  if (tab === "diff")
    return (
      <div className="wb-section">
        <Header workspace={workspace} />
        {workspace.diff ? (
          <pre
            className="code-view diff-view"
            tabIndex={0}
            aria-label="Änderungen"
          >
            <code>
              {workspace.diff.split("\n").map((line, index) => (
                <span key={index} className={diffClass(line)}>
                  {line}
                  {"\n"}
                </span>
              ))}
            </code>
          </pre>
        ) : (
          <EmptyState title="Noch keine Änderungen">
            Die Änderungen erscheinen, sobald sich Dateien ändern.
          </EmptyState>
        )}
      </div>
    );

  if (tab === "terminal")
    return (
      <div className="wb-section">
        <Header workspace={workspace} />
        {workspace.commands.length ? (
          <p className="subtle wb-note">
            Prüfungen im Repository:{" "}
            {workspace.commands
              .map((command) => `${command.phase}: ${command.command}`)
              .join(" · ")}
          </p>
        ) : (
          <p className="subtle wb-note">
            Das Repository legt keine Prüfbefehle fest.
          </p>
        )}
        {workspace.commandLog.length ? (
          <ol className="terminal-log">
            {workspace.commandLog.map((entry, index) => (
              <li key={`${entry.at}:${index}`}>
                <details
                  className="disclosure terminal-entry"
                  open={index === workspace.commandLog.length - 1}
                >
                  <summary>
                    <ChevronRight
                      size={14}
                      aria-hidden="true"
                      className="chevron"
                    />
                    <code className="wrap-anywhere">$ {entry.command}</code>
                    <Badge tone={entry.exitCode === 0 ? "success" : "danger"}>
                      {entry.exitCode === 0
                        ? "bestanden"
                        : `Exit ${entry.exitCode ?? "–"}`}
                    </Badge>
                    <span className="subtle tabular">
                      {formatDuration(entry.durationMs)}
                    </span>
                  </summary>
                  <pre
                    className="code-view"
                    tabIndex={0}
                    aria-label={`Ausgabe von ${entry.command}`}
                  >
                    <code>
                      {entry.stdoutTail}
                      {entry.stderrTail ? `\n${entry.stderrTail}` : ""}
                    </code>
                  </pre>
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            icon={TerminalSquare}
            title="Noch keine Befehle ausgeführt"
          />
        )}
      </div>
    );

  return (
    <div className="wb-section">
      <Header workspace={workspace} />
      {workspace.previewUrl && workspace.status === "ready" ? (
        <>
          <a
            className="btn btn-sm btn-secondary wb-preview-open"
            href={workspace.previewUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} aria-hidden="true" />
            Vorschau in neuem Tab öffnen
          </a>
          <iframe
            className="preview-frame"
            src={workspace.previewUrl}
            title="Vorschau des Arbeitsbereichs"
            sandbox="allow-scripts allow-forms"
            referrerPolicy="no-referrer"
          />
        </>
      ) : (
        <EmptyState title="Keine Vorschau">
          {workspace.previewUrl
            ? "Der Arbeitsbereich ist gestoppt, deshalb läuft seine Vorschau nicht."
            : "In diesem Arbeitsbereich wurde kein Vorschau-Server gestartet."}
        </EmptyState>
      )}
    </div>
  );
}
