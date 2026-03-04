export const ROLE_OPTIONS = [
  "consumption",
  "generation",
  "storage",
  "meter_fluids",
  "meter_people",
  "environmental",
] as const;

export const ROLE_LABELS: Record<string, string> = {
  consumption: "🔌 Consumo",
  generation: "🌞 Generación",
  storage: "🔋 Batería",
  meter_fluids: "💧 Agua/Gas",
  meter_people: "👥 Personas",
  environmental: "🌡️ Sensor",
};
