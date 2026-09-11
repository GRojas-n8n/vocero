import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { scoped } from "@/lib/db/tenant";
import type { QuoteDetail } from "@/server/quotes/queries";

/**
 * 019 — Webhook saliente hacia n8n (u otro receptor) al cambiar a "enviada"
 * o "aceptada".
 *
 * Constitución II (soberanía): esto es un CONECTOR OPCIONAL, no un requisito
 * del núcleo. Sin `QUOTES_N8N_WEBHOOK_URL`, `notifyQuoteWebhook` es un no-op
 * — la transición de estado ya ocurrió y ocurre completa sin este módulo.
 * Best-effort absoluto, igual que `reportStageChange` de atribución
 * (`src/server/attribution/conversions.ts`): un tercero caído JAMÁS deshace
 * ni bloquea el cambio de estado de la cotización, solo queda escrito en
 * `webhookStatus`/`webhookError` para que el operador lo vea.
 */

const TIMEOUT_MS = 8000;

export type QuoteWebhookEvent = "enviada" | "aceptada";

function buildPayload(quote: QuoteDetail, event: QuoteWebhookEvent) {
  return {
    event: `quote.${event}`,
    quote: {
      id: quote.id,
      leadId: quote.leadId,
      contactId: quote.contactId,
      contactName: quote.contactName,
      status: quote.status,
      currency: quote.currency,
      subtotalCents: quote.subtotalCents,
      discountCents: quote.discountCents,
      totalCents: quote.totalCents,
      validUntil: quote.validUntil,
      sentAt: quote.sentAt,
      respondedAt: quote.respondedAt,
      items: quote.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        totalCents: i.totalCents,
      })),
    },
  };
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Notifica el webhook y deja rastro en `quote.webhook_*`. Nunca lanza: el
 * llamador (`service.ts`, justo después de escribir el nuevo `status`) no
 * tiene por qué enterarse de un tercero caído.
 */
export async function notifyQuoteWebhook(
  organizationId: string,
  quote: QuoteDetail,
  event: QuoteWebhookEvent
): Promise<void> {
  const db = getDb();
  const { QUOTES_N8N_WEBHOOK_URL: url, QUOTES_N8N_WEBHOOK_SECRET: secret } =
    getEnv();

  if (!url) {
    await db
      .update(schema.quote)
      .set({
        webhookStatus: "skipped",
        webhookError: null,
        webhookAttemptedAt: new Date(),
      })
      .where(
        scoped(
          schema.quote.organizationId,
          organizationId,
          eq(schema.quote.id, quote.id)
        )
      );
    return;
  }

  const body = JSON.stringify(buildPayload(quote, event));
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret) headers["x-vocero-signature"] = sign(body, secret);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`el receptor respondió ${res.status}`);
    }
    await db
      .update(schema.quote)
      .set({
        webhookStatus: "sent",
        webhookError: null,
        webhookAttemptedAt: new Date(),
      })
      .where(
        scoped(
          schema.quote.organizationId,
          organizationId,
          eq(schema.quote.id, quote.id)
        )
      );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[quotes] webhook ${event} de ${quote.id} falló: ${message}`
    );
    await db
      .update(schema.quote)
      .set({
        webhookStatus: "failed",
        webhookError: message,
        webhookAttemptedAt: new Date(),
      })
      .where(
        scoped(
          schema.quote.organizationId,
          organizationId,
          eq(schema.quote.id, quote.id)
        )
      );
  }
}
