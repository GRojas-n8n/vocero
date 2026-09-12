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
  /** Dinero GANADO: suma de `amount_cents` de los tratos que llegaron a `won` dentro del rango. */
  wonAmountCents: number;
  /**
   * Snapshot AHORA (no depende del rango): suma de `amount_cents` de los
   * leads que hoy están en una etapa abierta. Es "cuánto dinero hay en
   * juego", no "cuánto entró en el rango".
   */
  pipelineValueCents: number;
  pipelineLeadCount: number;
  /**
   * Dinero ESPERADO: snapshot AHORA, pipeline ponderado por qué tan cerca
   * está cada etapa abierta de `won` (ver `getExpectedPipelineValue`). Nunca
   * ≥ `pipelineValueCents`: es una estimación conservadora, no un descuento
   * de probabilidad capturado por nadie.
   */
  expectedValueCents: number;
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

/**
 * Embudo etapa por etapa: cuántos leads ENTRARON a cada etapa dentro del
 * rango (evento `lead_stage_event.to_stage_id`, no snapshot) y qué fracción
 * de los que entraron a la etapa anterior llegó a esta. Incluye `won`/`lost`
 * como las dos últimas filas del embudo (por posición), no solo las abiertas.
 */
export type StageFunnelRow = {
  stageId: string;
  stageName: string;
  position: number;
  kind: "open" | "won" | "lost";
  enteredCount: number;
  /** `enteredCount / enteredCount` de la fila anterior; null en la primera etapa o si la anterior tuvo 0 entradas. */
  conversionFromPrevious: number | null;
};

/** De dónde salieron los prospectos del rango, y qué tan bien cerraron. */
export type SourceRow = {
  /** Valor de `contact.source`, o `"desconocida"` si el contacto no lo tiene capturado. */
  source: string;
  newLeads: number;
  won: number;
  lost: number;
  /** `won / (won + lost)`; null si esta fuente no tuvo cierres en el rango. */
  conversionRate: number | null;
  wonAmountCents: number;
};

/**
 * Citas agendadas por el agente de IA vs. a mano, dentro del rango. Excluye
 * SIEMPRE `booking.is_test` (Laboratorio: nunca toca la agenda real, tampoco
 * sus métricas). `enabled: false` cuando la instancia no tiene la bandera
 * `AGENDA` encendida — el resto de los campos queda en cero, no ausente, para
 * que el cliente no tenga que ramificar por campo.
 */
export type AgentAppointmentSummary = {
  enabled: boolean;
  totalBooked: number;
  aiBooked: number;
  manualBooked: number;
  /** `aiBooked / totalBooked` en porcentaje entero; null si no hubo citas. */
  aiSharePct: number | null;
  completed: number;
  noShow: number;
  cancelled: number;
  /** `completed / (completed + noShow)`; null si ninguna de las dos aún ocurrió. */
  showRate: number | null;
};

export type ResultsResponse = {
  summary: FunnelSummary;
  abandonment: AbandonmentRow[];
  aging: AgingRow[];
  stageFunnel: StageFunnelRow[];
  sources: SourceRow[];
  agentAppointments: AgentAppointmentSummary;
};
