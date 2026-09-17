import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  DEFAULT_CONNECTOR,
  isConnectorId,
  type ConnectorId,
} from "@/lib/agenda-connectors";
import {
  isValidInterval,
  isValidTimeZone,
  WEEKDAYS,
  type Interval,
  type WeekdayKey,
} from "@/lib/time/slots";

/**
 * 015 — La configuración de la agenda del negocio (una por organización):
 * lectura con defaults y upsert normalizado.
 */

export type WeeklyHours = Partial<Record<WeekdayKey, Interval[]>>;

export const DEFAULT_TIMEZONE = "America/Mexico_City";

/**
 * Título de invitación de esta instancia cuando el negocio no configuró el
 * suyo. Separado a propósito del nombre de marca del CRM (white-label): una
 * cosa es cómo se llama el panel, otra el texto que ve un prospecto ajeno al
 * CRM en su calendario.
 */
export const DEFAULT_APPOINTMENT_TITLE = "Llamada inicial | Más Impulso Digital";

/** L-V 09:00-18:00 — se ajusta en Ajustes → Agenda. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
};

export type CalendarSettings = {
  weeklyHours: WeeklyHours;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  timezone: string;
  /** Cómo se entrega la reunión. */
  connector: ConnectorId;
  /** Sala fija del conector `enlace-fijo`; null ⇒ citas sin link. */
  meetingLink: string | null;
  /** Ya resuelto: nunca vacío — cae a `DEFAULT_APPOINTMENT_TITLE`. */
  appointmentTitle: string;
};

/** Lo que ve una instancia recién encendida: útil sin configurar nada. */
export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  weeklyHours: DEFAULT_WEEKLY_HOURS,
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 2,
  maxDaysAhead: 7,
  timezone: DEFAULT_TIMEZONE,
  connector: DEFAULT_CONNECTOR,
  meetingLink: null,
  appointmentTitle: DEFAULT_APPOINTMENT_TITLE,
};

export const LIMITS = {
  slotMinutes: { min: 10, max: 240 },
  bufferMinutes: { min: 0, max: 120 },
  minNoticeHours: { min: 0, max: 72 },
  maxDaysAhead: { min: 1, max: 60 },
} as const;

export async function getSettings(
  organizationId: string
): Promise<CalendarSettings> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.calendarSettings)
    .where(scoped(schema.calendarSettings.organizationId, organizationId))
    .limit(1);

  const row = rows[0];
  // Sin fila: la instancia recién encendida ya es usable.
  if (!row) return DEFAULT_CALENDAR_SETTINGS;
  return mapRow(row);
}

export class CalendarSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarSettingsError";
  }
}

/**
 * Lo que llega de fuera, antes de normalizar: el horario y el conector vienen
 * sueltos porque su validación vive AQUÍ. Si el tipo estricto se exigiera en la
 * ruta, cada llamador tendría que hacer un cast — y un cast es justamente la
 * comprobación que no ocurre.
 */
export type CalendarSettingsInput = Partial<
  Omit<CalendarSettings, "weeklyHours" | "connector" | "appointmentTitle">
> & {
  weeklyHours?: unknown;
  connector?: string;
  /** `null`/vacío ⇒ vuelve a `DEFAULT_APPOINTMENT_TITLE`. */
  appointmentTitle?: string | null;
};

/** Fila cruda → `CalendarSettings`; misma normalización que `getSettings`. */
function mapRow(row: typeof schema.calendarSettings.$inferSelect): CalendarSettings {
  return {
    weeklyHours: normalizeWeeklyHours(row.weeklyHours as WeeklyHours),
    slotMinutes: row.slotMinutes,
    bufferMinutes: row.bufferMinutes,
    minNoticeHours: row.minNoticeHours,
    maxDaysAhead: row.maxDaysAhead,
    timezone: row.timezone,
    // Un conector que ya no existe en el código (p. ej. venías de un fork) no
    // puede dejar la agenda inservible: se degrada al soberano.
    connector: isConnectorId(row.connector) ? row.connector : DEFAULT_CONNECTOR,
    meetingLink: row.meetingLink,
    appointmentTitle: row.appointmentTitle?.trim() || DEFAULT_APPOINTMENT_TITLE,
  };
}

/**
 * Lee y escribe dentro de LA MISMA transacción, con `FOR UPDATE` sobre la
 * fila existente: dos guardados simultáneos (p. ej. dos pestañas de Ajustes)
 * ya no pueden pisarse campos entre sí — el segundo espera a que el primero
 * suelte el lock y parte de ESE resultado, no de una lectura obsoleta.
 */
