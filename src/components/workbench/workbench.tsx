"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { X } from "lucide-react";
import dynamic from "next/dynamic";
import { useSyncExternalStore, type ReactNode } from "react";
import type { RunSnapshot } from "@/lib/runtime/types";
import type { RunView } from "@/lib/ui/run-view";
import { visibleGroups, type WorkbenchTab } from "@/lib/ui/workbench-view";
import { Badge } from "../ui/badge";
import { IconButton } from "../ui/icon-button";
import { Sheet } from "../ui/sheet";
import {
  ActivityPanel,
  ArtifactsPanel,
  MemoryPanel,
  PlanPanel,
  SkillsPanel,
  ToolsPanel,
  VerificationPanel,
  WorkersPanel,
} from "./panels/run-panels";
import { Resizer } from "./resizer";

// The workbench: run details grouped as Run, Build, Knowledge and System,
// showing only the views the run has data for. Docked beside the chat on wide
// screens; a sheet on narrower ones.

const WorkspacePanel = dynamic(
  () =>
    import("./panels/workspace-panel").then((module) => module.WorkspacePanel),
  { loading: () => <div className="wb-loading">Loading workspace…</div> },
);
const ResearchPanel = dynamic(
  () =>
    import("./panels/research-panel").then((module) => module.ResearchPanel),
  { loading: () => <div className="wb-loading">Loading sources…</div> },
);

const WIDE = "(min-width: 1280px)";

function subscribe(callback: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function useWideLayout() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

function Panel({
  tab,
  snapshot,
  view,
  onRefresh,
}: {
  tab: WorkbenchTab;
  snapshot: RunSnapshot;
  view: RunView;
  onRefresh: () => void;
}) {
  switch (tab) {
    case "activity":
      return <ActivityPanel view={view} />;
    case "plan":
      return <PlanPanel view={view} />;
    case "workers":
      return <WorkersPanel snapshot={snapshot} />;
    case "files":
    case "diff":
    case "terminal":
    case "preview":
      return (
        <WorkspacePanel runId={snapshot.run.id} tab={tab} live={view.live} />
      );
    case "research":
      return <ResearchPanel runId={snapshot.run.id} live={view.live} />;
    case "memory":
      return <MemoryPanel snapshot={snapshot} />;
    case "artifacts":
      return <ArtifactsPanel snapshot={snapshot} onRefresh={onRefresh} />;
    case "skills":
      return <SkillsPanel snapshot={snapshot} />;
    case "tools":
      return <ToolsPanel snapshot={snapshot} />;
    case "verification":
      return <VerificationPanel snapshot={snapshot} />;
  }
}

function WorkbenchBody({
  snapshot,
  view,
  tab,
  onTab,
  onRefresh,
}: {
  snapshot: RunSnapshot;
  view: RunView;
  tab: WorkbenchTab;
  onTab: (tab: WorkbenchTab) => void;
  onRefresh: () => void;
}) {
  const groups = visibleGroups(snapshot);
  const activeGroup =
    groups.find((group) => group.tabs.some((item) => item.id === tab)) ??
    groups[0];
  const activeTab = activeGroup?.tabs.some((item) => item.id === tab)
    ? tab
    : (activeGroup?.tabs[0]?.id ?? "activity");

  return (
    <div className="wb-body">
      <BaseTabs.Root
        value={activeGroup?.id ?? "run"}
        onValueChange={(value) => {
          const group = groups.find((item) => item.id === value);
          if (group) onTab(group.tabs[0]!.id);
        }}
      >
        <BaseTabs.List className="wb-groups" aria-label="Workbench sections">
          {groups.map((group) => (
            <BaseTabs.Tab key={group.id} value={group.id} className="wb-group">
              {group.label}
            </BaseTabs.Tab>
          ))}
        </BaseTabs.List>
      </BaseTabs.Root>
      <BaseTabs.Root
        value={activeTab}
        onValueChange={(value) => onTab(value as WorkbenchTab)}
        className="wb-sub"
      >
        {activeGroup && activeGroup.tabs.length > 1 ? (
          <BaseTabs.List
            className="wb-tabs"
            aria-label={`${activeGroup.label} views`}
          >
            {activeGroup.tabs.map((item) => (
              <BaseTabs.Tab key={item.id} value={item.id} className="wb-tab">
                {item.label}
              </BaseTabs.Tab>
            ))}
          </BaseTabs.List>
        ) : null}
        <BaseTabs.Panel
          value={activeTab}
          className="wb-panel"
          keepMounted={false}
        >
          <Panel
            tab={activeTab}
            snapshot={snapshot}
            view={view}
            onRefresh={onRefresh}
          />
        </BaseTabs.Panel>
      </BaseTabs.Root>
    </div>
  );
}

export function Workbench({
  open,
  onOpenChange,
  snapshot,
  view,
  tab,
  onTab,
  onRefresh,
  width,
  onWidth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: RunSnapshot | null;
  view: RunView | null;
  tab: WorkbenchTab;
  onTab: (tab: WorkbenchTab) => void;
  onRefresh: () => void;
  width: number;
  onWidth: (width: number) => void;
}) {
  const wide = useWideLayout();
  if (!snapshot || !view) return null;
  const title: ReactNode = (
    <span className="wb-title">
      Run details <Badge tone={view.tone}>{view.statusLabel}</Badge>
    </span>
  );
  const body = (
    <WorkbenchBody
      snapshot={snapshot}
      view={view}
      tab={tab}
      onTab={onTab}
      onRefresh={onRefresh}
    />
  );

  if (!wide)
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        side="right"
        title="Run details"
      >
        {body}
      </Sheet>
    );
  if (!open) return null;
  return (
    <>
      <Resizer width={width} onWidth={onWidth} />
      <aside
        className="workbench"
        id="workbench"
        aria-label="Run details"
        style={{ width }}
      >
        <div className="wb-header">
          <h2 className="wb-heading-main">{title}</h2>
          <IconButton
            label="Close run details"
            icon={X}
            size="sm"
            onClick={() => onOpenChange(false)}
          />
        </div>
        {body}
      </aside>
    </>
  );
}
