import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/** 021 — Lecturas de proyectos e hitos. */

export type ProjectStatus =
  | "planning"
  | "in_progress"
  | "review"
  | "completed"
  | "paused";

export type MilestoneStatus = "pending" | "in_progress" | "completed";

export type ProjectMilestoneDto = {
  id: string;
  title: string;
  status: MilestoneStatus;
  position: number;
  dueDate: string | null;
};

export type ProjectDetail = {
  id: string;
  leadId: string;
  contactName: string;
  quoteId: string | null;
  name: string;
  status: ProjectStatus;
  budgetCents: number | null;
  currency: string | null;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  milestones: ProjectMilestoneDto[];
};

function toProjectDetail(row: {
  project: typeof schema.project.$inferSelect;
  contactName: string;
  milestones: ProjectMilestoneDto[];
}): ProjectDetail {
  const p = row.project;
  return {
    id: p.id,
    leadId: p.leadId,
    contactName: row.contactName,
    quoteId: p.quoteId,
    name: p.name,
    status: p.status,
    budgetCents: p.budgetCents,
    currency: p.currency,
    targetDate: p.targetDate?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    milestones: row.milestones,
  };
}

async function milestonesForProject(
  projectId: string
): Promise<ProjectMilestoneDto[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.projectMilestone)
    .where(eq(schema.projectMilestone.projectId, projectId))
    .orderBy(asc(schema.projectMilestone.position));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    position: r.position,
    dueDate: r.dueDate?.toISOString() ?? null,
  }));
}

/** Lista de proyectos de la organización, el más reciente primero.
 *  `leadId` acota a los de un solo trato. */
export async function listProjects(
  organizationId: string,
  leadId?: string
): Promise<ProjectDetail[]> {
  const db = getDb();
  const rows = await db
    .select({ project: schema.project, contactName: schema.contact.name })
    .from(schema.project)
    .innerJoin(schema.lead, eq(schema.project.leadId, schema.lead.id))
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .where(
      scoped(
        schema.project.organizationId,
        organizationId,
        leadId ? eq(schema.project.leadId, leadId) : undefined
      )
    )
    .orderBy(desc(schema.project.createdAt));

  const withMilestones = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      milestones: await milestonesForProject(r.project.id),
    }))
  );
  return withMilestones.map(toProjectDetail);
}

export async function getProject(
  organizationId: string,
  projectId: string
): Promise<ProjectDetail | null> {
  const db = getDb();
  const rows = await db
    .select({ project: schema.project, contactName: schema.contact.name })
    .from(schema.project)
    .innerJoin(schema.lead, eq(schema.project.leadId, schema.lead.id))
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .where(
      scoped(
        schema.project.organizationId,
        organizationId,
        eq(schema.project.id, projectId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const milestones = await milestonesForProject(row.project.id);
  return toProjectDetail({ ...row, milestones });
}

/** ¿Ese hito es de ese proyecto, y ese proyecto de esta organización? */
export async function milestoneBelongsToProject(
  organizationId: string,
  projectId: string,
  milestoneId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.projectMilestone.id })
    .from(schema.projectMilestone)
    .innerJoin(schema.project, eq(schema.projectMilestone.projectId, schema.project.id))
    .where(
      and(
        eq(schema.project.organizationId, organizationId),
        eq(schema.project.id, projectId),
        eq(schema.projectMilestone.id, milestoneId)
      )
    )
    .limit(1);
  return rows.length > 0;
}
