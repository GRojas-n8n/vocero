import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import { getQuote, leadForQuote, type QuoteDetail } from "@/server/quotes/queries";
import { notifyQuoteWebhook } from "@/server/quotes/webhook";
import { projectsEnabled } from "@/server/projects/flag";
import { createProjectFromQuote } from "@/server/projects/service";

/**
 * 019 — CRUD y máquina de estados de cotizaciones.
 *
 * Máquina de estados, sin atajos:
 *
 *   borrador ──enviar──▶ enviada ──aceptar──▶ aceptada
 *                           └──────rechazar──▶ rechazada
 *
 * Solo un `borrador` se edita (renglones, notas, vencimiento, descuento):
 * una vez "enviada" es un documento que el cliente ya vio, y cambiarle los
 * números por debajo sería mentirle. Quien se equivocó crea una cotización
 * nueva — no hay "editar y reenviar".
 */

export type QuoteItemInput = {
  description: string;
  quantity: number;
  unitPriceCents: number;
};

export class QuoteError extends Error {
  constructor(
    public code: "not_found" | "invalid" | "locked",
    message: string
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

/** Pura y exportada para fijar en un test la aritmética de totales sin tocar
 *  la base: el descuento nunca deja el total en negativo. */
export function computeTotals(
  items: QuoteItemInput[],
  discountCents: number
): { itemTotals: number[]; subtotalCents: number; totalCents: number } {
  const itemTotals = items.map((i) => i.quantity * i.unitPriceCents);
  const subtotalCents = itemTotals.reduce((a, b) => a + b, 0);
  const totalCents = Math.max(subtotalCents - discountCents, 0);
  return { itemTotals, subtotalCents, totalCents };
}

/** Pura y exportada por la misma razón que `computeTotals`. */
export function assertValidItems(items: QuoteItemInput[]): void {
  if (items.length === 0) {
    throw new QuoteError("invalid", "La cotización necesita al menos un renglón");
  }
  for (const item of items) {
    if (!item.description.trim()) {
      throw new QuoteError("invalid", "Cada renglón necesita una descripción");
    }
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new QuoteError("invalid", "La cantidad debe ser un entero mayor a 0");
    }
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new QuoteError("invalid", "El precio unitario no puede ser negativo");
    }
  }
}

export async function createQuote(input: {
  organizationId: string;
  leadId: string;
  currency: string;
  notes: string | null;
  validUntil: string | null;
  discountCents: number;
  items: QuoteItemInput[];
  createdBy: string;
}): Promise<QuoteDetail> {
  const lead = await leadForQuote(input.organizationId, input.leadId);
  if (!lead) throw new QuoteError("not_found", "Ese trato no existe");
  assertValidItems(input.items);

  const { itemTotals, subtotalCents, totalCents } = computeTotals(
    input.items,
    input.discountCents
  );

  const db = getDb();
  const quoteId = newId("quote");
  await db.insert(schema.quote).values({
    id: quoteId,
    organizationId: input.organizationId,
    leadId: lead.leadId,
    contactId: lead.contactId,
    status: "borrador",
    currency: input.currency,
    subtotalCents,
    discountCents: input.discountCents,
    totalCents,
    notes: input.notes,
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
    createdBy: input.createdBy,
  });
  await db.insert(schema.quoteItem).values(
    input.items.map((item, i) => ({
      id: newId("quoteItem"),
      organizationId: input.organizationId,
      quoteId,
      description: item.description.trim(),
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents: itemTotals[i]!,
      position: i,
    }))
  );

  const created = await getQuote(input.organizationId, quoteId);
  if (!created) throw new Error("la cotización recién creada no se pudo leer");
  return created;
}

async function requireDraft(
  organizationId: string,
  quoteId: string
): Promise<QuoteDetail> {
  const quote = await getQuote(organizationId, quoteId);
  if (!quote) throw new QuoteError("not_found", "Esa cotización no existe");
  if (quote.status !== "borrador") {
    throw new QuoteError(
      "locked",
      "Solo un borrador se edita — esta cotización ya se envió"
    );
  }
  return quote;
}

