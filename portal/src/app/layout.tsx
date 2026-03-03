import type { Metadata } from "next";

import { PortalLayoutShell } from "@/components/portal-layout-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "SenNet Portal",
  description: "Portal corporativo para dashboards e informes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="dark">
      <body>
        <PortalLayoutShell>{children}</PortalLayoutShell>
      </body>
    </html>
  );
}
