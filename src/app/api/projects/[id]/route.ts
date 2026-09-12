import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { projectsDisabledResponse, projectsEnabled } from "@/server/projects/flag";
import { getProject } from "@/server/projects/queries";
import { updateProject } from "@/server/projects/service";
import { projectErrorResponse } from "@/server/projects/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const PROJECT_STATUSES = [
  "planning",
  "in_progress",
  "review",
  "completed",
  "paused",
] as const;

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!projectsEnabled()) return projectsDisabledResponse();
  const { id } = await ctx.params;
  const project = await getProject(session.organizationId, id);
  if (!project) return apiError(404, "not_found", "Ese proyecto no existe");
  return Response.json({ project });
});

const patchSchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  budgetCents: z.number().int().min(0).nullish(),
  targetDate: z.string().min(1).nullish(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!projectsEnabled()) return projectsDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    const project = await updateProject({
      organizationId: session.organizationId,
      projectId: id,
      status: body.data.status,
      budgetCents: body.data.budgetCents,
      targetDate: body.data.targetDate,
    });
    return Response.json({ project });
  } catch (err) {
    return projectErrorResponse(err);
  }
});
