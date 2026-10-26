import { PageFrame } from "@/components/shell/page-frame";
import { WorkStudio } from "@/components/work/work-studio";
import { requireProductSession } from "@/lib/product/session";
import { listNvidiaTopModels } from "@/lib/models/key-models";

export const dynamic = "force-dynamic";

export default async function WorkPage() {
  await requireProductSession();
  const models = await listNvidiaTopModels();
  return (
    <PageFrame
      title="Work"
      lede="Zuerst die Aufgabe. Danach empfiehlt Osirus Modell, Prüfer und Subagents."
    >
      <WorkStudio
        models={models.availability === "ready" ? models.models : []}
      />
    </PageFrame>
  );
}
