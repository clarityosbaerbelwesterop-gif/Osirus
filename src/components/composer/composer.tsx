"use client";

import {
  ArrowUp,
  FileText,
  Folder,
  GitBranch,
  Paperclip,
  RotateCcw,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  repositoryInObjective,
  repositoryShortName,
} from "@/lib/coding/repository-ref";
import type { InteractionPreference, LabModelId } from "@/lib/lab/choices";
import type { ModePreference } from "@/lib/ui/preferences";
import { ModelSelectors } from "../lab/model-selectors";
import { IconButton } from "../ui/icon-button";

export type ComposerHandle = {
  focus: () => void;
};

const MODES = ["auto", "research", "coding", "reasoning", "agent"] as const;

const MODE_LABELS: Record<ModePreference, string> = {
  auto: "Auto",
  research: "Research",
  coding: "Coding",
  reasoning: "Reasoning",
  agent: "Agent",
};

export type ComposerAttachment = {
  id: string;
  filename: string;
  status: "stored" | "parsed" | "unsupported" | "failed";
  note: string | null;
};

export type GithubState =
  | { status: "loading" }
  | { status: "CONNECTED"; login: string }
  | { status: "NOT_CONNECTED" | "NOT_CONFIGURED" | "unknown" };

/**
 * The message box. Enter sends, Shift+Enter starts a new line, and an input
 * method composition is never interrupted. Every control here does something:
 * Stop cancels the run, Retry repeats a failed request, Regenerate re-runs the
 * last objective. Attach uploads a file (PDF, text, Markdown, CSV, JSON,
 * code, images) that the run reads by relevance, not in full.
 */
export const Composer = forwardRef<
  ComposerHandle,
  {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
    onRetry: (() => void) | null;
    onRegenerate: (() => void) | null;
    running: boolean;
    cancelling: boolean;
    error: string | null;
    workspaceName: string;
    github: GithubState;
    approvalAnchor: string | null;
    /** User-selected working mode; "auto" lets the router decide alone. */
    mode: ModePreference;
    onModeChange: (mode: ModePreference) => void;
    labModel: LabModelId;
    interaction: InteractionPreference;
    labActivity: string | null;
    labPhases?: readonly string[];
    onLabModelChange: (model: LabModelId) => void;
    onInteractionChange: (interaction: InteractionPreference) => void;
    attachments?: ComposerAttachment[];
    uploading?: boolean;
    onAttach?: (file: File) => void;
    onRemoveAttachment?: (id: string) => void;
  }
