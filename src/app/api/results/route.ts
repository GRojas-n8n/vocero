import { withAuth } from "@/lib/api";
import { getBranding } from "@/server/branding";
import { getAbandonment, getAging, getFunnelSummary } from "@/server/results/metrics";
import { resolveRange } from "@/server/results/range";
import { RANGE_PRESETS, type RangePreset, type ResultsResponse } from "@/server/results/types";

export const dynamic = "force-dynamic";

/**
 * Resultados — cuadro de mando del embudo. Solo lectura: agrega sobre
 * `lead` / `lead_stage_event` / `pipeline_stage`, que ya existen. Sin
 * bandera: es una vista core, disponible en toda instancia (a diferencia de
 * los módulos opcionales 015/016, no toca terceros ni pide credenciales).
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const presetParam = url.searchParams.get("preset");
  const preset: RangePreset = RANGE_PRESETS.includes(presetParam as RangePreset)
    ? (presetParam as RangePreset)
    : "30d";
  const range = resolveRange(
    preset,
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );

  const branding = await getBranding(session.organizationId);

  const [summary, abandonment, aging] = await Promise.all([
    getFunnelSummary(session.organizationId, range, branding.currency),
    getAbandonment(session.organizationId, range, branding.currency),
    getAging(session.organizationId),
  ]);

  const body: ResultsResponse = { summary, abandonment, aging };
  return Response.json(body);
});
