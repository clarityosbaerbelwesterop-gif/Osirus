import type { Metadata } from "next";
import { AutomationList } from "@/components/automations/automation-list";
import { PageFrame } from "@/components/shell/page-frame";
import { EmptyState } from "@/components/ui/empty-state";
import { listAutomations } from "@/lib/automations/store";
import type { AutomationView } from "@/lib/automations/store-types";
import { requireProductSession } from "@/lib/product/session";
import { listEndpoints } from "@/lib/webhooks/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Automationen" };

export default async function AutomationsPage() {
  const { identity } = await requireProductSession();
  let automations: AutomationView[] = [];
  let available = true;
  try {
    automations = await listAutomations(identity);
  } catch {
    available = false;
  }
  const endpoints = await listEndpoints(identity).catch(() => []);
  return (
    <PageFrame
      title="Automationen"
      lede="Ziele, die von selbst laufen: nach Zeitplan oder wenn etwas passiert. Jeder Lauf ist eine normale Aufgabe mit denselben Freigaben und demselben Audit."
    >
      {available ? (
        <AutomationList automations={automations} endpoints={endpoints} />
      ) : (
        <EmptyState title="Automationen sind noch nicht verfügbar">
          Diese Installation ist noch nicht für Automationen aktualisiert.
        </EmptyState>
      )}
    </PageFrame>
  );
}
