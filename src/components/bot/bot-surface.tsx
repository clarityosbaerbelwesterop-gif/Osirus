"use client";

import { ChatHub } from "../chat/chat-hub";
import type { ChatMessage } from "../chat/message-list";

/**
 * Bot is its own surface. A message starts the same run Chat and Agent use.
 * The assistant reply is that run's answer. There is no second runtime and
 * no repository grant.
 */
export function BotSurface(props: {
  workspaceName: string;
  initialSessionId: string | null;
  initialMessages: ChatMessage[];
  initialRunId: string | null;
  initialSnapshotRunId: string | null;
}) {
  return (
    <ChatHub
      kind="bot"
      workspaceName={props.workspaceName}
      initialSessionId={props.initialSessionId}
      initialMessages={props.initialMessages}
      initialRunId={props.initialRunId}
      initialSnapshotRunId={props.initialSnapshotRunId}
    />
  );
}
