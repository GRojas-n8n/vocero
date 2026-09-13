import { addDaysISO, todayInTz, zonedWallClockToUtc } from "@/lib/time/slots";
import type { DateRange, RangePreset } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resuelve un preset (o un rango `custom` explícito) a fechas concretas, en
 * la zona horaria del negocio (`calendar_settings.timezone`, con default
 * `America/Mexico_City`). "Hoy", "este mes" y "mes pasado" son conceptos de
 * calendario de PARED — calcularlos en UTC corre el borde del mes/día unas
 * horas, lo que en la práctica mete o saca movimientos reales del reporte.
 */
export function resolveRange(
  preset: RangePreset,
  customFrom: string | null,
  customTo: string | null,
  tz: string,
  now: Date = new Date()
): DateRange {
  const today = todayInTz(now, tz);

  if (preset === "custom") {
    const from = customFrom && ISO_DATE.test(customFrom) ? customFrom : today;
    const to = customTo && ISO_DATE.test(customTo) ? customTo : today;
    return { preset, from: from <= to ? from : to, to: from <= to ? to : from };
  }

  if (preset === "this_month") {
    const start = `${today.slice(0, 7)}-01`;
    return { preset, from: start, to: today };
  }

  if (preset === "last_month") {
    const [y, m] = today.split("-").map(Number) as [number, number];
    // Día 0 del mes actual (UTC, aritmética de calendario pura) = último día del mes pasado.
    const lastMonthEnd = new Date(Date.UTC(y, m - 1, 0));
    const lastMonthStart = new Date(Date.UTC(y, m - 2, 1));
    return {
      preset,
      from: lastMonthStart.toISOString().slice(0, 10),
      to: lastMonthEnd.toISOString().slice(0, 10),
    };
  }

  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  return { preset, from: addDaysISO(today, -(days - 1)), to: today };
}

/**
 * Límites UTC [00:00 del `from`, 00:00 del día siguiente a `to`) en la zona
 * del negocio, para un WHERE `>= start AND < ... `/`<= end`. Si la zona
 * resultara inválida (no debería: `upsertSettings` la valida al guardar) cae
 * a un límite UTC simple en vez de tronar el reporte.
 */
export function rangeBounds(range: DateRange, tz: string): { start: Date; end: Date } {
  const start = zonedWallClockToUtc(range.from, "00:00", tz);
  const nextDayStart = zonedWallClockToUtc(addDaysISO(range.to, 1), "00:00", tz);
  return {
    start: start ?? new Date(`${range.from}T00:00:00.000Z`),
    end: nextDayStart
      ? new Date(nextDayStart.getTime() - 1)
      : new Date(`${range.to}T23:59:59.999Z`),
  };
}
