import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  getProject,
  milestoneBelongsToProject,
  type MilestoneStatus,
  type ProjectDetail,
  type ProjectStatus,
} from "@/server/projects/queries";

/**
 * 021 — Proyectos e hitos.
 *
 * El camino normal de alta NO es manual: nace dentro de la transacción que
 * acepta una cotización (`createProjectFromQuote`, llamada desde
 * `src/server/quotes/service.ts`). Los 4 hitos son fijos — el flujo de
 * entrega de la agencia es siempre el mismo, así que no hay formulario para
 * inventarlos.
 */

export class ProjectError extends Error {
  constructor(
    public code: "not_found" | "invalid",
    message: string
  ) {
    super(message);
    this.name = "ProjectError";
  }
}

/** Los 4 hitos con los que nace todo proyecto de la agencia, en orden. */
export const DEFAULT_MILESTONES: readonly string[] = [
  "Recopilación de accesos y materiales",
  "Desarrollo en entorno de Staging / Coolify",
  "Revisión y ajustes del cliente",
  "Lanzamiento en Producción",
];

type Db = ReturnType<typeof getDb>;
/** Extrae el tipo de la transacción del propio `db.transaction`, así este
 *  módulo acepta tanto `getDb()` como un `tx` sin importar contra qué
 *  versión de drizzle-orm se compare — evita repetir sus genéricos aquí. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Crea el proyecto y sus 4 hitos por defecto para una cotización recién
 * aceptada. Recibe `db` para poder correr DENTRO de la misma transacción que
 * cambia el estado de la cotización (`quotes/service.ts`): si algo de esto
 * fallara, la cotización tampoco debe quedar "aceptada" a medias.
 */
export async function createProjectFromQuote(
  db: Db | Tx,
  input: {
    organizationId: string;
    leadId: string;
    quoteId: string;
    contactName: string;
    budgetCents: number;
    currency: string;
  }
): Promise<void> {
  const projectId = newId("project");
  await db.insert(schema.project).values({
    id: projectId,
    organizationId: input.organizationId,
    leadId: input.leadId,
    quoteId: input.quoteId,
    name: `Proyecto — ${input.contactName}`,
    status: "planning",
    budgetCents: input.budgetCents,
    currency: input.currency,
  });
  await db.insert(schema.projectMilestone).values(
    DEFAULT_MILESTONES.map((title, i) => ({
      id: newId("projectMilestone"),
      organizationId: input.organizationId,
      projectId,
      title,
      status: "pending" as const,
      position: i,
    }))
  );
}

export async function updateProject(input: {
  organizationId: string;
  projectId: string;
  status?: ProjectStatus;
  budgetCents?: number | null;
  targetDate?: string | null;
}): Promise<ProjectDetail> {
  const current = await getProject(input.organizationId, input.projectId);
  if (!current) throw new ProjectError("not_found", "Ese proyecto no existe");

  const db = getDb();
  await db
    .update(schema.project)
    .set({
      status: input.status ?? current.status,
      budgetCents:
        input.budgetCents !== undefined ? input.budgetCents : current.budgetCents,
      targetDate:
        input.targetDate !== undefined
          ? input.targetDate
            ? new Date(input.targetDate)
            : null
          : current.targetDate
            ? new Date(current.targetDate)
            : null,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.project.organizationId,
        input.organizationId,
        eq(schema.project.id, input.projectId)
      )
    );

  const updated = await getProject(input.organizationId, input.projectId);
  if (!updated) throw new Error("el proyecto actualizado no se pudo leer");
  return updated;
}

export async function updateMilestoneStatus(input: {
  organizationId: string;
  projectId: string;
  milestoneId: string;
  status: MilestoneStatus;
}): Promise<ProjectDetail> {
  const belongs = await milestoneBelongsToProject(
    input.organizationId,
    input.projectId,
    input.milestoneId
  );
  if (!belongs) throw new ProjectError("not_found", "Ese hito no existe");

  const db = getDb();
  await db
    .update(schema.projectMilestone)
    .set({ status: input.status })
    .where(eq(schema.projectMilestone.id, input.milestoneId));

  const updated = await getProject(input.organizationId, input.projectId);
  if (!updated) throw new Error("el proyecto actualizado no se pudo leer");
  return updated;
}
