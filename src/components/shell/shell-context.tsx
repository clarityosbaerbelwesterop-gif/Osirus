"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ThemePreference } from "@/lib/ui/preferences";

export type SessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  pinnedAt?: string | null;
};

/** What the chat page lends the sidebar while it is mounted. */
export type ChatBinding = {
  activeSessionId: string | null;
  running: boolean;
  select: (session: SessionSummary) => void;
  newTask: () => void;
};

export type ShellData = {
  user: { name: string | null; email: string | null };
  workspaceName: string;
  sessions: SessionSummary[];
  counts: { inbox: number; approvals: number };
  isAdmin: boolean;
  sidebar: "expanded" | "collapsed";
  theme: ThemePreference;
};

type ShellValue = ShellData & {
  upsertSession: (session: SessionSummary) => void;
  setPinned: (id: string, pinned: boolean) => void;
  chat: ChatBinding | null;
  bindChat: (binding: ChatBinding | null) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  setSidebar: (state: "expanded" | "collapsed") => void;
};

const ShellContext = createContext<ShellValue | null>(null);

export function ShellProvider({
  data,
  children,
}: {
  data: ShellData;
  children: ReactNode;
}) {
  const [sessions, setSessions] = useState(data.sessions);
  const [chat, setChat] = useState<ChatBinding | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [sidebar, setSidebar] = useState(data.sidebar);

  const upsertSession = useCallback((session: SessionSummary) => {
    setSessions((current) => [
      { ...current.find((item) => item.id === session.id), ...session },
      ...current.filter((item) => item.id !== session.id),
    ]);
  }, []);

  const setPinned = useCallback((id: string, pinned: boolean) => {
    setSessions((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, pinnedAt: pinned ? new Date().toISOString() : null }
          : item,
      ),
    );
  }, []);

  const value = useMemo<ShellValue>(
    () => ({
      ...data,
      sessions,
      sidebar,
      upsertSession,
      setPinned,
      chat,
      bindChat: setChat,
      navOpen,
      setNavOpen,
      setSidebar,
    }),
    [data, sessions, sidebar, upsertSession, setPinned, chat, navOpen],
  );
  return (
    <ShellContext.Provider value={value}>{children}</ShellContext.Provider>
  );
}

export function useShell() {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside ShellProvider");
  return value;
}
