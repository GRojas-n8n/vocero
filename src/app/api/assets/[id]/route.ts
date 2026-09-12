import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { assetsDisabledResponse, assetsEnabled } from "@/server/assets/flag";
import { getClientAsset } from "@/server/assets/queries";
import { deleteClientAsset, updateClientAsset } from "@/server/assets/service";
import { assetErrorResponse } from "@/server/assets/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ASSET_TYPES = [
  "domain",
  "vps",
  "wordpress",
  "github",
  "cloudflare",
  "other",
] as const;

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!assetsEnabled()) return assetsDisabledResponse();
  const { id } = await ctx.params;
  const asset = await getClientAsset(session.organizationId, id);
  if (!asset) return apiError(404, "not_found", "Ese activo no existe");
  return Response.json({ asset });
});

const patchSchema = z.object({
  type: z.enum(ASSET_TYPES).optional(),
  name: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).nullish(),
  username: z.string().trim().min(1).nullish(),
  /** Ausente = no tocar; null = borrarlo; string = re-cifrarlo. */
  secret: z.string().min(1).nullish(),
  expiresAt: z.string().min(1).nullish(),
  notes: z.string().trim().min(1).nullish(),
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!assetsEnabled()) return assetsDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    const asset = await updateClientAsset({
      organizationId: session.organizationId,
      assetId: id,
      type: body.data.type,
      name: body.data.name,
      url: body.data.url,
      username: body.data.username,
      secret: body.data.secret,
      expiresAt: body.data.expiresAt,
      notes: body.data.notes,
    });
    return Response.json({ asset });
  } catch (err) {
    return assetErrorResponse(err);
  }
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!assetsEnabled()) return assetsDisabledResponse();
  const { id } = await ctx.params;
  try {
    await deleteClientAsset({ organizationId: session.organizationId, assetId: id });
    return Response.json({ ok: true });
  } catch (err) {
    return assetErrorResponse(err);
  }
});
