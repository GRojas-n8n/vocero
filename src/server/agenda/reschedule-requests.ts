import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Auditoría 2026-09-17 — la memoria de "este contacto pidió mover su cita",
 * como estado persistente (`booking_change_request`), no como algo que vive
 * solo en el prompt o en el juicio del modelo del turno actual.
 *
 * Ver el comentario de la tabla en `lib/db/schema.ts` para el porqué. Este
 * módulo es la única puerta de escritura, igual que `agenda/offers.ts` lo es
 * para lo ofrecido.
 */

type ChangeRequestRow = typeof schema.bookingChangeRequest.$inferSelect;

/**
 * Registra la solicitud. IDEMPOTENTE por (organización, contacto): si ya
 * había una pendiente, esta llamada NO crea una segunda — el índice único
 * parcial la rechaza y aquí se traduce en "devolver la que ya existía", no en
 * un error. Un reintento del mismo turno, o el mismo pedido repetido en
 * mensajes distintos, no debe multiplicar filas.
 */
export async function requestReschedule(input: {
  organizationId: string;
  contactId: string;
  conversationId?: string | null;
  originalBookingId?: string | null;
  note?: string | null;
}): Promise<{ created: boolean; request: ChangeRequestRow }> {
  const db = getDb();
  try {
    const inserted = await db
      .insert(schema.bookingChangeRequest)
      .values({
        id: newId("bookingChangeRequest"),
        organizationId: input.organizationId,
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        originalBookingId: input.originalBookingId ?? null,
        note: input.note?.trim() || null,
      })
      .returning();
    return { created: true, request: inserted[0]! };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await getPendingRescheduleRequest(
      input.organizationId,
      input.contactId
    );
    if (existing) return { created: false, request: existing };
    // Carrera improbable: la fila que chocó ya se resolvió entre el insert
    // fallido y este re-lectura. Reintentar una vez basta.
    const inserted = await db
      .insert(schema.bookingChangeRequest)
      .values({
        id: newId("bookingChangeRequest"),
        organizationId: input.organizationId,
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        originalBookingId: input.originalBookingId ?? null,
        note: input.note?.trim() || null,
      })
      .returning();
    return { created: true, request: inserted[0]! };
  }
}

export async function getPendingRescheduleRequest(
  organizationId: string,
  contactId: string
): Promise<ChangeRequestRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.bookingChangeRequest)
    .where(
      scoped(
        schema.bookingChangeRequest.organizationId,
        organizationId,
        and(
          eq(schema.bookingChangeRequest.contactId, contactId),
          eq(schema.bookingChangeRequest.status, "pending")
        )
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Resuelve TODA solicitud pendiente del contacto. Se llama tras un
 * reprogramar real (`rescheduleBooking`), que es el único desenlace que de
 * verdad atiende el pedido — nunca se marca resuelta por inferencia del
 * modelo ni porque la conversación cambió de tema.
 */
export async function resolvePendingRescheduleRequests(
  organizationId: string,
  contactId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.bookingChangeRequest)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(
      scoped(
        schema.bookingChangeRequest.organizationId,
        organizationId,
        and(
          eq(schema.bookingChangeRequest.contactId, contactId),
          eq(schema.bookingChangeRequest.status, "pending")
        )
      )
    );
}

/** 23505 = unique_violation de Postgres (mismo criterio que agenda/service.ts). */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (code === "23505") return true;
  const cause = (err as { cause?: unknown }).cause;
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { code?: unknown }).code === "23505"
  );
}
