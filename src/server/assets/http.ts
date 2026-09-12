import { AssetError } from "@/server/assets/service";

/** 020 — Traduce un `AssetError` al sobre estándar de la API. */
export function assetErrorResponse(err: unknown): Response {
  if (!(err instanceof AssetError)) throw err;
  const status = err.code === "not_found" ? 404 : 422;
  const code = err.code === "invalid" ? "invalid_body" : err.code;
  return Response.json({ error: { code, message: err.message } }, { status });
}
