"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEvents } from "@/components/use-events";
import { formatMoneyCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { SOURCE_LABELS } from "@/server/contact-source";

/** Resultados — cuadro de mando del embudo. Espejo de `server/results/types.ts`. */

type RangePreset = "7d" | "30d" | "this_month" | "last_month" | "90d" | "custom";

type DateRange = { preset: RangePreset; from: string; to: string };

type FunnelSummary = {
  range: DateRange;
  currency: string;
  newLeads: number;
  won: number;
  lost: number;
  closeRate: number | null;
  avgTicketCents: number | null;
  wonAmountCents: number;
  pipelineValueCents: number;
  pipelineLeadCount: number;
  expectedValueCents: number;
};

type AbandonmentRow = {
  stageId: string | null;
  stageName: string;
  lostCount: number;
  lostAmountCents: number;
  topLossReasons: { reason: string; count: number }[];
};

type AgingRow = {
  stageId: string;
  stageName: string;
  position: number;
  activeCount: number;
  avgDaysInStage: number | null;
};

type StageFunnelRow = {
  stageId: string;
  stageName: string;
  position: number;
  kind: "open" | "won" | "lost";
  enteredCount: number;
  conversionFromPrevious: number | null;
};

type SourceRow = {
  source: string;
  newLeads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  wonAmountCents: number;
};

type AgentAppointmentSummary = {
  enabled: boolean;
  totalBooked: number;
  aiBooked: number;
  manualBooked: number;
  aiSharePct: number | null;
  completed: number;
  noShow: number;
  cancelled: number;
  showRate: number | null;
};

type ResultsResponse = {
  summary: FunnelSummary;
  abandonment: AbandonmentRow[];
  aging: AgingRow[];
  stageFunnel: StageFunnelRow[];
  sources: SourceRow[];
  agentAppointments: AgentAppointmentSummary;
};

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "7 días" },
  { value: "30d", label: "30 días" },
  { value: "this_month", label: "Este mes" },
  { value: "last_month", label: "Mes pasado" },
  { value: "90d", label: "90 días" },
  { value: "custom", label: "Personalizado" },
];

const LOSS_REASON_LABEL: Record<string, string> = {
  precio: "Precio",
  no_es_perfil: "No es el perfil",
  sin_presupuesto: "Sin presupuesto",
  eligio_otro: "Eligió otro",
  nunca_contesto: "Nunca contestó",
  otro: "Otro",
};

