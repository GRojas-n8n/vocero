import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";

/** 019 — Lecturas de cotizaciones. */

export type QuoteStatus = "borrador" | "enviada" | "aceptada" | "rechazada";
/** Estado a MOSTRAR: "vencida" es derivado (ver comentario en schema.ts),
 *  nunca escrito en `quote.status`. */
export type QuoteDisplayStatus = QuoteStatus | "vencida";

export type QuoteItem = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  position: number;
};

export type QuoteDetail = {
  id: string;
  leadId: string;
  contactId: string;
  contactName: string;
  status: QuoteStatus;
  displayStatus: QuoteDisplayStatus;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  validUntil: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  webhookStatus: "pending" | "sent" | "failed" | "skipped";
  webhookError: string | null;
  createdAt: string;
  updatedAt: string;
  items: QuoteItem[];
};

/** `enviada` cuyo `validUntil` ya pasó se MUESTRA como vencida, sin serlo en
 *  la base — ver el comentario largo en `schema.ts` sobre por qué. */
export function toDisplayStatus(
  status: QuoteStatus,
  validUntil: Date | null
): QuoteDisplayStatus {
  if (status === "enviada" && validUntil && validUntil.getTime() < Date.now()) {
    return "vencida";
  }
  return status;
}

function toQuoteDetail(row: {
  quote: typeof schema.quote.$inferSelect;
  contactName: string;
  items: QuoteItem[];
}): QuoteDetail {
  const q = row.quote;
  return {
    id: q.id,
    leadId: q.leadId,
    contactId: q.contactId,
    contactName: row.contactName,
    status: q.status,
    displayStatus: toDisplayStatus(q.status, q.validUntil),
    currency: q.currency,
    subtotalCents: q.subtotalCents,
    discountCents: q.discountCents,
    totalCents: q.totalCents,
    notes: q.notes,
    validUntil: q.validUntil?.toISOString() ?? null,
    sentAt: q.sentAt?.toISOString() ?? null,
    respondedAt: q.respondedAt?.toISOString() ?? null,
    webhookStatus: q.webhookStatus,
    webhookError: q.webhookError,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    items: row.items,
  };
}

async function itemsForQuote(quoteId: string): Promise<QuoteItem[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.quoteItem)
    .where(eq(schema.quoteItem.quoteId, quoteId))
    .orderBy(asc(schema.quoteItem.position));
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    quantity: r.quantity,
    unitPriceCents: r.unitPriceCents,
    totalCents: r.totalCents,
    position: r.position,
  }));
}

/** Lista de cotizaciones de la organización, la más reciente primero.
 *  `leadId` filtra a las de un solo trato (tarjeta del pipeline). */
export async function listQuotes(
  organizationId: string,
  leadId?: string
): Promise<QuoteDetail[]> {
  const db = getDb();
  const rows = await db
    .select({ quote: schema.quote, contactName: schema.contact.name })
    .from(schema.quote)
    .innerJoin(schema.contact, eq(schema.quote.contactId, schema.contact.id))
    .where(
      scoped(
        schema.quote.organizationId,
        organizationId,
        leadId ? eq(schema.quote.leadId, leadId) : undefined
      )
    )
    .orderBy(desc(schema.quote.createdAt));

  const withItems = await Promise.all(
    rows.map(async (r) => ({ ...r, items: await itemsForQuote(r.quote.id) }))
  );
  return withItems.map(toQuoteDetail);
}

export async function getQuote(
  organizationId: string,
  quoteId: string
): Promise<QuoteDetail | null> {
  const db = getDb();
  const rows = await db
    .select({ quote: schema.quote, contactName: schema.contact.name })
    .from(schema.quote)
    .innerJoin(schema.contact, eq(schema.quote.contactId, schema.contact.id))
    .where(
      scoped(
        schema.quote.organizationId,
        organizationId,
        eq(schema.quote.id, quoteId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const items = await itemsForQuote(row.quote.id);
  return toQuoteDetail({ ...row, items });
}

/** El lead + su contacto, para crear una cotización desde el pipeline. */
export async function leadForQuote(
  organizationId: string,
  leadId: string
): Promise<{ leadId: string; contactId: string; contactName: string } | null> {
  const db = getDb();
  const rows = await db
    .select({
      leadId: schema.lead.id,
      contactId: schema.contact.id,
      contactName: schema.contact.name,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .where(
      and(
        eq(schema.lead.organizationId, organizationId),
        eq(schema.lead.id, leadId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
