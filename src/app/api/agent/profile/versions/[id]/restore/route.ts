import { apiError, withAuth } from "@/lib/api";
import { restoreVersion, VersionNotFoundError } from "@/server/agent/profile-history";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Fase 6 — revertir el comportamiento del agente a una versión pasada.
 * Nunca destruye nada: el estado que reemplaza queda a su vez guardado en
 * el historial (`restoreVersion`).
 */
export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    await restoreVersion(session.organizationId, id, session.userId);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof VersionNotFoundError) {
      return apiError(404, "not_found", err.message);
    }
    throw err;
  }
});