export function ResultsClient() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void refresh();
    // Al cambiar de rango se vuelve a pedir; los inputs de "personalizado"
    // solo importan cuando ese preset está activo (validado abajo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, preset === "custom" ? customFrom : null, preset === "custom" ? customTo : null]);

  // El embudo cambia cuando alguien arrastra un trato o el bot lo mueve; SSE
  // mantiene la vista viva sin que el dueño tenga que refrescar a mano.
  useEvents({ onConversationUpdated: () => void refresh(), onReconnect: () => void refresh() });

  async function refresh() {
    if (preset === "custom" && (!customFrom || !customTo)) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ preset });
    if (preset === "custom") {
      params.set("from", customFrom);
      params.set("to", customTo);
    }
    const res = await fetch(`/api/results?${params}`).catch(() => null);
    if (!res?.ok) {
      setError("No se pudieron cargar los resultados.");
      setLoading(false);
      return;
    }
    setData((await res.json()) as ResultsResponse);
    setLoading(false);
  }

  const currency = data?.summary.currency ?? "MXN";

  return (
    <div className="flex flex-col gap-5 p-5 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold">Resultados</h1>
          <p className="text-sm text-text-2">
            Cómo va el embudo: qué entra, qué se cierra y dónde se atora.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              type="button"
              size="sm"
              variant={preset === p.value ? "default" : "secondary"}
              onClick={() => setPreset(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {preset === "custom" && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="results-from">Desde</Label>
            <Input
              id="results-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="results-to">Hasta</Label>
            <Input
              id="results-to"
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-danger-text">{error}</p>}

      {!data ? (
        <p className="text-sm text-text-2">{loading ? "Cargando…" : ""}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Prospectos nuevos" value={String(data.summary.newLeads)} />
            <MetricCard
              label="Dinero ganado"
              value={formatMoneyCents(data.summary.wonAmountCents, currency) ?? "—"}
              hint={`${data.summary.won} tratos ganados`}
            />
            <MetricCard
              label="Dinero en el embudo"
              value={formatMoneyCents(data.summary.pipelineValueCents, currency) ?? "—"}
              hint={`${data.summary.pipelineLeadCount} tratos abiertos`}
            />
            <MetricCard
              label="Dinero esperado"
              value={formatMoneyCents(data.summary.expectedValueCents, currency) ?? "—"}
              hint="Ponderado por cercanía a ganar"
            />
            <MetricCard
              label="Tasa de cierre"
              value={
                data.summary.closeRate === null
                  ? "—"
                  : `${Math.round(data.summary.closeRate * 100)}%`
              }
              hint={`${data.summary.won} ganados · ${data.summary.lost} perdidos`}
            />
            <MetricCard
              label="Ticket promedio"
              value={formatMoneyCents(data.summary.avgTicketCents, currency) ?? "—"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Embudo de conversión</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.stageFunnel.length === 0 ? (
                <EmptyHint text="Sin etapas configuradas." />
              ) : (
                data.stageFunnel.map((row) => (
                  <StageBar
                    key={row.stageId}
                    label={row.stageName}
                    count={row.enteredCount}
                    maxCount={Math.max(...data.stageFunnel.map((r) => r.enteredCount), 1)}
                    detail={
                      row.conversionFromPrevious === null
                        ? undefined
                        : `${Math.round(row.conversionFromPrevious * 100)}% de la etapa anterior`
                    }
                    tone={row.kind === "won" ? "won" : row.kind === "lost" ? "lost" : "default"}
                  />
                ))
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Dónde se atoran (activos hoy)</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {data.aging.length === 0 ? (
                  <EmptyHint text="No hay tratos abiertos todavía." />
                ) : (
                  data.aging.map((row) => (
                    <StageBar
                      key={row.stageId}
                      label={row.stageName}
                      count={row.activeCount}
                      maxCount={Math.max(...data.aging.map((r) => r.activeCount), 1)}
                      detail={
                        row.avgDaysInStage === null
                          ? undefined
                          : `${Math.round(row.avgDaysInStage)} días en promedio`
                      }
                    />
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Abandono en el rango</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {data.abandonment.length === 0 ? (
                  <EmptyHint text="No hubo tratos perdidos en este rango." />
                ) : (
                  data.abandonment.map((row) => (
                    <StageBar
                      key={row.stageId ?? row.stageName}
                      label={row.stageName}
                      count={row.lostCount}
                      maxCount={Math.max(...data.abandonment.map((r) => r.lostCount), 1)}
                      detail={row.topLossReasons
                        .map((r) => `${LOSS_REASON_LABEL[r.reason] ?? r.reason} (${r.count})`)
                        .join(" · ")}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Origen de prospectos</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {data.sources.length === 0 ? (
                  <EmptyHint text="No hay prospectos nuevos en este rango." />
                ) : (
                  data.sources.map((row) => (
                    <StageBar
                      key={row.source}
                      label={SOURCE_LABELS[row.source as keyof typeof SOURCE_LABELS] ?? row.source}
                      count={row.newLeads}
                      maxCount={Math.max(...data.sources.map((r) => r.newLeads), 1)}
                      detail={
                        row.conversionRate === null
                          ? `${row.won} ganados · ${row.lost} perdidos`
                          : `${Math.round(row.conversionRate * 100)}% de cierre · ${formatMoneyCents(row.wonAmountCents, currency) ?? "—"} ganados`
                      }
                    />
                  ))
                )}
              </CardContent>
            </Card>

            {data.agentAppointments.enabled && (
              <Card>
                <CardHeader>
                  <CardTitle>Citas agendadas por el agente</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {data.agentAppointments.totalBooked === 0 ? (
                    <EmptyHint text="No hubo citas agendadas en este rango." />
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <MiniStat
                        label="Agendadas por IA"
                        value={String(data.agentAppointments.aiBooked)}
                        hint={
                          data.agentAppointments.aiSharePct === null
                            ? undefined
                            : `${data.agentAppointments.aiSharePct}% del total`
                        }
                      />
                      <MiniStat label="Agendadas a mano" value={String(data.agentAppointments.manualBooked)} />
                      <MiniStat
                        label="Tasa de asistencia"
                        value={
                          data.agentAppointments.showRate === null
                            ? "—"
                            : `${Math.round(data.agentAppointments.showRate * 100)}%`
                        }
                      />
                      <MiniStat
                        label="No-shows / canceladas"
                        value={`${data.agentAppointments.noShow} / ${data.agentAppointments.cancelled}`}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-[11.5px] font-semibold uppercase tracking-wide text-text-3">
          {label}
        </span>
        <span className="text-[22px] font-bold leading-tight">{value}</span>
        {hint && <span className="text-xs text-text-2">{hint}</span>}
      </CardContent>
    </Card>
  );
}

function StageBar({
  label,
  count,
  maxCount,
  detail,
  tone = "default",
}: {
  label: string;
  count: number;
  maxCount: number;
  detail?: string;
  tone?: "default" | "won" | "lost";
}) {
  const pct = maxCount > 0 ? Math.max((count / maxCount) * 100, count > 0 ? 4 : 0) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-text-2">{count}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            tone === "won" ? "bg-success" : tone === "lost" ? "bg-danger" : "bg-brand"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {detail && <span className="text-xs text-text-3">{detail}</span>}
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-3">{label}</span>
      <span className="text-[17px] font-bold leading-tight">{value}</span>
      {hint && <span className="text-xs text-text-2">{hint}</span>}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-text-2">{text}</p>;
}
