import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  getContactById,
  getContactStage,
  serializeContact,
} from "@/server/contacts";
import { upsertFicha } from "@/server/bot/ficha";
import { listAiNotes } from "@/server/contacts/notes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  const stageRow = await getContactStage(session.organizationId, id);
  const aiNotes = await listAiNotes(session.organizationId, id);
  return Response.json({
    contact: serializeContact(contact),
    stage: stageRow
      ? {
          id: stageRow.stage.id,
          name: stageRow.stage.name,
          position: stageRow.stage.position,
          kind: stageRow.stage.kind,
        }
      : null,
    lead: stageRow ? { id: stageRow.lead.id } : null,
    // Auditoría 2026-09-17 — hallazgos atómicos del agente (ver
    // server/contacts/notes.ts); NUNCA se mezclan con `contact.notes`.
    aiNotes: aiNotes.map((n) => ({
      id: n.id,
      text: n.text,
      status: n.status,
      scenario: n.scenario,
      createdAt: n.createdAt.toISOString(),
    })),
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(4000).nullable().optional(),
  archived: z.boolean().optional(),
  /**
   * Parche de la ficha: solo las claves que cambian. `null` borra una clave.
   * No es un reemplazo — el agente sigue escribiendo mientras el dueño
   * corrige, y mandar la ficha entera haría que el último en guardar le
   * borrara lo recién descubierto al otro.
   */
  ficha: z.record(z.unknown()).optional(),
  /**
   * Fase 4 — marca MANUAL de dato de prueba/sistema; `null` la quita. Nunca
   * se fija sola: solo llega aquí por una acción explícita del operador.
   */
  sampleType: z.enum(["demo", "system"]).nullable().optional(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  // La ficha va por su propia puerta —la MISMA que usa el cerebro externo en
  // `PUT /api/bot/ficha`— para heredar el merge y las cotas. Escribirla aquí
  // con un `set` plano sería un segundo camino con otras reglas.
  if (body.data.ficha !== undefined) {
    const res = await upsertFicha({
      organizationId: session.organizationId,
      contactId: id,
      ficha: body.data.ficha,
    });
    if (!res) return apiError(404, "not_found", "Contacto no encontrado");
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.name !== undefined) set.name = body.data.name;
  if (body.data.notes !== undefined) set.notes = body.data.notes;
  if (body.data.archived !== undefined) {
    set.archivedAt = body.data.archived ? new Date() : null;
  }
  if (body.data.sampleType !== undefined) set.sampleType = body.data.sampleType;

  const db = getDb();
  const updated = await db
    .update(schema.contact)
    .set(set)
    .where(
      scoped(
        schema.contact.organizationId,
        session.organizationId,
        eq(schema.contact.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Contacto no encontrado");
  return Response.json({ contact: serializeContact(updated[0]) });
});
