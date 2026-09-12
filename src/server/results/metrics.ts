import { and, avg, count, eq, gte, isNotNull, lte, or, sql, sum } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { rangeBounds } from "./range";
import type { AbandonmentRow, AgingRow, DateRange, FunnelSummary } from "./types";

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

  return {
    range,
    currency: businessCurrency,
    newLeads: newLeadsRow?.value ?? 0,
    won,
    lost,
    closeRate: won + lost > 0 ? won / (won + lost) : null,
    avgTicketCents: ticketRow?.value != null ? Math.round(Number(ticketRow.value)) : null,
    pipelineValueCents: pipelineRow?.valueCents != null ? Number(pipelineRow.valueCents) : 0,
    pipelineLeadCount: pipelineRow?.leadCount ?? 0,
  };
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
