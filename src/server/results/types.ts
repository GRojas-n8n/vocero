/**
 * Resultados — tipos compartidos entre la agregación (`metrics.ts`), el
 * contrato de la API (`/api/results`) y el cliente (`results-client.tsx`).
 *
 * Sin tabla nueva: todo se calcula sobre `lead` + `lead_stage_event` +
 * `pipeline_stage`, que ya existen y ya son la fuente de verdad del embudo
 * (constitución IV: `lead_stage_event` es append-only y la única puerta que
 * mueve `lead.stage_id`).
 */

export const RANGE_PRESETS = [
  "7d",
  "30d",
  "this_month",
  "last_month",
  "90d",
  "custom",
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export type DateRange = {
  preset: RangePreset;
  /** ISO date (yyyy-mm-dd), límites inclusivos en UTC. */
  from: string;
  to: string;
};

export type FunnelSummary = {
  range: DateRange;
  /** Moneda del negocio (Ajustes → Marca); los montos ya vienen filtrados a esta moneda. */
  currency: string;
  /** Prospectos nuevos: leads creados dentro del rango. */
  newLeads: number;
  /** Tratos que llegaron a una etapa `won` dentro del rango. */
  won: number;
  /** Tratos que llegaron a una etapa `lost` dentro del rango. */
  lost: number;
  /** `won / (won + lost)`; null si no hubo cierres (ganados o perdidos) en el rango. */
  closeRate: number | null;
  /** Promedio de `amount_cents` entre los tratos ganados CON monto capturado; null si ninguno tenía monto. */
  avgTicketCents: number | null;
  /**
   * Snapshot AHORA (no depende del rango): suma de `amount_cents` de los
   * leads que hoy están en una etapa abierta. Es "cuánto dinero hay en
   * juego", no "cuánto entró en el rango".
   */
  pipelineValueCents: number;
  pipelineLeadCount: number;
};

/** Por qué etapa salían los tratos que se perdieron en el rango. */
export type AbandonmentRow = {
  stageId: string | null;
  stageName: string;
  lostCount: number;
  lostAmountCents: number;
  topLossReasons: { reason: string; count: number }[];
};

/** Dónde se atoran los tratos que HOY siguen abiertos (no depende del rango). */
export type AgingRow = {
  stageId: string;
  stageName: string;
  position: number;
  activeCount: number;
  /** Promedio de días desde que cada lead entró a esta etapa hasta ahora. */
  avgDaysInStage: number | null;
};

export type ResultsResponse = {
  summary: FunnelSummary;
  abandonment: AbandonmentRow[];
  aging: AgingRow[];
};
