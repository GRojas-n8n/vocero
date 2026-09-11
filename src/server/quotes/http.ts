import { QuoteError } from "@/server/quotes/service";

/** 019 — Traduce un `QuoteError` al sobre estándar de la API. */
export function quoteErrorResponse(err: unknown): Response {
  if (!(err instanceof QuoteError)) throw err;
  const status =
    err.code === "not_found" ? 404 : err.code === "locked" ? 409 : 422;
  const code = err.code === "invalid" ? "invalid_body" : err.code;
  return Response.json({ error: { code, message: err.message } }, { status });
}
