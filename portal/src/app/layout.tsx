import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, BellRing, FileText } from "lucide-react";

import "./globals.css";

export const metadata: Metadata = {
  title: "SenNet Portal",
  description: "Portal corporativo para dashboards e informes",
};

const navItems = [
  {
    name: "Dashboards",
    href: "/chronograf/",
    icon: BarChart3,
  },
  {
    name: "Informes",
    href: "/informes",
    icon: FileText,
  },
  {
    name: "Alertas",
    href: "/alertas",
    icon: BellRing,
  },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body>
        <div className="min-h-screen bg-slate-950 text-slate-100">
          <div className="mx-auto flex min-h-screen w-full max-w-[1600px]">
            <aside className="w-72 border-r border-slate-800 bg-slate-900/80 p-6 backdrop-blur">
              <div className="mb-8">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">SenNet</p>
                <h1 className="mt-2 text-xl font-semibold text-slate-100">Portal</h1>
              </div>

              <nav className="space-y-2">
                {navItems.map(({ name, href, icon: Icon }) => (
                  <Link
                    key={name}
                    href={href}
                    className="flex items-center gap-3 rounded-lg border border-transparent px-4 py-3 text-sm text-slate-300 transition hover:border-slate-700 hover:bg-slate-800 hover:text-slate-100"
                  >
                    <Icon className="h-4 w-4" />
                    {name}
                  </Link>
                ))}
              </nav>
            </aside>

            <main className="flex-1 p-8 md:p-10">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
