"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEvents } from "@/components/use-events";
import { formatMoneyCents } from "@/lib/money";
import { cn } from "@/lib/utils";

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
  pipelineValueCents: number;
  pipelineLeadCount: number;
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

type ResultsResponse = {
  summary: FunnelSummary;
  abandonment: AbandonmentRow[];
  aging: AgingRow[];
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
            <MetricCard label="Tratos ganados" value={String(data.summary.won)} />
            <MetricCard
              label="Dinero en el embudo"
              value={formatMoneyCents(data.summary.pipelineValueCents, currency) ?? "—"}
              hint={`${data.summary.pipelineLeadCount} tratos abiertos`}
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
            <MetricCard label="Tratos perdidos" value={String(data.summary.lost)} />
          </div>

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
}: {
  label: string;
  count: number;
  maxCount: number;
  detail?: string;
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
          className={cn("h-full rounded-full bg-brand transition-[width]")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {detail && <span className="text-xs text-text-3">{detail}</span>}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-text-2">{text}</p>;
}
