import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatHub } from "@/components/chat/chat-hub";
import { AppShell } from "@/components/shell/app-shell";
import { fixturesEnabled } from "@/lib/ui/fixtures-flag";
import {
  codingRunFixture,
  FIXTURE_IDS,
  researchRunFixture,
  shellFixture,
} from "../fixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "UI fixture",
  robots: { index: false },
};

export default async function FixturePage({
  params,
}: {
  params: Promise<{ surface: string }>;
}) {
  if (!fixturesEnabled()) notFound();
  const { surface } = await params;
  const shell = shellFixture();
  const chat = (snapshot: ReturnType<typeof codingRunFixture> | null) => (
    <AppShell data={shell}>
      <ChatHub
        firstName="Bärbel"
        workspaceName={shell.workspaceName}
        initialSessionId={snapshot ? FIXTURE_IDS.session : null}
        initialMessages={snapshot?.messages ?? []}
        initialRunId={null}
        initialSnapshotRunId={null}
        initialSnapshot={snapshot}
      />
    </AppShell>
  );

  switch (surface) {
    case "chat-empty":
      return chat(null);
    case "chat-active":
      return chat(codingRunFixture("active"));
    case "chat-coding":
      return chat(codingRunFixture("done"));
    case "chat-research":
      return chat(researchRunFixture());
    default:
      notFound();
  }
}
