import { z } from "zod";
import { parseBody, withAuth } from "@/lib/api";
import { quotesDisabledResponse, quotesEnabled } from "@/server/quotes/flag";
import { listQuotes } from "@/server/quotes/queries";
import { createQuote } from "@/server/quotes/service";
import { quoteErrorResponse } from "@/server/quotes/http";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

/** GET /api/quotes — lista de la organización, o de un solo trato con
 *  ?leadId= (tarjeta del pipeline). */
export const GET = withAuth(async (session, req: Request) => {
  if (!quotesEnabled()) return quotesDisabledResponse();
  const leadId = new URL(req.url).searchParams.get("leadId") ?? undefined;
  const quotes = await listQuotes(session.organizationId, leadId);
  return Response.json({ quotes });
});

const itemSchema = z.object({
  description: z.string().trim().min(1),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
});

const postSchema = z.object({
  leadId: z.string().min(1),
  currency: z.string().trim().min(3).max(3).optional(),
  notes: z.string().trim().nullish(),
  validUntil: z.string().min(1).nullish(),
  discountCents: z.number().int().min(0).optional(),
  items: z.array(itemSchema).min(1),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!quotesEnabled()) return quotesDisabledResponse();
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  try {
    // Sin moneda explícita, la del negocio (Ajustes → Marca) — igual que un
    // lead sin la suya (`src/app/api/pipeline/board/route.ts`).
    const currency =
      body.data.currency ?? (await getBranding(session.organizationId)).currency;

    const quote = await createQuote({
      organizationId: session.organizationId,
      leadId: body.data.leadId,
      currency,
      notes: body.data.notes ?? null,
      validUntil: body.data.validUntil ?? null,
      discountCents: body.data.discountCents ?? 0,
      items: body.data.items,
      createdBy: session.userId,
    });
    return Response.json({ quote }, { status: 201 });
  } catch (err) {
    return quoteErrorResponse(err);
  }
});
