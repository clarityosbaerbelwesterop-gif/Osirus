import type { ReactNode } from "react";
import ProductLayout from "../app/layout";

export const dynamic = "force-dynamic";

// Internal pages share the product shell; each page decides who may see it.
export default function InternalLayout({ children }: { children: ReactNode }) {
  return <ProductLayout>{children}</ProductLayout>;
}
