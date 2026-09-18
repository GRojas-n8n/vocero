import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Auditoría 2026-09-17 (incidente GRojas/Más Impulso) — puerta ÚNICA por la
 * que el agente de IA registra lo que aprende de un contacto real.
 *
 * Reemplaza `appendLeadNote` (pipeline.ts), que concatenaba `[IA] {nota}` sin
 * fin al `contact.notes` de texto libre: diez turnos producían diez párrafos
 * acumulativos, mezclando giros de negocio incompatibles y presentando
 * inferencias como hechos, todo en el mismo campo que el dueño edita a mano.
 *
 * Este módulo NUNCA toca `contact.notes` — ese campo es 100% del dueño desde
 * ahora. Cada hallazgo del agente es una fila atómica en `contact_note`, con
 * origen (mensaje), estado de confirmación y deduplicación real.
 */

/** Un hecho por turno, no un resumen: obliga al modelo a ser específico. */
export const MAX_NOTE_LEN = 300;
export const MAX_SCENARIO_LEN = 80;

export type NoteStatus = "confirmed" | "test" | "conflict";

/** Normaliza para comparar/hashear: espacios y mayúsculas no deben crear
 *  "hechos" distintos del mismo hecho. */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Determinístico: mismo texto (normalizado) para el mismo contacto → mismo
 *  hash → la UNIQUE de `contact_note` descarta el duplicado en silencio. */
export function hashNoteText(text: string): string {
  return createHash("sha256").update(normalize(text)).digest("hex");
}

/**
 * true si hay un escenario YA establecido para el contacto y el nuevo difiere
 * (comparación normalizada). Con cualquiera de los dos en null, no hay
 * choque que declarar — falta información, no hay conflicto confirmado.
 */
export function scenarioConflicts(
  established: string | null,
  incoming: string | null
): boolean {
  if (!established || !incoming) return false;
  return normalize(established) !== normalize(incoming);
}

export type RecordAiNoteInput = {
  organizationId: string;
  contactId: string;
  /** El hecho tal cual lo dijo el cliente, NUNCA un resumen acumulado. */
  note: string;
  /** Giro/tema breve que declaró el turno (p. ej. "plomería"), si lo hizo. */
  scenario?: string | null;
  /** true si la conversación es del Laboratorio (`conversation.is_test`). */
  isTest: boolean;
  /** Mensaje entrante que originó esta nota, para trazabilidad. */
  sourceMessageId?: string | null;
};

export type RecordAiNoteResult = {
  status: NoteStatus;
  /** true si el hecho ya existía (misma fila, no se insertó de nuevo). */
  deduped: boolean;
} | null;

/**
 * Último escenario CONFIRMADO conocido para el contacto (el que compara
 * contra uno nuevo para detectar un giro incompatible). Ignora a propósito
 * las filas `test`/`conflict`: una prueba nunca "contamina" lo confirmado, y
 * un conflicto anterior tampoco se vuelve la nueva base de comparación.
 */
async function latestConfirmedScenario(
  organizationId: string,
  contactId: string
): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ scenario: schema.contactNote.scenario })
    .from(schema.contactNote)
    .where(
      scoped(
        schema.contactNote.organizationId,
        organizationId,
        and(
          eq(schema.contactNote.contactId, contactId),
          eq(schema.contactNote.status, "confirmed")
        )
      )
    )
    .orderBy(desc(schema.contactNote.createdAt))
    .limit(1);
  return rows[0]?.scenario ?? null;
}

/**
 * Registra UN hecho atómico del agente. Idempotente (dedup por hash) y sin
 * fusionar nunca dos giros de negocio bajo la misma etiqueta "confirmed".
 *
 * Devuelve `null` si no hay nada que guardar (nota vacía tras recortar).
 */
export async function recordAiNote(
  input: RecordAiNoteInput
): Promise<RecordAiNoteResult> {
  const text = input.note.trim().slice(0, MAX_NOTE_LEN);
  if (!text) return null;
  const scenario = input.scenario?.trim().slice(0, MAX_SCENARIO_LEN) || null;

  let status: NoteStatus = "confirmed";
  if (input.isTest) {
    status = "test";
  } else {
    const established = await latestConfirmedScenario(
      input.organizationId,
      input.contactId
    );
    if (scenarioConflicts(established, scenario)) status = "conflict";
  }

  const db = getDb();
  const inserted = await db
    .insert(schema.contactNote)
    .values({
      id: newId("contactNote"),
      organizationId: input.organizationId,
      contactId: input.contactId,
      source: "ai",
      status,
      scenario,
      text,
      contentHash: hashNoteText(text),
      sourceMessageId: input.sourceMessageId ?? null,
    })
    .onConflictDoNothing({
      target: [schema.contactNote.contactId, schema.contactNote.contentHash],
    })
    .returning({ id: schema.contactNote.id });

  return { status, deduped: inserted.length === 0 };
}

export type ContactNoteRow = typeof schema.contactNote.$inferSelect;

/** Lista de hallazgos del agente para el panel del contacto — de más nuevo a
 *  más viejo, igual que cualquier bitácora de auditoría. */
export async function listAiNotes(
  organizationId: string,
  contactId: string,
  limit = 50
): Promise<ContactNoteRow[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.contactNote)
    .where(
      scoped(
        schema.contactNote.organizationId,
        organizationId,
        eq(schema.contactNote.contactId, contactId)
      )
    )
    .orderBy(desc(schema.contactNote.createdAt))
    .limit(limit);
}
