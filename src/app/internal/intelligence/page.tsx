import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IntelligenceLab } from "@/components/intelligence/lab";
import { PageFrame } from "@/components/shell/page-frame";
import { labView } from "@/lib/intelligence/lab/view";
import { trainingProvider } from "@/lib/intelligence/models/training";
import {
  isOperator,
  productionTickUrl,
} from "@/lib/intelligence/production/operator";
import { PgIntelStore } from "@/lib/intelligence/store/pg-store";
import { requireProductSession } from "@/lib/product/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Intelligence Lab",
  robots: { index: false },
};

// The Intelligence Lab. Platform operators only: for anyone else this page
// does not exist. Read through the system role after the operator check,
// because the Intelligence Plane belongs to no tenant.
export default async function IntelligencePage() {
  const { identity } = await requireProductSession();
  if (!(await isOperator(identity.userId))) notFound();
  const view = await labView(
    new PgIntelStore(),
    await trainingProvider().capabilities(),
  );
  return (
    <PageFrame
      title="Intelligence Lab"
      lede="The Foundry: what it measured, what it is testing, what it kept and why. Internal; customers never see it."
    >
      <IntelligenceLab view={view} canRunNow={Boolean(productionTickUrl())} />
    </PageFrame>
  );
}
