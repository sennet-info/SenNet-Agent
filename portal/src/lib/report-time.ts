export type ReportRangeMode = "last_n_days" | "month_to_date" | "previous_full_month" | "custom";

export const REPORT_RANGE_LABELS: Record<ReportRangeMode, string> = {
  last_n_days: "Últimos N días",
  month_to_date: "Mes en curso",
  previous_full_month: "Último mes cerrado",
  custom: "Personalizado",
};

export type ReportRangeInput = {
  mode: ReportRangeMode;
  lastDays: number;
  customStart?: string;
  customEnd?: string;
  now?: Date;
};

export type ResolvedReportRange = {
  range_mode: ReportRangeMode;
  start_dt: string;
  end_dt: string;
  range_flux: string;
  range_label: string;
  timezone: string;
  criteria: Record<string, unknown>;
  adjusted: boolean;
};

function atStartOfDay(value: string) {
  return new Date(`${value}T00:00:00`);
}

function atEndOfDay(value: string) {
  return new Date(`${value}T23:59:59`);
}

function startOfMonth(reference: Date) {
  const start = new Date(reference);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

export function resolveReportRange(input: ReportRangeInput): ResolvedReportRange {
  const reference = input.now ?? new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  if (input.mode === "custom") {
    if (!input.customStart || !input.customEnd) throw new Error("Debes informar fecha inicio y fin.");
    const start = atStartOfDay(input.customStart);
    const end = atEndOfDay(input.customEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("Fechas inválidas.");
    if (start > end) throw new Error("La fecha de inicio no puede ser posterior al fin.");
    if (end > reference) throw new Error("No se permiten periodos futuros.");
    return {
      range_mode: "custom",
      start_dt: start.toISOString(),
      end_dt: end.toISOString(),
      range_flux: "custom",
      range_label: REPORT_RANGE_LABELS.custom,
      timezone,
      criteria: { source: "custom_dates" },
      adjusted: false,
    };
  }

  if (input.mode === "month_to_date") {
    const start = startOfMonth(reference);
    return {
      range_mode: "month_to_date",
      start_dt: start.toISOString(),
      end_dt: reference.toISOString(),
      range_flux: "month_to_date",
      range_label: "Mes en curso (día 1 a ahora)",
      timezone,
      criteria: { semantic: "month_to_date" },
      adjusted: false,
    };
  }

  if (input.mode === "previous_full_month") {
    const currentMonthStart = startOfMonth(reference);
    const previousMonthEnd = new Date(currentMonthStart.getTime() - 1000);
    const previousMonthStart = startOfMonth(previousMonthEnd);
    return {
      range_mode: "previous_full_month",
      start_dt: previousMonthStart.toISOString(),
      end_dt: previousMonthEnd.toISOString(),
      range_flux: "previous_full_month",
      range_label: "Último mes cerrado (mes anterior completo)",
      timezone,
      criteria: { semantic: "previous_full_month" },
      adjusted: false,
    };
  }

  const safeDays = Number.isFinite(input.lastDays) && input.lastDays > 0 ? Math.floor(input.lastDays) : 7;
  const end = reference;
  const start = new Date(end.getTime() - safeDays * 24 * 60 * 60 * 1000);
  return {
    range_mode: "last_n_days",
    start_dt: start.toISOString(),
    end_dt: end.toISOString(),
    range_flux: `${safeDays}d`,
    range_label: `Últimos ${safeDays} días`,
    timezone,
    criteria: { days: safeDays },
    adjusted: safeDays !== input.lastDays,
  };
}
