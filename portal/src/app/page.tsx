import Link from "next/link";
import type { ComponentType } from "react";
import { BarChart3, BellRing, Cable, CalendarClock, Factory, FileText, Tags } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type HomeItem = {
  title: string;
  subtitle: string;
  description: string;
  href: string;
  action: string;
  badge: string;
  icon: ComponentType<{ className?: string }>;
};

const mainModules: HomeItem[] = [
  {
    title: "Dashboards",
    subtitle: "Monitoreo",
    description: "Visualiza métricas operativas y tendencias clave en tiempo real.",
    href: "/dashboards",
    action: "Abrir Dashboards",
    badge: "Operación",
    icon: BarChart3,
  },
  {
    title: "Informes",
    subtitle: "Operación",
    description: "Genera reportes consolidados para seguimiento y revisión diaria.",
    href: "/informes",
    action: "Abrir Informes",
    badge: "Nuevo",
    icon: FileText,
  },
  {
    title: "Alertas",
    subtitle: "Monitoreo",
    description: "Consulta eventos críticos y su evolución para actuar con rapidez.",
    href: "/alertas",
    action: "Abrir Alertas",
    badge: "Beta",
    icon: BellRing,
  },
];

const adminModules: HomeItem[] = [
  {
    title: "Conexiones",
    subtitle: "Administración",
    description: "Configura tenants y credenciales de integración del agente.",
    href: "/conexiones",
    action: "Administrar Conexiones",
    badge: "Admin",
    icon: Cable,
  },
  {
    title: "Inventario",
    subtitle: "Administración",
    description: "Gestiona dispositivos y asignación de roles operativos.",
    href: "/inventario",
    action: "Administrar Inventario",
    badge: "Admin",
    icon: Factory,
  },
  {
    title: "Programador",
    subtitle: "Herramientas",
    description: "Programa tareas y ejecuciones periódicas de automatización.",
    href: "/programador",
    action: "Abrir Programador",
    badge: "Soporte",
    icon: CalendarClock,
  },
  {
    title: "Tarifas por defecto",
    subtitle: "Administración",
    description: "Define tarifas energéticas por alcance: tenant, cliente, instalación y serial.",
    href: "/tarifas-default",
    action: "Administrar Tarifas",
    badge: "Admin",
    icon: Tags,
  },
];

export default function Home() {
  return (
    <section className="space-y-10">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight">Portal SenNet</h2>
        <p className="mt-2 text-slate-300">Accede a los módulos clave de operación y administración.</p>
      </div>

      <div className="space-y-5">
        <div>
          <h3 className="text-xl font-semibold text-slate-100">Módulos principales</h3>
          <p className="mt-1 text-sm text-slate-400">Operación y monitoreo de la plataforma.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {mainModules.map((item) => {
            const Icon = item.icon;

            return (
              <Card key={item.title} className="flex h-full flex-col border-slate-700 bg-slate-900/70">
                <CardHeader className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-2">
                      <Icon className="h-5 w-5 text-blue-300" />
                    </div>
                    <span className="rounded-full border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300">{item.badge}</span>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-400">{item.subtitle}</p>
                    <CardTitle className="mt-1 text-xl">{item.title}</CardTitle>
                  </div>
                  <CardDescription className="text-slate-300">{item.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Link href={item.href} className={buttonVariants({ className: "w-full" })}>
                    {item.action}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <div className="space-y-5">
        <div>
          <h3 className="text-xl font-semibold text-slate-100">Administración y herramientas</h3>
          <p className="mt-1 text-sm text-slate-400">Configuración y soporte del entorno SenNet.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {adminModules.map((item) => {
            const Icon = item.icon;

            return (
              <Card key={item.title} className="flex h-full flex-col border-slate-800 bg-slate-900/50">
                <CardHeader className="space-y-3 pb-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-slate-300" />
                      <CardTitle className="text-lg">{item.title}</CardTitle>
                    </div>
                    <span className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300">{item.badge}</span>
                  </div>
                  <p className="text-xs uppercase tracking-wider text-slate-500">{item.subtitle}</p>
                  <CardDescription className="text-slate-300">{item.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto pt-0">
                  <Link href={item.href} className={buttonVariants({ className: "w-full", variant: "secondary" })}>
                    {item.action}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
