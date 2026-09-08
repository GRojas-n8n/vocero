import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";

/**
 * Meta a veces nunca manda el webhook de estado de un saliente (silencioso,
 * sin error visible): el mensaje ya tiene `wa_message_id` — Graph lo aceptó —
 * pero se queda con el reloj de `pending` puesto para siempre. Este sweeper
 * lo cierra: pasado el umbral, lo sube a `sent` (último estado confirmado).
 */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const STUCK_THRESHOLD_MS = 30 * 60 * 1000;

const globalForSweeper = globalThis as unknown as {
  __pendingMessageSweeper?: ReturnType<typeof setInterval>;
};

/** Idempotente: el hot-reload de Next en dev puede reimportar el módulo. */
export function startPendingMessageSweeper(): void {
  if (globalForSweeper.__pendingMessageSweeper) return;
  globalForSweeper.__pendingMessageSweeper = setInterval(() => {
    void runSweep();
  }, SWEEP_INTERVAL_MS);
  void runSweep();
}

async function runSweep(): Promise<void> {
  try {
    const count = await sweepPendingMessages();
    if (count > 0) {
      console.log(`[sweeper] ${count} mensaje(s) pendiente(s) recuperado(s) a 'sent'`);
    }
  } catch (err) {
    console.error("[sweeper] falló el barrido de mensajes pendientes:", err);
  }
}

export async function sweepPendingMessages(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
  const stuck = await db
    .select({
      id: schema.message.id,
      organizationId: schema.message.organizationId,
      conversationId: schema.message.conversationId,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.direction, "out"),
        eq(schema.message.status, "pending"),
        isNotNull(schema.message.waMessageId),
        lt(schema.message.createdAt, cutoff)
      )
    );

  let recovered = 0;
  for (const m of stuck) {
    // Guard status='pending' en el UPDATE (no solo en el SELECT): si un
    // webhook real llegó entre medio y ya avanzó el estado, este barrido no
    // debe pisarlo de vuelta a 'sent' (estados monotónicos, Constitución IV).
    const updated = await db
      .update(schema.message)
      .set({ status: "sent" })
      .where(and(eq(schema.message.id, m.id), eq(schema.message.status, "pending")))
      .returning({ id: schema.message.id });
    if (updated.length === 0) continue;
    recovered++;
    publish(m.organizationId, {
      type: "message.status",
      data: {
        conversationId: m.conversationId,
        messageId: m.id,
        status: "sent",
        error: null,
      },
    });
  }
  return recovered;
}