export async function updateQuoteDraft(input: {
  organizationId: string;
  quoteId: string;
  notes?: string | null;
  validUntil?: string | null;
  discountCents?: number;
  items?: QuoteItemInput[];
}): Promise<QuoteDetail> {
  const current = await requireDraft(input.organizationId, input.quoteId);
  const db = getDb();

  const items = input.items ?? current.items;
  if (input.items) assertValidItems(input.items);
  const discountCents = input.discountCents ?? current.discountCents;
  const { itemTotals, subtotalCents, totalCents } = computeTotals(
    items,
    discountCents
  );

  if (input.items) {
    await db
      .delete(schema.quoteItem)
      .where(eq(schema.quoteItem.quoteId, input.quoteId));
    await db.insert(schema.quoteItem).values(
      input.items.map((item, i) => ({
        id: newId("quoteItem"),
        organizationId: input.organizationId,
        quoteId: input.quoteId,
        description: item.description.trim(),
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: itemTotals[i]!,
        position: i,
      }))
    );
  }

  await db
    .update(schema.quote)
    .set({
      notes: input.notes !== undefined ? input.notes : current.notes,
      validUntil:
        input.validUntil !== undefined
          ? input.validUntil
            ? new Date(input.validUntil)
            : null
          : current.validUntil
            ? new Date(current.validUntil)
            : null,
      discountCents,
      subtotalCents,
      totalCents,
      updatedAt: new Date(),
    })
    .where(
      scoped(
        schema.quote.organizationId,
        input.organizationId,
        eq(schema.quote.id, input.quoteId)
      )
    );

  const updated = await getQuote(input.organizationId, input.quoteId);
  if (!updated) throw new Error("la cotización actualizada no se pudo leer");
  return updated;
}

export async function deleteQuote(input: {
  organizationId: string;
  quoteId: string;
}): Promise<void> {
  await requireDraft(input.organizationId, input.quoteId);
  const db = getDb();
  await db
    .delete(schema.quote)
    .where(
      scoped(
        schema.quote.organizationId,
        input.organizationId,
        eq(schema.quote.id, input.quoteId)
      )
    );
}

const TRANSITIONS: Record<
  "send" | "accept" | "reject",
  { from: "borrador" | "enviada"; to: "enviada" | "aceptada" | "rechazada" }
> = {
  send: { from: "borrador", to: "enviada" },
  accept: { from: "enviada", to: "aceptada" },
  reject: { from: "enviada", to: "rechazada" },
};

/**
 * Avanza el estado y, para "enviada"/"aceptada", dispara el webhook
 * DESPUÉS de confirmar el cambio en la base — nunca antes, y nunca como
 * condición de él (constitución II: un tercero caído no bloquea el núcleo).
 */
export async function changeQuoteStatus(input: {
  organizationId: string;
  quoteId: string;
  action: "send" | "accept" | "reject";
}): Promise<QuoteDetail> {
  const quote = await getQuote(input.organizationId, input.quoteId);
  if (!quote) throw new QuoteError("not_found", "Esa cotización no existe");

  const transition = TRANSITIONS[input.action];
  if (quote.status !== transition.from) {
    throw new QuoteError(
      "invalid",
      `No se puede pasar de "${quote.status}" a "${transition.to}"`
    );
  }
  if (transition.to === "enviada" && quote.items.length === 0) {
    throw new QuoteError("invalid", "No hay nada que enviar: agrega un renglón");
  }

  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.quote)
      .set({
        status: transition.to,
        sentAt: transition.to === "enviada" ? now : undefined,
        respondedAt:
          transition.to === "aceptada" || transition.to === "rechazada"
            ? now
            : undefined,
        updatedAt: now,
      })
      .where(
        scoped(
          schema.quote.organizationId,
          input.organizationId,
          eq(schema.quote.id, input.quoteId)
        )
      );

    // 021 — Aceptar una cotización abre el proyecto de entrega EN LA MISMA
    // transacción: si algo de esto fallara, la cotización tampoco debe quedar
    // "aceptada" sin su proyecto. Detrás de la bandera PROJECTS — apagada, no
    // pasa nada más que el cambio de estado de siempre.
    if (transition.to === "aceptada" && projectsEnabled()) {
      await createProjectFromQuote(tx, {
        organizationId: input.organizationId,
        leadId: quote.leadId,
        quoteId: quote.id,
        contactName: quote.contactName,
        budgetCents: quote.totalCents,
        currency: quote.currency,
      });
    }
  });

  const updated = await getQuote(input.organizationId, input.quoteId);
  if (!updated) throw new Error("la cotización actualizada no se pudo leer");

  if (transition.to === "enviada" || transition.to === "aceptada") {
    await notifyQuoteWebhook(input.organizationId, updated, transition.to);
    const final = await getQuote(input.organizationId, input.quoteId);
    return final ?? updated;
  }

  return updated;
}
