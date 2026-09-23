import type { ReactNode } from "react";
import { SettingsNav } from "@/components/settings/settings-nav";
import { PageFrame } from "@/components/shell/page-frame";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <PageFrame title="Settings">
      <div className="settings">
        <SettingsNav />
        <div className="settings-body">{children}</div>
      </div>
    </PageFrame>
  );
}
