"use client";

import { Check, Copy } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import type { ModelCallSummary } from "@/lib/runtime/types";
import { OsirusMark } from "../shell/osirus-mark";

// The Markdown pipeline (micromark, GFM, hast) is the largest client module;
// it loads with the first answer instead of with the empty chat. The server
// still renders answers as HTML, so nothing shifts while it loads.
const Markdown = dynamic(() =>
  import("./markdown").then((module) => module.Markdown),
);

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
  /** The run that wrote this message, when one did. */
  runId?: string | null;
};

/** "1234" -> "1.2k"; small counts stay exact. */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const rounded = (tokens / 1000).toFixed(1).replace(/\.0$/, "");
    return `${rounded}k`;
  }
  return String(tokens);
}

/** The model a run actually answered with, plus its token spend when known. */
export function modelCaption(call: ModelCallSummary): string {
  const total =
    (call.inputTokens ?? 0) + (call.outputTokens ?? 0) > 0
      ? (call.inputTokens ?? 0) + (call.outputTokens ?? 0)
      : null;
  return total === null
    ? call.model
    : `${call.model} · ${formatTokenCount(total)} tokens`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="message-action"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? (
        <Check size={13} aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * The conversation. The run card is placed right after the message that
 * started the run, so progress, approvals and the answer read in order.
 */
export function MessageList({
  messages,
  runObjective,
  runSlot,
  streamingId,
  modelCalls,
}: {
  messages: ChatMessage[];
  runObjective: string | null;
  runSlot: ReactNode;
  streamingId: string | null;
  /** Latest completed model call per run, keyed by run id. */
  modelCalls?: Record<string, ModelCallSummary>;
}) {
  const visible = messages.filter((message) => message.role !== "system");
  let anchor = -1;
  if (runSlot) {
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const message = visible[index]!;
      if (
        message.role === "user" &&
        message.content.trim() === runObjective?.trim()
      ) {
        anchor = index;
        break;
      }
    }
    if (anchor === -1) {
      for (let index = visible.length - 1; index >= 0; index -= 1) {
        if (visible[index]!.role === "user") {
          anchor = index;
          break;
        }
      }
    }
  }

  return (
    <ol className="messages" aria-label="Conversation">
      {visible.map((message, index) => (
        <li key={message.id} className="message-item">
          {message.role === "user" ? (
            <div className="message message-user">
              <h3 className="sr-only">You</h3>
              <p className="message-user-text">{message.content}</p>
            </div>
          ) : (
            <div className="message message-assistant">
              <div className="message-author">
                <OsirusMark size={22} />
                <h3>Osirus</h3>
                {message.id === streamingId ? (
                  <span className="subtle message-streaming">Writing…</span>
                ) : null}
              </div>
              <Markdown content={message.content} />
              {message.id !== streamingId && message.content ? (
                <div className="message-actions">
                  <CopyButton text={message.content} />
                </div>
              ) : null}
              {message.runId && modelCalls?.[message.runId] ? (
                <p
                  className="message-model"
                  aria-label={`Answered by ${modelCaption(modelCalls[message.runId]!)}`}
                >
                  {modelCaption(modelCalls[message.runId]!)}
                </p>
              ) : null}
            </div>
          )}
          {index === anchor ? runSlot : null}
        </li>
      ))}
      {runSlot && anchor === -1 ? (
        <li className="message-item">{runSlot}</li>
      ) : null}
    </ol>
  );
}
