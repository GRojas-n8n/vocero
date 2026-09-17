import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/**
 * Fase 6 (auditoría 2026-09) — historial y reversión del comportamiento de
 * Max: antes, "Guardar comportamiento" publicaba directo, sin vista previa
 * ni forma de volver atrás. Ver `agentProfileVersion` en schema.ts para el
 * diseño (pila de deshacer: cada fila es un estado que DEJÓ de ser vigente).
 *
 * Solo estos campos entran al historial — el toggle `enabled` es una acción
 * instantánea y reversible por sí sola (prender/apagar), no una "versión" de
 * instrucciones.
 */
export const BEHAVIOR_FIELDS = [
  "name",
  "tone",
  "instructions",
  "escalationRules",
  "greeting",
] as const;

export type BehaviorFields = Pick<
  typeof schema.agentProfile.$inferSelect,
  (typeof BEHAVIOR_FIELDS)[number]
>;

function pickBehavior(row: {
  name: string;
  tone: string | null;
  instructions: string | null;
  escalationRules: string | null;
  greeting: string | null;
}): BehaviorFields {
  return {
    name: row.name,
    tone: row.tone,
    instructions: row.instructions,
    escalationRules: row.escalationRules,
    greeting: row.greeting,
  };
}

function behaviorChanged(a: BehaviorFields, b: Partial<BehaviorFields>): boolean {
  return BEHAVIOR_FIELDS.some(
    (f) => f in b && b[f as keyof typeof b] !== a[f as keyof BehaviorFields]
  );
}

/**
 * Si `patch` de verdad cambia algún campo de comportamiento respecto al
 * `current` vigente, guarda `current` como una versión del historial ANTES
 * de que se pierda. Idempotente en el sentido de que un PATCH que no toca
 * nada de comportamiento (p. ej. solo `enabled`) no genera ruido en el
 * historial.
 */
export async function snapshotIfChanged(
  organizationId: string,
  current: {
    name: string;
    tone: string | null;
    instructions: string | null;
    escalationRules: string | null;
    greeting: string | null;
  },
  patch: Partial<BehaviorFields>,
  changedByUserId: string | null
): Promise<void> {
  const before = pickBehavior(current);
  if (!behaviorChanged(before, patch)) return;
  const db = getDb();
  await db.insert(schema.agentProfileVersion).values({
    id: newId("agentProfileVersion"),
    organizationId,
    ...before,
    changedByUserId,
  });
}

export async function listVersions(organizationId: string, limit = 20) {
  const db = getDb();
  return db
    .select({
      version: schema.agentProfileVersion,
      changedByName: schema.user.name,
    })
    .from(schema.agentProfileVersion)
    .leftJoin(
      schema.user,
      eq(schema.user.id, schema.agentProfileVersion.changedByUserId)
    )
    .where(
      scoped(schema.agentProfileVersion.organizationId, organizationId)
    )
    .orderBy(desc(schema.agentProfileVersion.createdAt))
    .limit(limit);
}

export class VersionNotFoundError extends Error {}

/**
 * Revierte el perfil vigente a una versión pasada. Guarda el estado ACTUAL
 * como una versión nueva antes de sobrescribirlo — revertir nunca destruye
 * nada, siempre es reversible a su vez.
 */
export async function restoreVersion(
  organizationId: string,
  versionId: string,
  changedByUserId: string | null
): Promise<void> {
  const db = getDb();
  const versionRows = await db
    .select()
    .from(schema.agentProfileVersion)
    .where(
      and(
        eq(schema.agentProfileVersion.id, versionId),
        eq(schema.agentProfileVersion.organizationId, organizationId)
      )
    )
    .limit(1);
  const version = versionRows[0];
  if (!version) throw new VersionNotFoundError("Versión no encontrada");

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(scoped(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const current = profileRows[0];
  if (!current) throw new VersionNotFoundError("Perfil no encontrado");

  await snapshotIfChanged(
    organizationId,
    current,
    pickBehavior(version),
    changedByUserId
  );

  await db
    .update(schema.agentProfile)
    .set({ ...pickBehavior(version), updatedAt: new Date() })
    .where(scoped(schema.agentProfile.organizationId, organizationId));
}
