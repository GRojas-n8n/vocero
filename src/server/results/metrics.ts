import { and, avg, count, countDistinct, eq, gte, isNotNull, lte, or, sql, sum } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { agendaEnabled } from "@/server/agenda/flag";
import { rangeBounds } from "./range";
import type {
  AbandonmentRow,
  AgentAppointmentSummary,
  AgingRow,
  DateRange,
  FunnelSummary,
  SourceRow,
  StageFunnelRow,
} from "./types";

/**
 * Mismo criterio que `lib/money.ts#sumable`: solo entra al total el monto
 * capturado en la moneda del negocio (o sin moneda propia, que hereda la del
 * negocio). Sumar monedas distintas sin tipo de cambio sería un total falso.
 */
function inBusinessCurrency(currencyColumn: typeof schema.lead.currency, businessCurrency: string) {
  return or(eq(currencyColumn, businessCurrency), sql`${currencyColumn} is null`);
}

/** Prospectos nuevos, cierres, tasa de cierre, ticket promedio y valor del embudo. */
export async function getFunnelSummary(
  organizationId: string,
  range: DateRange,
  businessCurrency: string
): Promise<FunnelSummary> {
  const db = getDb();
  const { start, end } = rangeBounds(range);

  const [newLeadsRow] = await db
    .select({ value: count() })
    .from(schema.lead)
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        gte(schema.lead.createdAt, start),
        lte(schema.lead.createdAt, end)
      )
    );

  const [wonRow] = await db
    .select({ value: count() })
    .from(schema.leadStageEvent)
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        eq(schema.leadStageEvent.toStageKind, "won"),
        gte(schema.leadStageEvent.occurredAt, start),
        lte(schema.leadStageEvent.occurredAt, end)
      )
    );

  const [lostRow] = await db
    .select({ value: count() })
    .from(schema.leadStageEvent)
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        eq(schema.leadStageEvent.toStageKind, "lost"),
        gte(schema.leadStageEvent.occurredAt, start),
        lte(schema.leadStageEvent.occurredAt, end)
      )
    );

  const [wonAmountRow] = await db
    .select({
      value: sum(
        sql`case when ${inBusinessCurrency(schema.lead.currency, businessCurrency)} then ${schema.lead.amountCents} else null end`
      ),
    })
    .from(schema.lead)
    .innerJoin(
      schema.leadStageEvent,
      and(
        eq(schema.leadStageEvent.leadId, schema.lead.id),
        eq(schema.leadStageEvent.toStageKind, "won"),
        gte(schema.leadStageEvent.occurredAt, start),
        lte(schema.leadStageEvent.occurredAt, end)
      )
    )
    .where(scoped(schema.lead.organizationId, organizationId));

  const [ticketRow] = await db
    .select({ value: avg(schema.lead.amountCents) })
    .from(schema.lead)
    .innerJoin(
      schema.leadStageEvent,
      and(
        eq(schema.leadStageEvent.leadId, schema.lead.id),
        eq(schema.leadStageEvent.toStageKind, "won"),
        gte(schema.leadStageEvent.occurredAt, start),
        lte(schema.leadStageEvent.occurredAt, end)
      )
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        isNotNull(schema.lead.amountCents),
        inBusinessCurrency(schema.lead.currency, businessCurrency)
      )
    );

  // Conteo de TODOS los leads abiertos (cualquier moneda); la suma en centavos
  // solo entra si está en la moneda del negocio, por `inBusinessCurrency`.
  const [pipelineRow] = await db
    .select({
      valueCents: sum(
        sql`case when ${inBusinessCurrency(schema.lead.currency, businessCurrency)} then ${schema.lead.amountCents} else null end`
      ),
      leadCount: count(),
    })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.pipelineStage.kind, "open")
      )
    );

  const won = wonRow?.value ?? 0;
  const lost = lostRow?.value ?? 0;
  const expectedValueCents = await getExpectedPipelineValue(organizationId, businessCurrency);

  return {
    range,
    currency: businessCurrency,
    newLeads: newLeadsRow?.value ?? 0,
    won,
    lost,
    closeRate: won + lost > 0 ? won / (won + lost) : null,
    avgTicketCents: ticketRow?.value != null ? Math.round(Number(ticketRow.value)) : null,
    wonAmountCents: wonAmountRow?.value != null ? Number(wonAmountRow.value) : 0,
    pipelineValueCents: pipelineRow?.valueCents != null ? Number(pipelineRow.valueCents) : 0,
    pipelineLeadCount: pipelineRow?.leadCount ?? 0,
    expectedValueCents,
  };
}

