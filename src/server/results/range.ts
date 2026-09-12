import type { DateRange, RangePreset } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** yyyy-mm-dd de un Date, en UTC. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resuelve un preset (o un rango `custom` explícito) a fechas concretas.
 *
 * Simplificación deliberada v1: los límites de "este mes" / "mes pasado" se
 * calculan en UTC, no en el timezone del negocio. `calendar_settings.timezone`
 * pertenece a la agenda (bandera `AGENDA`) y Resultados es una vista core que
 * no depende de que esa bandera esté encendida — acoplarlas sería peor que el
 * desvío de unas horas en el borde del mes.
 */
export function resolveRange(
  preset: RangePreset,
  customFrom: string | null,
  customTo: string | null,
  now: Date = new Date()
): DateRange {
  const today = isoDate(now);

  if (preset === "custom") {
    const from = customFrom && ISO_DATE.test(customFrom) ? customFrom : today;
    const to = customTo && ISO_DATE.test(customTo) ? customTo : today;
    return { preset, from: from <= to ? from : to, to: from <= to ? to : from };
  }

  if (preset === "this_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { preset, from: isoDate(start), to: today };
  }

  if (preset === "last_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { preset, from: isoDate(start), to: isoDate(end) };
  }

  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { preset, from: isoDate(start), to: today };
}

/** Límites UTC [from 00:00:00, to 23:59:59.999] para un WHERE `BETWEEN`. */
export function rangeBounds(range: DateRange): { start: Date; end: Date } {
  return {
    start: new Date(`${range.from}T00:00:00.000Z`),
    end: new Date(`${range.to}T23:59:59.999Z`),
  };
}
