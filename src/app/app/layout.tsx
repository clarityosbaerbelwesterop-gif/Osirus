import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { ensureOsirusUser } from "@/lib/auth/bootstrap";
import { consentIsCurrent } from "@/lib/legal/store";
import { RuntimeRepository } from "@/lib/runtime/repository";
import { loadAuthUser, requireProductSession } from "@/lib/product/session";
import { isOrganizationAdmin, shellCounts } from "@/lib/product/shell";
import {
  parseSidebar,
  parseTheme,
  SIDEBAR_COOKIE,
  THEME_COOKIE,
} from "@/lib/ui/preferences";

export const dynamic = "force-dynamic";

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function ProductLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Email sign-in and the GitHub button both return to /app. The button does
  // not record consent. A workspace is created only after the current AGB,
  // EULA, and privacy versions are stored. The OAuth request itself is unchanged.
  const authUser = await loadAuthUser();
  if (!authUser) redirect("/auth/sign-in");
  await ensureOsirusUser(authUser);
  if (!(await consentIsCurrent(authUser.id))) redirect("/consent");
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
