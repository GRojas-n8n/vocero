import { addDaysISO } from "@/lib/time/slots";

/**
 * 025 — Interpretación DETERMINISTA de lo que el prospecto dijo: un día
 * («mañana», «lunes», «25 de septiembre») y una hora («11», «4 de la tarde»).
 *
 * El modelo pasa las palabras del prospecto tal cual; esto las resuelve. Es puro
 * (sin BD ni reloj implícito) para poder probarlo entero: la aritmética de
 * fechas y zonas horarias es justo lo que un LLM hace mal.
 */

export type DayResolution = { ok: true; dayIso: string } | { ok: false };

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTH_INDEX: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
  ene: 1,
  feb: 2,
  mar: 3,
  abr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  sep: 9,
  sept: 9,
  set: 9,
  oct: 10,
  nov: 11,
  dic: 12,
};

/** Minúsculas, sin acentos, sin puntuación de relleno ni artículos. */
export function normalizeExpression(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!,;]/g, " ")
    .replace(/\b(el|la|este|esta|proximo|proxima|para|del|dia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRealDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Día de la semana (0 = domingo) de una fecha ISO (aritmética de calendario). */
export function weekdayIndexOf(dayIso: string): number {
  return new Date(`${dayIso}T00:00:00Z`).getUTCDay();
}

/**
 * Resuelve la expresión de día contra «hoy» (ya en la zona del negocio).
 *
 * `lunes` es el PRÓXIMO lunes, nunca hoy: ofrecer hoy por error es peor que
 * pedir una fecha (la respuesta siempre nombra la fecha completa).
 */
export function resolveDayExpression(raw: string, todayIso: string): DayResolution {
  const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return isRealDate(+iso[1]!, +iso[2]!, +iso[3]!)
      ? { ok: true, dayIso: raw.trim() }
      : { ok: false };
  }

  const e = normalizeExpression(raw);
  if (!e) return { ok: false };

  if (e === "hoy" || e === "today") return { ok: true, dayIso: todayIso };
  if (e === "pasado manana" || e === "day after tomorrow") {
    return { ok: true, dayIso: addDaysISO(todayIso, 2) };
  }
  if (e === "manana" || e === "tomorrow") {
    return { ok: true, dayIso: addDaysISO(todayIso, 1) };
  }

  const weekday = WEEKDAY_INDEX[e];
  if (weekday !== undefined) {
    const diff = ((weekday - weekdayIndexOf(todayIso) + 7) % 7) || 7;
    return { ok: true, dayIso: addDaysISO(todayIso, diff) };
  }

  // «25 de septiembre», «25 sep», «25 septiembre 2026»
  const named = e.match(/^(\d{1,2})(?:\s+de)?\s+([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?$/);
  if (named) {
    const month = MONTH_INDEX[named[2]!];
    if (month) return fromDayMonth(+named[1]!, month, named[3] ? +named[3] : null, todayIso);
  }
  // «25/09», «25-09», «25/09/2026»
  const numeric = e.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
  if (numeric) {
    return fromDayMonth(+numeric[1]!, +numeric[2]!, numeric[3] ? +numeric[3] : null, todayIso);
  }
  return { ok: false };
}

function fromDayMonth(
  day: number,
  month: number,
  year: number | null,
  todayIso: string
): DayResolution {
  if (year !== null) {
    return isRealDate(year, month, day)
      ? { ok: true, dayIso: `${year}-${pad(month)}-${pad(day)}` }
      : { ok: false };
  }
  // Sin año: la próxima vez que esa fecha exista y no haya pasado (un 29 de
  // febrero salta hasta el siguiente bisiesto).
  const todayYear = +todayIso.slice(0, 4);
  for (let y = todayYear; y <= todayYear + 4; y++) {
    if (!isRealDate(y, month, day)) continue;
    const dayIso = `${y}-${pad(month)}-${pad(day)}`;
    if (dayIso >= todayIso) return { ok: true, dayIso };
  }
  return { ok: false };
}

/* ------------------------------------------------------------------ */
/* Horas                                                               */
/* ------------------------------------------------------------------ */

export type WallInterval = { start: string; end: string };

export type TimeReading = {
  /** Lecturas posibles como "HH:MM" (una, o dos si de verdad son ambiguas). */
  candidates: string[];
  /** La marca del prospecto no decidió entre las lecturas y ambas caen en horario. */
  ambiguous: boolean;
};

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};
const fromMinutes = (min: number): string => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** ¿Ese minuto del día cae dentro de algún intervalo hábil? (inicio incluido, fin excluido) */
export function withinIntervals(hhmm: string, intervals: WallInterval[]): boolean {
  const t = toMinutes(hhmm);
  return intervals.some((iv) => t >= toMinutes(iv.start) && t < toMinutes(iv.end));
}

/**
 * Lee una hora dicha por el prospecto. Devuelve `null` si no es una hora.
 *
 * Con marca explícita (`am`, `pm`, `de la tarde`, `24 h`) la lectura es única.
 * Sin marca, una hora de 1 a 11 puede ser de la mañana o de la tarde: se queda
 * con la lectura que cae DENTRO del horario del día; si ambas caen, devuelve las
 * dos (ambiguas); si ninguna, la más verosímil (1-7 → tarde, el resto → mañana)
 * para que quien responda pueda decir «fuera de horario» con la hora real.
 */
export function parseTimeReading(raw: string, intervals: WallInterval[]): TimeReading | null {
  const e = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¿?¡!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/\bmediodia\b/.test(e)) return { candidates: ["12:00"], ambiguous: false };
  if (/\bmedianoche\b/.test(e)) return { candidates: ["00:00"], ambiguous: false };

  const m = e.match(/(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?/);
  if (!m) return null;
  let hour = Number(m[1]);
  let minute = m[2] ? Number(m[2]) : 0;
  // «4 y media», «4 y cuarto», «4 menos cuarto»: se lee lo que dijo, no la hora en punto.
  if (!m[2]) {
    if (/\by media\b/.test(e)) minute = 30;
    else if (/\by cuarto\b/.test(e)) minute = 15;
    else if (/\bmenos cuarto\b/.test(e)) {
      minute = 45;
      hour = hour === 1 ? 12 : hour - 1;
    }
  }
  if (hour > 23 || minute > 59) return null;

  const pm = /\bp\.?\s?m\b|\bpm\b|\bde la tarde\b|\bpor la tarde\b|\bde la noche\b|\bpor la noche\b|\btarde\b|\bnoche\b/.test(e);
  const am = /\ba\.?\s?m\b|\bam\b|\bde la manana\b|\bpor la manana\b|\bmanana\b/.test(e);

  const at = (h: number) => `${pad(h)}:${pad(minute)}`;

  // Formato de 24 h o marca explícita.
  if (hour >= 13 || hour === 0) return { candidates: [at(hour)], ambiguous: false };
  if (pm && !am) return { candidates: [at(hour === 12 ? 12 : hour + 12)], ambiguous: false };
  if (am && !pm) return { candidates: [at(hour === 12 ? 0 : hour)], ambiguous: false };
  if (hour === 12) return { candidates: [at(12)], ambiguous: false };

  // 1..11 sin marca: ¿mañana o tarde? Lo decide el horario del día.
  const morning = at(hour);
  const afternoon = at(hour + 12);
  const inHours = [morning, afternoon].filter((c) => withinIntervals(c, intervals));
  if (inHours.length === 1) return { candidates: inHours, ambiguous: false };
  if (inHours.length === 2) return { candidates: inHours, ambiguous: true };
  return { candidates: [hour <= 7 ? afternoon : morning], ambiguous: false };
}

/** Minutos desde medianoche de un "HH:MM" (para comparar rangos). */
export function minutesOfDay(hhmm: string): number {
  return toMinutes(hhmm);
}

export { fromMinutes as hhmmFromMinutes };
