"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactNode } from "react";
import { completeTour } from "@/app/app/actions";
import { SidebarContent, Sidebar } from "../sidebar/sidebar";
import { Sheet } from "../ui/sheet";
import { OnboardingTour } from "./onboarding-tour";
import { ShellProvider, useShell, type ShellData } from "./shell-context";

function MobileNav() {
  const shell = useShell();
  return (
    <Sheet
      open={shell.navOpen}
      onOpenChange={shell.setNavOpen}
      side="left"
      title="Navigation"
    >
      <SidebarContent onNavigate={() => shell.setNavOpen(false)} />
    </Sheet>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const shell = useShell();
  return (
    <div className="app" data-sidebar={shell.sidebar}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar />
      <MobileNav />
      <div className="app-main" id="main" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

/**
 * The product frame: a collapsible sidebar on wide screens, a navigation
 * drawer on narrow ones, and the page in the main region.
 */
export function AppShell({
  data,
  children,
}: {
  data: ShellData;
  children: ReactNode;
}) {
  return (
    <ShellProvider data={data}>
      <Tooltip.Provider delay={400}>
        <Frame>{children}</Frame>
        {data.tour ? (
          <OnboardingTour
            initialOpen={data.tour.open}
            name={data.user.name?.trim().split(/\s+/)[0] || null}
            onDone={completeTour}
          />
        ) : null}
      </Tooltip.Provider>
    </ShellProvider>
  );
}
