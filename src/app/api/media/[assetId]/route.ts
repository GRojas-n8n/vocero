import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { parseRangeHeader } from "@/lib/http/range";
import {
  ensureAssetAvailable,
  readMediaFile,
} from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ assetId: string }> };

/**
 * 008 — Sirve el binario de un adjunto desde el volumen local. Solo con
 * sesión y dentro de la organización (un asset ajeno responde 404: jamás se
 * filtra existencia entre tenants). Si el archivo aún no se descargó,
 * intenta on-demand contra Graph; si Meta ya lo expiró → 410.
 *
 * Soporta `Range` (RFC 7233): sin esto, el `<audio>`/`<video>` del navegador
 * no puede calcular la duración ni buscar dentro del archivo — se queda
 * mostrando 0:00 aunque el audio esté perfectamente sano (bug 2026-09-16,
 * reportado sobre una nota de voz de Diego en MÁS Impulso).
 */
export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { assetId } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(assetId)) {
    return apiError(422, "invalid", "assetId inválido");
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.mediaAsset)
    .where(
      scoped(
        schema.mediaAsset.organizationId,
        session.organizationId,
        eq(schema.mediaAsset.id, assetId)
      )
    )
    .limit(1);
  let asset = rows[0];
  if (!asset) return apiError(404, "not_found", "Adjunto no encontrado");

  if (asset.kind === "location" || asset.kind === "contacts") {
    // Sin binario: el payload viaja en el DTO del mensaje.
    return apiError(404, "no_binary", "Este adjunto no tiene archivo");
  }

  if (asset.fetchStatus !== "available") {
    // On-demand: reintenta la descarga en el momento (pending o failed).
    asset = (await ensureAssetAvailable(session.organizationId, assetId)) ?? asset;
  }
  if (asset.fetchStatus !== "available" || !asset.storagePath) {
    return apiError(
      410,
      "gone",
      "El contenido ya no está disponible (expiró en WhatsApp antes de poder copiarse)"
    );
  }

  try {
    const data = await readMediaFile(session.organizationId, assetId);
    const baseHeaders: Record<string, string> = {
      "content-type": asset.mimeType ?? "application/octet-stream",
      // El contenido de un asset es inmutable; privado por sesión.
      "cache-control": "private, max-age=86400",
      "accept-ranges": "bytes",
      ...(asset.fileName
        ? {
            "content-disposition": `inline; filename="${asset.fileName.replace(/[^\w. -]/g, "_")}"`,
          }
        : {}),
    };

    const range = parseRangeHeader(req.headers.get("range"), data.byteLength);
    if (range) {
      const chunk = data.subarray(range.start, range.end + 1);
      return new Response(new Uint8Array(chunk), {
        status: 206,
        headers: {
          ...baseHeaders,
          "content-length": String(chunk.byteLength),
          "content-range": `bytes ${range.start}-${range.end}/${data.byteLength}`,
        },
      });
    }

    return new Response(new Uint8Array(data), {
      headers: { ...baseHeaders, "content-length": String(data.byteLength) },
    });
  } catch {
    return apiError(410, "gone", "El archivo del adjunto no está en el volumen");
  }
});
