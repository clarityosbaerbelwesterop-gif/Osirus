import type { Metadata } from "next";
import { AutomationList } from "@/components/automations/automation-list";
import { PageFrame } from "@/components/shell/page-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { listAutomations } from "@/lib/automations/store";
import type { AutomationView } from "@/lib/automations/store-types";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const { identity } = await requireProductSession();
  let automations: AutomationView[] = [];
  let available = true;
  try {
    automations = await listAutomations(identity);
  } catch {
    available = false;
  }
  return (
    <PageFrame
      title="Automations"
      lede="Objectives that run on their own: on a schedule or when something happens. Each run is an ordinary task with the same approvals and audit."
    >
      {available ? (
        <AutomationList automations={automations} />
      ) : (
        <EmptyState title="Automations are not available yet">
          This deployment has not been upgraded for automations.
        </EmptyState>
      )}
    </PageFrame>
  );
}
