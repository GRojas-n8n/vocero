import { withAuth } from "@/lib/api";
import { projectsDisabledResponse, projectsEnabled } from "@/server/projects/flag";
import { listProjects } from "@/server/projects/queries";

export const dynamic = "force-dynamic";

/** GET /api/projects — lista de la organización, o de un solo trato con
 *  ?leadId= (tarjeta del pipeline). No hay POST manual: todo proyecto nace
 *  automático al aceptar una cotización (`src/server/quotes/service.ts`). */
export const GET = withAuth(async (session, req: Request) => {
  if (!projectsEnabled()) return projectsDisabledResponse();
  const leadId = new URL(req.url).searchParams.get("leadId") ?? undefined;
  const projects = await listProjects(session.organizationId, leadId);
  return Response.json({ projects });
});
