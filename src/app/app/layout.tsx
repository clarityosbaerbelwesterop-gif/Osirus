import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { requireProductSession } from "@/lib/product/session";
import { isOrganizationAdmin, shellCounts } from "@/lib/product/shell";
import {
  parseSidebar,
  parseTheme,
  SIDEBAR_COOKIE,
  THEME_COOKIE,
} from "@/lib/ui/preferences";

export const dynamic = "force-dynamic";

export default async function ProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, identity } = await requireProductSession();
  const repository = new RuntimeRepository(identity.userId);
  const [sessions, counts, isAdmin, jar] = await Promise.all([
    repository.listWorkspaceSessions(identity.workspaceId),
    shellCounts(identity),
    isOrganizationAdmin(identity),
    cookies(),
  ]);
  return (
    <AppShell
      data={{
        user: { name: user.name, email: user.email },
        workspaceName: identity.workspaceName,
        sessions,
        counts,
        isAdmin,
        sidebar: parseSidebar(jar.get(SIDEBAR_COOKIE)?.value),
        theme: parseTheme(jar.get(THEME_COOKIE)?.value),
      }}
    >
      {children}
    </AppShell>
  );
}
