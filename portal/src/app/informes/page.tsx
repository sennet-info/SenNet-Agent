import EmbeddedApp from "@/components/EmbeddedApp";

export default function InformesPage() {
  return (
    <EmbeddedApp
      title="Informes"
      subtitle="Agente SenNet"
      src="/agent/"
      healthUrl="/api/agent-health"
      reloadable
    />
  );
}