/**
 * Dinero ESPERADO: snapshot AHORA, no depende del rango. Pondera el monto de
 * cada lead abierto por qué tan cerca está su etapa de `won`, usando la
 * POSICIÓN de la etapa entre las etapas abiertas del negocio (etapa 1 de 4 ⇒
 * peso 25%, etapa 4 de 4 ⇒ peso 100%).
 *
 * Es una heurística deliberada v1 — no hay probabilidad de cierre capturada
 * por nadie en ningún lado del producto — pero es la misma idea que "peso por
 * etapa" de cualquier CRM de embudo, y degrada con gracia: sin monto
 * capturado, ese lead simplemente no suma (mismo criterio que `avgTicketCents`).
 */
async function getExpectedPipelineValue(
  organizationId: string,
  businessCurrency: string
): Promise<number> {
  const db = getDb();

  const openStages = await db
    .select({ id: schema.pipelineStage.id, position: schema.pipelineStage.position })
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId, eq(schema.pipelineStage.kind, "open")))
    .orderBy(schema.pipelineStage.position);
  if (openStages.length === 0) return 0;

  const weightByStageId = new Map(
    openStages.map((s, i) => [s.id, (i + 1) / openStages.length])
  );

  const rows = await db
    .select({
      stageId: schema.lead.stageId,
      valueCents: sum(
        sql`case when ${inBusinessCurrency(schema.lead.currency, businessCurrency)} then ${schema.lead.amountCents} else null end`
      ),
    })
    .from(schema.lead)
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(scoped(schema.lead.organizationId, organizationId, eq(schema.pipelineStage.kind, "open")))
    .groupBy(schema.lead.stageId);

  let total = 0;
  for (const row of rows) {
    const weight = weightByStageId.get(row.stageId) ?? 0;
    total += Number(row.valueCents ?? 0) * weight;
  }
  return Math.round(total);
}

/** Por qué etapa salían los tratos perdidos en el rango, y con qué motivo. */
export async function getAbandonment(
  organizationId: string,
  range: DateRange,
  businessCurrency: string
): Promise<AbandonmentRow[]> {
  const db = getDb();
  const { start, end } = rangeBounds(range);

  const rows = await db
    .select({
      stageId: schema.leadStageEvent.fromStageId,
      stageName: schema.leadStageEvent.fromStageName,
      lostCount: count(),
      lostAmountCents: sum(
        sql`case when ${inBusinessCurrency(schema.lead.currency, businessCurrency)} then ${schema.lead.amountCents} else null end`
      ),
      lossReason: schema.leadStageEvent.lossReason,
    })
    .from(schema.leadStageEvent)
    .leftJoin(schema.lead, eq(schema.lead.id, schema.leadStageEvent.leadId))
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        eq(schema.leadStageEvent.toStageKind, "lost"),
        gte(schema.leadStageEvent.occurredAt, start),
        lte(schema.leadStageEvent.occurredAt, end)
      )
    )
    .groupBy(
      schema.leadStageEvent.fromStageId,
      schema.leadStageEvent.fromStageName,
      schema.leadStageEvent.lossReason
    );

  // Se agrupó también por `lossReason` para poder rankearlo; ahora se
  // colapsa a una fila por etapa con el top de motivos adentro.
  const byStage = new Map<string, AbandonmentRow>();
  for (const r of rows) {
    const key = r.stageId ?? "__sin_etapa__";
    const existing = byStage.get(key);
    const amount = r.lostAmountCents != null ? Number(r.lostAmountCents) : 0;
    const reasonEntry = r.lossReason ? [{ reason: r.lossReason, count: r.lostCount }] : [];
    if (existing) {
      existing.lostCount += r.lostCount;
      existing.lostAmountCents += amount;
      existing.topLossReasons.push(...reasonEntry);
    } else {
      byStage.set(key, {
        stageId: r.stageId,
        stageName: r.stageName ?? "Sin etapa",
        lostCount: r.lostCount,
        lostAmountCents: amount,
        topLossReasons: reasonEntry,
      });
    }
  }

  return Array.from(byStage.values())
    .map((row) => ({
      ...row,
      topLossReasons: row.topLossReasons
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    }))
    .sort((a, b) => b.lostCount - a.lostCount);
}

