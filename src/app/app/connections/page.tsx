import type { Metadata } from "next";
import { ConnectionsView } from "@/components/connections/connections-view";
import { PageFrame } from "@/components/shell/page-frame";
import { loadConnections } from "@/lib/product/connections";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connections" };

export default async function ConnectionsPage() {
  const { identity } = await requireProductSession();
  const data = await loadConnections(identity);
  return (
    <PageFrame
      title="Connections"
      lede="What Osirus can reach on your behalf, and whether each connection works right now."
    >
      <ConnectionsView
        github={data.github}
        mcp={data.mcp}
        platforms={data.platforms}
        webhooks={data.webhooks}
      />
    </PageFrame>
  );
}