export async function upsertSettings(
  organizationId: string,
  input: CalendarSettingsInput
): Promise<CalendarSettings> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.calendarSettings)
      .where(scoped(schema.calendarSettings.organizationId, organizationId))
      .for("update")
      .limit(1);
    const current = rows[0] ? mapRow(rows[0]) : DEFAULT_CALENDAR_SETTINGS;
    // Crudo (nullable), NO el ya resuelto de `current`: si guardáramos el
    // default resuelto en cada save, un negocio que nunca tocó el título
    // quedaría congelado en el default del día de su primer guardado de
    // horario — y un cambio futuro al default dejaría de alcanzarlo.
    const currentTitleRaw = rows[0]?.appointmentTitle ?? null;

    const timezone = input.timezone ?? current.timezone;
    // Una zona desconocida rompería el motor entero: se rechaza al guardar.
    if (!isValidTimeZone(timezone)) {
      throw new CalendarSettingsError(`Zona horaria desconocida: ${timezone}`);
    }

    const connector = input.connector ?? current.connector;
    if (!isConnectorId(connector)) {
      throw new CalendarSettingsError(`Conector desconocido: ${connector}`);
    }

    const appointmentTitleRaw = normalizeTitle(
      input.appointmentTitle !== undefined
        ? input.appointmentTitle
        : currentTitleRaw
    );

    const next: CalendarSettings = {
      weeklyHours: normalizeWeeklyHours(
        input.weeklyHours !== undefined ? input.weeklyHours : current.weeklyHours
      ),
      slotMinutes: clampInt(
        input.slotMinutes ?? current.slotMinutes,
        LIMITS.slotMinutes.min,
        LIMITS.slotMinutes.max
      ),
      bufferMinutes: clampInt(
        input.bufferMinutes ?? current.bufferMinutes,
        LIMITS.bufferMinutes.min,
        LIMITS.bufferMinutes.max
      ),
      minNoticeHours: clampInt(
        input.minNoticeHours ?? current.minNoticeHours,
        LIMITS.minNoticeHours.min,
        LIMITS.minNoticeHours.max
      ),
      maxDaysAhead: clampInt(
        input.maxDaysAhead ?? current.maxDaysAhead,
        LIMITS.maxDaysAhead.min,
        LIMITS.maxDaysAhead.max
      ),
      timezone,
      connector,
      meetingLink: normalizeLink(
        input.meetingLink !== undefined ? input.meetingLink : current.meetingLink
      ),
      appointmentTitle: appointmentTitleRaw || DEFAULT_APPOINTMENT_TITLE,
    };

    const values = {
      weeklyHours: next.weeklyHours,
      slotMinutes: next.slotMinutes,
      bufferMinutes: next.bufferMinutes,
      minNoticeHours: next.minNoticeHours,
      maxDaysAhead: next.maxDaysAhead,
      timezone: next.timezone,
      connector: next.connector,
      meetingLink: next.meetingLink,
      appointmentTitle: appointmentTitleRaw,
    };
    await tx
      .insert(schema.calendarSettings)
      .values({
        id: newId("calendarSettings"),
        organizationId,
        ...values,
      })
      .onConflictDoUpdate({
        target: schema.calendarSettings.organizationId,
        set: { ...values, updatedAt: new Date() },
      });

    return next;
  });
}

/**
 * Descarta intervalos inválidos y días vacíos (día cerrado) y ordena por hora
 * de inicio. Se prefiere limpiar a rechazar: un día mal escrito no debe tumbar
 * el guardado completo del horario.
 */
export function normalizeWeeklyHours(input: unknown): WeeklyHours {
  const out: WeeklyHours = {};
  if (typeof input !== "object" || input === null) return out;
  const source = input as Record<string, unknown>;
  for (const day of WEEKDAYS) {
    const intervals = source[day];
    if (!Array.isArray(intervals)) continue;
    const valid = intervals
      .filter(isValidInterval)
      .sort((a, b) => a.start.localeCompare(b.start));
    if (valid.length > 0) out[day] = valid;
  }
  return out;
}

/** Cadena vacía o espacios ⇒ null (el campo es opcional de verdad). */
function normalizeLink(link: string | null | undefined): string | null {
  const trimmed = (link ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Cadena vacía o espacios ⇒ null (sin personalizar ⇒ cae a `DEFAULT_APPOINTMENT_TITLE`). */
function normalizeTitle(title: string | null | undefined): string | null {
  const trimmed = (title ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