/**
 * Dónde se atoran los tratos que HOY siguen abiertos: por etapa, cuántos hay
 * y cuánto tiempo promedio lleva cada uno desde que entró.
 *
 * No hay una sola query razonable para "cuándo entró cada lead a su etapa
 * actual" sin una subquery correlacionada; en vez de eso se trae el último
 * evento de entrada por lead y se agrega en memoria — el volumen es el de
 * los leads ACTIVOS de un solo negocio, no un reporte histórico masivo.
 */
export async function getAging(organizationId: string): Promise<AgingRow[]> {
  const db = getDb();

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId, eq(schema.pipelineStage.kind, "open")));
  if (stages.length === 0) return [];

  const enteredAt = await db
    .select({
      leadId: schema.leadStageEvent.leadId,
      stageId: schema.lead.stageId,
      enteredAt: sql<string>`max(${schema.leadStageEvent.occurredAt})`,
    })
    .from(schema.leadStageEvent)
    .innerJoin(
      schema.lead,
      and(
        eq(schema.lead.id, schema.leadStageEvent.leadId),
        eq(schema.lead.stageId, schema.leadStageEvent.toStageId)
      )
    )
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.pipelineStage.kind, "open")
      )
    )
    .groupBy(schema.leadStageEvent.leadId, schema.lead.stageId);

  const now = Date.now();
  const byStage = new Map<string, { activeCount: number; totalDays: number }>();
  for (const row of enteredAt) {
    const days = (now - new Date(row.enteredAt).getTime()) / (24 * 60 * 60 * 1000);
    const acc = byStage.get(row.stageId) ?? { activeCount: 0, totalDays: 0 };
    acc.activeCount += 1;
    acc.totalDays += days;
    byStage.set(row.stageId, acc);
  }

  return stages
    .map((stage) => {
      const acc = byStage.get(stage.id);
      return {
        stageId: stage.id,
        stageName: stage.name,
        position: stage.position,
        activeCount: acc?.activeCount ?? 0,
        avgDaysInStage: acc && acc.activeCount > 0 ? acc.totalDays / acc.activeCount : null,
      };
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * Embudo etapa por etapa dentro del rango: cuántos leads ENTRARON a cada
 * etapa (evento, no snapshot) y qué fracción de los que entraron a la etapa
 * anterior llegó a esta — encadenado por `position`, incluyendo `won`/`lost`
 * como el final natural del embudo.
 *
 * `enteredCount` cuenta leads DISTINTOS: un lead que retrocede y vuelve a
 * entrar a la misma etapa en el rango no debe inflar el conteo.
 */
export async function getStageFunnel(
  organizationId: string,
  range: DateRange
): Promise<StageFunnelRow[]> {
  const db = getDb();
  const { start, end } = rangeBounds(range);

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, organizationId))
    .orderBy(schema.pipelineStage.position);
  if (stages.length === 0) return [];

  const entries = await db
    .select({
      stageId: schema.leadStageEvent.toStageId,
      enteredCount: countDistinct(schema.leadStageEvent.leadId),
    })
    .from(schema.leadStageEvent)
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        gte(schema.leadStageEvent.occurredAt, start),
        lte(schema.leadStageEvent.occurredAt, end)
      )
    )
    .groupBy(schema.leadStageEvent.toStageId);

  const enteredByStage = new Map(entries.map((e) => [e.stageId, e.enteredCount]));

  let previousCount: number | null = null;
  return stages.map((stage) => {
    const enteredCount = enteredByStage.get(stage.id) ?? 0;
    const conversionFromPrevious =
      previousCount === null ? null : previousCount > 0 ? enteredCount / previousCount : null;
    previousCount = enteredCount;
    return {
      stageId: stage.id,
      stageName: stage.name,
      position: stage.position,
      kind: stage.kind,
      enteredCount,
      conversionFromPrevious,
    };
  });
}

