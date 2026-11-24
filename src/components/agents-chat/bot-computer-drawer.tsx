"use client";

import {
  FileText,
  Folder,
  Play,
  RefreshCw,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { cx } from "../ui/cx";

// A bot's cloud computer as Open Terminal shows it: a shell, the files in
// its working folder and the processes that run there. Everything goes
// through POST /api/agents/{id}/computer; the machine is never reached
// from the browser directly.

type Entry = { name: string; type: string; size?: number };
type Run = {
  id: string;
  command: string;
  status: string;
  exit_code: number | null;
  output?: Array<{ type: string; data: string }>;
};

type Tab = "terminal" | "files" | "processes";

async function call<T>(botId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/agents/${botId}/computer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  const data = (await response?.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    message?: string;
  };
  if (!response?.ok || !data.ok)
    throw new Error(
      data.message ?? "Der Cloud-Computer hat nicht geantwortet.",
    );
  return data.result as T;
}

const text = (run: Run) =>
  (run.output ?? [])
    .map((chunk) => chunk.data)
    .join("")
    .replace(/\r\n/g, "\n");

export function BotComputerDrawer(props: {
  botId: string;
  botName: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("terminal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<Run[]>([]);
  const [dir, setDir] = useState(".");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [file, setFile] = useState<{ path: string; content: string } | null>(
    null,
  );
  const [processes, setProcesses] = useState<Run[] | null>(null);

  const guarded = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadFiles = useCallback(
    (path: string) =>
      guarded(async () => {
        const result = await call<{ entries: Entry[] }>(props.botId, {
          action: "files",
          path,
        });
        setDir(path);
        setFile(null);
        setEntries(
          [...(result.entries ?? [])].sort(
            (a, b) =>
              Number(b.type === "directory") - Number(a.type === "directory") ||
              a.name.localeCompare(b.name),
          ),
        );
      }),
    [guarded, props.botId],
  );

  const loadProcesses = useCallback(
    () =>
      guarded(async () => {
        setProcesses(await call<Run[]>(props.botId, { action: "processes" }));
      }),
    [guarded, props.botId],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props]);

  const run = (event: FormEvent) => {
    event.preventDefault();
    const line = command.trim();
    if (!line || busy) return;
    void guarded(async () => {
      const result = await call<Run>(props.botId, {
        action: "run",
        command: line,
      });
      setHistory((current) => [...current, result].slice(-30));
      setCommand("");
      setEntries(null);
      setProcesses(null);
    });
  };

  const join = (name: string) =>
    dir === "." ? name : `${dir.replace(/\/$/, "")}/${name}`;

  return (
    <aside
      className="bc-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={`Cloud-Computer von ${props.botName}`}
    >
      <header className="bc-head">
        <Terminal size={16} aria-hidden="true" />
        <p className="bc-title">Cloud-Computer · {props.botName}</p>
        <button
          type="button"
          className="bc-icon"
          onClick={props.onClose}
          aria-label="Schließen"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="bc-tabs" role="tablist" aria-label="Ansicht">
        {(
          [
            ["terminal", "Terminal"],
            ["files", "Dateien"],
            ["processes", "Prozesse"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cx("bc-tab", tab === id && "bc-tab-active")}
            onClick={() => {
              setTab(id);
              // Loaded on first view of the tab.
              if (id === "files" && entries === null) void loadFiles(".");
              if (id === "processes" && processes === null)
                void loadProcesses();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="bc-error" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? (
        <p className="bc-note" role="status">
          Computer arbeitet…
        </p>
      ) : null}

      {tab === "terminal" ? (
        <div className="bc-body">
          <div className="bc-history" aria-live="polite">
            {history.length === 0 ? (
              <p className="bc-note">
                Linux mit Python, Node, pip und npm. Dateien bleiben zwischen
                Gesprächen erhalten. Internet nur für Paketquellen.
              </p>
            ) : (
              history.map((item) => (
                <div key={item.id} className="bc-run">
                  <p className="bc-cmd">$ {item.command}</p>
                  <pre className="bc-out">{text(item) || " "}</pre>
                  <p className="bc-meta">
                    {item.status === "running"
                      ? "läuft weiter (siehe Prozesse)"
                      : `Exit ${item.exit_code ?? "–"}`}
                  </p>
                </div>
              ))
            )}
          </div>
          <form className="bc-prompt" onSubmit={run}>
            <span aria-hidden="true">$</span>
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="z. B. pip install pandas && python3 skript.py"
              aria-label="Befehl"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="bc-icon"
              disabled={busy || !command.trim()}
              aria-label="Ausführen"
            >
              <Play size={16} aria-hidden="true" />
            </button>
          </form>
        </div>
      ) : null}

      {tab === "files" ? (
        <div className="bc-body">
          <div className="bc-row">
            <p className="bc-path">{dir === "." ? "work/" : `work/${dir}/`}</p>
            {dir !== "." ? (
              <button
                type="button"
                className="bc-link"
                onClick={() =>
                  void loadFiles(dir.split("/").slice(0, -1).join("/") || ".")
                }
              >
                Eine Ebene hoch
              </button>
            ) : null}
            <button
              type="button"
              className="bc-icon"
              onClick={() => void loadFiles(dir)}
              aria-label="Neu laden"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>
          {file ? (
            <div className="bc-file">
              <button
                type="button"
                className="bc-link"
                onClick={() => setFile(null)}
              >
                Zurück zur Liste
              </button>
              <p className="bc-cmd">{file.path}</p>
              <pre className="bc-out">{file.content}</pre>
            </div>
          ) : (
            <ul className="bc-list">
              {(entries ?? []).map((entry) => (
                <li key={entry.name}>
                  <button
                    type="button"
                    className="bc-entry"
                    onClick={() =>
                      entry.type === "directory"
                        ? void loadFiles(join(entry.name))
                        : void guarded(async () => {
                            const result = await call<{ content: string }>(
                              props.botId,
                              { action: "read", path: join(entry.name) },
                            );
                            setFile({
                              path: join(entry.name),
                              content: result.content ?? "",
                            });
                          })
                    }
                  >
                    {entry.type === "directory" ? (
                      <Folder size={14} aria-hidden="true" />
                    ) : (
                      <FileText size={14} aria-hidden="true" />
                    )}
                    {entry.name}
                  </button>
                </li>
              ))}
              {entries && entries.length === 0 ? (
                <li className="bc-note">Noch keine Dateien.</li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "processes" ? (
        <div className="bc-body">
          <div className="bc-row">
            <p className="bc-path">Prozesse auf diesem Computer</p>
            <button
              type="button"
              className="bc-icon"
              onClick={() => void loadProcesses()}
              aria-label="Neu laden"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </div>
          <ul className="bc-list">
            {(processes ?? []).map((process) => (
              <li key={process.id} className="bc-process">
                <span className="bc-cmd">{process.command}</span>
                <span className="bc-meta">
                  {process.status === "running"
                    ? "läuft"
                    : `beendet (Exit ${process.exit_code ?? "–"})`}
                </span>
                {process.status === "running" ? (
                  <button
                    type="button"
                    className="bc-icon"
                    aria-label={`Prozess ${process.command} beenden`}
                    onClick={() =>
                      void guarded(async () => {
                        await call(props.botId, {
                          action: "kill",
                          id: process.id,
                        });
                        setProcesses(null);
                      })
                    }
                  >
                    <Square size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
            {processes && processes.length === 0 ? (
              <li className="bc-note">Keine Prozesse.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
