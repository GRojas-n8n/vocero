import { withAuth } from "@/lib/api";
import { getSettings } from "@/server/agenda/settings";
import { getBranding } from "@/server/branding";
import {
  getAbandonment,
  getAgentAppointments,
  getAgentPerformance,
  getAging,
  getFunnelSummary,
  getLeadSources,
  getStageFunnel,
} from "@/server/results/metrics";
import { resolveRange } from "@/server/results/range";
import { RANGE_PRESETS, type RangePreset, type ResultsResponse } from "@/server/results/types";

export const dynamic = "force-dynamic";

/**
 * Resultados — cuadro de mando del embudo. Solo lectura: agrega sobre
 * `lead` / `lead_stage_event` / `pipeline_stage`, que ya existen. Sin
 * bandera: es una vista core, disponible en toda instancia (a diferencia de
 * los módulos opcionales 015/016, no toca terceros ni pide credenciales).
 *
 * El timezone sale de `calendar_settings` (015), que existe siempre con un
 * default sensato — leerlo aquí NO acopla Resultados a la bandera `AGENDA`,
 * solo reusa el huso horario del negocio para que "hoy"/"este mes" cuadren
 * con el reloj de pared real.
 */
export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const presetParam = url.searchParams.get("preset");
  const preset: RangePreset = RANGE_PRESETS.includes(presetParam as RangePreset)
    ? (presetParam as RangePreset)
    : "30d";

  const [branding, calendarSettings] = await Promise.all([
    getBranding(session.organizationId),
    getSettings(session.organizationId),
  ]);
  const tz = calendarSettings.timezone;

  const range = resolveRange(
    preset,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
    tz
  );

  const [summary, abandonment, aging, stageFunnel, sources, agentAppointments, agentPerformance] =
    await Promise.all([
      getFunnelSummary(session.organizationId, range, branding.currency, tz),
      getAbandonment(session.organizationId, range, branding.currency, tz),
      getAging(session.organizationId),
      getStageFunnel(session.organizationId, range, tz),
      getLeadSources(session.organizationId, range, branding.currency, tz),
      getAgentAppointments(session.organizationId, range, tz),
      getAgentPerformance(session.organizationId, range, tz),
    ]);

  const body: ResultsResponse = {
    summary,
    abandonment,
    aging,
    stageFunnel,
    sources,
    agentAppointments,
    agentPerformance,
  };
  return Response.json(body);
});