/** De dónde salieron los prospectos del rango, y qué tan bien cerraron. */
export async function getLeadSources(
  organizationId: string,
  range: DateRange,
  businessCurrency: string
): Promise<SourceRow[]> {
  const db = getDb();
  const { start, end } = rangeBounds(range);
  const sourceExpr = sql<string>`coalesce(${schema.contact.source}, 'desconocida')`;

  const newLeadRows = await db
    .select({ source: sourceExpr, newLeads: count() })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        gte(schema.lead.createdAt, start),
        lte(schema.lead.createdAt, end)
      )
    )
    .groupBy(sourceExpr);

  const outcomeRows = await db
    .select({
      source: sourceExpr,
      kind: schema.leadStageEvent.toStageKind,
      dealCount: count(),
      amountCents: sum(
        sql`case when ${inBusinessCurrency(schema.lead.currency, businessCurrency)} then ${schema.lead.amountCents} else null end`
      ),
    })
    .from(schema.leadStageEvent)
    .innerJoin(schema.lead, eq(schema.lead.id, schema.leadStageEvent.leadId))
    .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
    .where(
      scoped(
        schema.leadStageEvent.organizationId,
        organizationId,
        or(eq(schema.leadStageEvent.toStageKind, "won"), eq(schema.leadStageEvent.toStageKind, "lost")),
        gte(schema.leadStageEvent.occurredAt, start),
        lte(schema.leadStageEvent.occurredAt, end)
      )
    )
    .groupBy(sourceExpr, schema.leadStageEvent.toStageKind);

  const bySource = new Map<string, SourceRow>();
  const get = (source: string): SourceRow => {
    const existing = bySource.get(source);
    if (existing) return existing;
    const fresh: SourceRow = { source, newLeads: 0, won: 0, lost: 0, conversionRate: null, wonAmountCents: 0 };
    bySource.set(source, fresh);
    return fresh;
  };

  for (const row of newLeadRows) {
    get(row.source).newLeads = row.newLeads;
  }
  for (const row of outcomeRows) {
    const entry = get(row.source);
    if (row.kind === "won") {
      entry.won = row.dealCount;
      entry.wonAmountCents = row.amountCents != null ? Number(row.amountCents) : 0;
    } else if (row.kind === "lost") {
      entry.lost = row.dealCount;
    }
  }

  return Array.from(bySource.values())
    .map((row) => ({
      ...row,
      conversionRate: row.won + row.lost > 0 ? row.won / (row.won + row.lost) : null,
    }))
    .sort((a, b) => b.newLeads - a.newLeads);
}

/**
 * Citas agendadas por el agente de IA vs. a mano, dentro del rango.
 *
 * Vive en Resultados (vista core, sin bandera) pero LEE una tabla que solo
 * tiene datos reales cuando `AGENDA` (015) está encendida en esta instancia
 * — la migración se aplica siempre, así que la tabla existe y la query es
 * segura de correr igual, simplemente no habrá filas. `enabled` es la señal
 * explícita para que la UI decida si mostrar la sección o no.
 */
export async function getAgentAppointments(
  organizationId: string,
  range: DateRange
): Promise<AgentAppointmentSummary> {
  const enabled = agendaEnabled();
  const empty: AgentAppointmentSummary = {
    enabled,
    totalBooked: 0,
    aiBooked: 0,
    manualBooked: 0,
    aiSharePct: null,
    completed: 0,
    noShow: 0,
    cancelled: 0,
    showRate: null,
  };
  if (!enabled) return empty;

  const db = getDb();
  const { start, end } = rangeBounds(range);

  const rows = await db
    .select({
      source: schema.booking.source,
      status: schema.booking.status,
      value: count(),
    })
    .from(schema.booking)
    .where(
      scoped(
        schema.booking.organizationId,
        organizationId,
        eq(schema.booking.kind, "session"),
        eq(schema.booking.isTest, false),
        gte(schema.booking.createdAt, start),
        lte(schema.booking.createdAt, end)
      )
    )
    .groupBy(schema.booking.source, schema.booking.status);

  const result = { ...empty };
  for (const row of rows) {
    result.totalBooked += row.value;
    if (row.source === "ai") result.aiBooked += row.value;
    else result.manualBooked += row.value;
    if (row.status === "realizada") result.completed += row.value;
    else if (row.status === "no_show") result.noShow += row.value;
    else if (row.status === "cancelada") result.cancelled += row.value;
  }
  result.aiSharePct =
    result.totalBooked > 0 ? Math.round((result.aiBooked / result.totalBooked) * 100) : null;
  result.showRate =
    result.completed + result.noShow > 0 ? result.completed / (result.completed + result.noShow) : null;
  return result;
}
