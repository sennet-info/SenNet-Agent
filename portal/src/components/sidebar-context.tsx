"use client";

import { createContext, useContext, useMemo, useState } from "react";

type SidebarContextValue = {
  sidebarHidden: boolean;
  setSidebarHidden: (hidden: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [sidebarHidden, setSidebarHidden] = useState(false);

  const value = useMemo(
    () => ({
      sidebarHidden,
      setSidebarHidden,
      toggleSidebar: () => setSidebarHidden((prev) => !prev),
    }),
    [sidebarHidden],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within SidebarProvider");
  }

  return context;
}
