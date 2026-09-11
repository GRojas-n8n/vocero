import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { quotesDisabledResponse, quotesEnabled } from "@/server/quotes/flag";
import { getQuote } from "@/server/quotes/queries";
import {
  changeQuoteStatus,
  deleteQuote,
  updateQuoteDraft,
} from "@/server/quotes/service";
import { quoteErrorResponse } from "@/server/quotes/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!quotesEnabled()) return quotesDisabledResponse();
  const { id } = await ctx.params;
  const quote = await getQuote(session.organizationId, id);
  if (!quote) return apiError(404, "not_found", "Esa cotización no existe");
  return Response.json({ quote });
});

const itemSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    notes: z.string().trim().nullish(),
    validUntil: z.string().min(1).nullish(),
    discountCents: z.number().int().min(0).optional(),
    items: z.array(itemSchema).min(1).optional(),
  }),
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("reject") }),
]);

/**
 * 019 — Editar un borrador, o avanzar su estado. Un solo endpoint con
 * `action`, igual que `PATCH /api/bookings/[id]`: la forma de "qué puedo
 * hacerle a esto" es contrato, no un detalle de implementación.
 */
export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  if (!quotesEnabled()) return quotesDisabledResponse();
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  try {
    if (body.data.action === "update") {
      const quote = await updateQuoteDraft({
        organizationId: session.organizationId,
        quoteId: id,
        notes: body.data.notes,
        validUntil: body.data.validUntil,
        discountCents: body.data.discountCents,
        items: body.data.items,
      });
      return Response.json({ quote });
    }

    const quote = await changeQuoteStatus({
      organizationId: session.organizationId,
      quoteId: id,
      action: body.data.action,
    });
    return Response.json({ quote });
  } catch (err) {
    return quoteErrorResponse(err);
  }
});

export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  if (!quotesEnabled()) return quotesDisabledResponse();
  const { id } = await ctx.params;
  try {
    await deleteQuote({ organizationId: session.organizationId, quoteId: id });
    return Response.json({ ok: true });
  } catch (err) {
    return quoteErrorResponse(err);
  }
});
