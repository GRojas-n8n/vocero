import { withAuth } from "@/lib/api";
import { assetsDisabledResponse, assetsEnabled } from "@/server/assets/flag";
import { revealClientAssetSecret } from "@/server/assets/service";
import { assetErrorResponse } from "@/server/assets/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/assets/[id]/secret — la ÚNICA ruta que descifra un secreto para
 * mostrarlo. Endpoint aparte (no un campo más en el GET del activo) para que
 * "listar activos" y "revelar una clave" queden auditablemente separados.
 */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!assetsEnabled()) return assetsDisabledResponse();
  const { id } = await ctx.params;
  try {
    const secret = await revealClientAssetSecret({
      organizationId: session.organizationId,
      assetId: id,
    });
    return Response.json({ secret });
  } catch (err) {
    return assetErrorResponse(err);
  }
});
