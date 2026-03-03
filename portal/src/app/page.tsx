import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const items = [
  {
    title: "Dashboards",
    description: "Visualiza métricas operativas en Chronograf.",
    href: "/dashboards",
    action: "Abrir Dashboards",
  },
  {
    title: "Informes",
    description: "Accede al módulo de informes y reportes en Streamlit.",
    href: "/informes",
    action: "Ver Informes",
  },
  {
    title: "Alertas",
    description: "Consulta estado y evolución de alertas críticas.",
    href: "/alertas",
    action: "Ver Alertas",
  },
];

export default function Home() {
  return (
    <section>
      <h2 className="text-3xl font-semibold tracking-tight">Portal SenNet</h2>
      <p className="mt-2 text-slate-300">Selecciona un módulo para comenzar.</p>

      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Card key={item.title} className="flex h-full flex-col">
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
              <CardDescription className="mt-2">{item.description}</CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <Link href={item.href} className={buttonVariants({ className: "w-full" })}>
                {item.action}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
