"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BellRing, Cable, CalendarClock, Factory, FileText, Home, Tags } from "lucide-react";

import { SidebarProvider, useSidebar } from "@/components/sidebar-context";

const navItems = [
  {
    name: "Inicio",
    href: "/",
    icon: Home,
  },
  {
    name: "Dashboards",
    href: "/dashboards",
    icon: BarChart3,
  },
  {
    name: "Informes",
    href: "/informes",
    icon: FileText,
  },
  {
    name: "Conexiones",
    href: "/conexiones",
    icon: Cable,
  },
  {
    name: "Inventario",
    href: "/inventario",
    icon: Factory,
  },
  {
    name: "Alertas",
    href: "/alertas",
    icon: BellRing,
  },
  {
    name: "Programador",
    href: "/programador",
    icon: CalendarClock,
  },
  {
    name: "Tarifas",
    href: "/tarifas-default",
    icon: Tags,
  },
];

const sectionLabels: Record<string, string> = {
  dashboards: "Dashboards",
  informes: "Informes",
  conexiones: "Conexiones",
  inventario: "Inventario",
  alertas: "Alertas",
  programador: "Programador",
  "tarifas-default": "Tarifas por defecto",
};

function ShellContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { sidebarHidden } = useSidebar();
  const isHome = pathname === "/";
  const currentSection = isHome
    ? "Inicio"
    : sectionLabels[pathname.split("/").filter(Boolean)[0] ?? ""] ?? "Sección";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex min-h-screen w-full" data-sidebar={sidebarHidden ? "hidden" : "visible"}>
        {!sidebarHidden && (
          <aside className="w-72 border-r border-slate-800 bg-slate-900/80 p-6 backdrop-blur">
            <div className="mb-8">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">SenNet</p>
              <h1 className="mt-2 text-xl font-semibold text-slate-100">Portal</h1>
            </div>

            <nav className="space-y-2">
              {navItems.map(({ name, href, icon: Icon }) => {
                const isActive = href === "/" ? pathname === "/" : pathname === href || pathname?.startsWith(`${href}/`);

                return (
                  <Link
                    key={name}
                    href={href}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm transition ${
                      isActive
                        ? "border-slate-600 bg-slate-800 text-slate-100"
                        : "border-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-800 hover:text-slate-100"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {name}
                  </Link>
                );
              })}
            </nav>
          </aside>
        )}

        <main className={`min-h-screen flex-1 ${sidebarHidden ? "p-3 md:p-4" : "p-6 md:p-8"}`}>
          <header className="mb-6 flex items-center justify-between border-b border-slate-800 pb-3 text-sm">
            <p className="text-slate-400">
              <span className="text-slate-500">Inicio</span>
              <span className="px-2 text-slate-600">/</span>
              <span className="text-slate-200">{currentSection}</span>
            </p>
            {!isHome && (
              <Link
                href="/"
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-slate-900"
              >
                Volver a inicio
              </Link>
            )}
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}

export function PortalLayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ShellContent>{children}</ShellContent>
    </SidebarProvider>
  );
}
