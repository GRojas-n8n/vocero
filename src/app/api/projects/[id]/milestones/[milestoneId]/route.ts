import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { projectsDisabledResponse, projectsEnabled } from "@/server/projects/flag";
import { updateMilestoneStatus } from "@/server/projects/service";
import { projectErrorResponse } from "@/server/projects/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; milestoneId: string }> };

const patchSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed"]),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!projectsEnabled()) return projectsDisabledResponse();
  const { id, milestoneId } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    const project = await updateMilestoneStatus({
      organizationId: session.organizationId,
      projectId: id,
      milestoneId,
      status: body.data.status,
    });
    return Response.json({ project });
  } catch (err) {
    return projectErrorResponse(err);
  }
});
