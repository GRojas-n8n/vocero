import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { assetsDisabledResponse, assetsEnabled } from "@/server/assets/flag";
import { listClientAssets } from "@/server/assets/queries";
import { createClientAsset } from "@/server/assets/service";
import { assetErrorResponse } from "@/server/assets/http";

export const dynamic = "force-dynamic";

const ASSET_TYPES = [
  "domain",
  "vps",
  "wordpress",
  "github",
  "cloudflare",
  "other",
] as const;

/** GET /api/assets?leadId= — activos de UN trato. Siempre acotado a un lead:
 *  no hay "todos los activos de la organización" porque son credenciales de
 *  terceros y no una lista para explorar suelta. */
export const GET = withAuth(async (session, req: Request) => {
  if (!assetsEnabled()) return assetsDisabledResponse();
  const leadId = new URL(req.url).searchParams.get("leadId");
  if (!leadId) return apiError(422, "invalid_body", "Falta leadId");
  const assets = await listClientAssets(session.organizationId, leadId);
  return Response.json({ assets });
});

const postSchema = z.object({
  leadId: z.string().min(1),
  type: z.enum(ASSET_TYPES),
  name: z.string().trim().min(1),
  url: z.string().trim().min(1).nullish(),
  username: z.string().trim().min(1).nullish(),
  secret: z.string().min(1).nullish(),
  expiresAt: z.string().min(1).nullish(),
  notes: z.string().trim().min(1).nullish(),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!assetsEnabled()) return assetsDisabledResponse();
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  try {
    const asset = await createClientAsset({
      organizationId: session.organizationId,
      leadId: body.data.leadId,
      type: body.data.type,
      name: body.data.name,
      url: body.data.url ?? null,
      username: body.data.username ?? null,
      secret: body.data.secret ?? null,
      expiresAt: body.data.expiresAt ?? null,
      notes: body.data.notes ?? null,
    });
    return Response.json({ asset }, { status: 201 });
  } catch (err) {
    return assetErrorResponse(err);
  }
});