>(function Composer(props, ref) {
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const modeButtons = useRef<Array<HTMLButtonElement | null>>([]);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const node = textarea.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(node.value.length, node.value.length);
    },
  }));

  useLayoutEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 260)}px`;
  }, [props.value]);

  const repository = repositoryInObjective(props.value);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onSubmit();
  };

  // Radiogroup pattern: the selected mode keeps tabIndex 0, arrow keys move
  // both selection and focus, Home/End jump to the ends.
  const selectMode = (index: number) => {
    const wrapped = (index + MODES.length) % MODES.length;
    props.onModeChange(MODES[wrapped]);
    modeButtons.current[wrapped]?.focus();
  };
  const onModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = MODES.indexOf(props.mode);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      selectMode(current + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      selectMode(current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectMode(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectMode(MODES.length - 1);
    }
  };

  return (
    <div className="composer-wrap">
      {props.approvalAnchor ? (
        <div className="composer-banner" role="status">
          <ShieldAlert size={15} aria-hidden="true" />
          <span>Osirus is waiting for your approval.</span>
          <a href={`#${props.approvalAnchor}`}>Review</a>
        </div>
      ) : null}
      {props.error ? (
        <div className="composer-error" role="alert">
          <span>{props.error}</span>
          {props.onRetry ? (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={props.onRetry}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <form className="composer" onSubmit={submit}>
        <ModelSelectors
          model={props.labModel}
          interaction={props.interaction}
          activity={props.labActivity}
          phases={props.labPhases}
          disabled={props.running}
          onModelChange={props.onLabModelChange}
          onInteractionChange={props.onInteractionChange}
        />
        <div
          className="composer-modes"
          role="radiogroup"
          aria-label="Working mode"
        >
          {MODES.map((mode, index) => (
            <button
              key={mode}
              ref={(node) => {
                modeButtons.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={props.mode === mode}
              tabIndex={props.mode === mode ? 0 : -1}
              className={`composer-mode${props.mode === mode ? " is-active" : ""}`}
              disabled={props.running}
              onClick={() => props.onModeChange(mode)}
              onKeyDown={onModeKeyDown}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <label htmlFor="composer-input" className="sr-only">
          Message Osirus
        </label>
        <textarea
          id="composer-input"
          ref={textarea}
          className="composer-input"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              props.onSubmit();
            }
          }}
          placeholder={
            props.running
              ? "Osirus is working…"
              : "Describe what you want done…"
          }
          disabled={props.running}
          rows={1}
          aria-describedby="composer-hint"
        />
        {props.attachments?.length ? (
          <ul className="composer-files" aria-label="Attached files">
            {props.attachments.map((file) => (
              <li
                key={file.id}
                className={file.status === "parsed" ? "chip" : "chip chip-warn"}
                title={file.note ?? file.filename}
              >
                <FileText size={13} aria-hidden="true" />
                <span className="truncate">{file.filename}</span>
                {file.status !== "parsed" ? (
                  <span className="sr-only">{file.note}</span>
                ) : null}
                {props.onRemoveAttachment ? (
                  <button
                    type="button"
                    className="chip-remove"
                    aria-label={`Remove ${file.filename}`}
                    onClick={() => props.onRemoveAttachment?.(file.id)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="composer-bar">
          <div className="composer-chips">
            {props.onAttach ? (
              <>
                <input
                  ref={picker}
                  type="file"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  accept=".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.png,.jpg,.jpeg,.gif,.webp,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.sql,.yaml,.yml,.html,.css"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) props.onAttach?.(file);
                    event.target.value = "";
                  }}
                />
                <IconButton
                  label={props.uploading ? "Uploading…" : "Attach a file"}
                  icon={Paperclip}
                  size="sm"
                  disabled={props.running || props.uploading}
                  onClick={() => picker.current?.click()}
                />
              </>
            ) : null}
            <span className="chip" title="Workspace">
              <Folder size={13} aria-hidden="true" />
              <span className="truncate">{props.workspaceName}</span>
            </span>
            {props.mode !== "auto" ? (
              <span className="chip" title="Working mode">
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span className="truncate">
                  Mode: {MODE_LABELS[props.mode]}
                </span>
              </span>
            ) : null}
            {repository ? (
              <span className="chip" title={repository}>
                <GitBranch size={13} aria-hidden="true" />
                <span className="truncate">
                  {repositoryShortName(repository)}
                </span>
              </span>
            ) : null}
            {repository && props.github.status !== "loading" ? (
              props.github.status === "CONNECTED" ? (
                <span className="chip chip-ok">
                  GitHub: {props.github.login}
                </span>
              ) : (
                <Link
                  className="chip chip-warn"
                  href={"/app/connections" as Route}
                >
                  Connect GitHub for private repos
                </Link>
              )
            ) : null}
          </div>
          <div className="composer-controls">
            <span id="composer-hint" className="composer-hint">
              Enter to send · Shift+Enter for a new line
            </span>
            {props.running ? (
              <button
                type="button"
                className="btn btn-sm btn-danger-quiet"
                onClick={props.onCancel}
                disabled={props.cancelling}
                aria-label="Stop this run"
              >
                <Square size={12} aria-hidden="true" />
                {props.cancelling ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <IconButton
                type="submit"
                tone="primary"
                label="Send"
                icon={ArrowUp}
                disabled={!props.value.trim()}
              />
            )}
          </div>
        </div>
      </form>
      <div className="composer-after">
        {props.onRegenerate && !props.running ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={props.onRegenerate}
          >
            <RefreshCw size={13} aria-hidden="true" />
            Regenerate
          </button>
        ) : null}
        <span className="composer-disclaimer">
          Osirus can make mistakes. Check important results.
        </span>
      </div>
    </div>
  );
});
